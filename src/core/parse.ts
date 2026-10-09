import type { FileMeta, Issue, ParsedFile, RawRow } from './types.ts';
import { foldText, parseAmountCents, parseDate } from './text.ts';

/** Decode bytes as UTF-8 if valid, otherwise Windows-1252. Strips a BOM. */
export function decodeBytes(bytes: Uint8Array): string {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder('windows-1252').decode(bytes);
  }
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

const COLUMN_PATTERNS = {
  date: /^data mov/,
  valueDate: /^data valor/,
  description: /^descri/,
  debit: /^d\s*bito|^debit/,
  credit: /^cr\s*dito|^credit/,
  balance: /^saldo contab/,
  available: /^saldo dispon/,
  category: /^categoria/,
} as const;

type ColumnName = keyof typeof COLUMN_PATTERNS;
type ColumnMap = Record<ColumnName, number>;

/** Split one line on `delim`, honouring double quotes. */
function splitLine(line: string, delim: string): string[] {
  if (!line.includes('"')) return line.split(delim);
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i] as string;
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === delim) {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}

function detectDelimiter(headerLine: string): string {
  const semi = headerLine.split(';').length;
  const tab = headerLine.split('\t').length;
  return tab > semi ? '\t' : ';';
}

/** Match the column header against the known column names. Null if not a header. */
function mapHeader(fields: string[]): ColumnMap | null {
  const map: Partial<ColumnMap> = {};
  fields.forEach((f, i) => {
    // Fold keeps letters, so a mis-decoded "débito" still reads "d bito".
    const folded = foldText(f).toLowerCase();
    for (const name of Object.keys(COLUMN_PATTERNS) as ColumnName[]) {
      if (map[name] === undefined && COLUMN_PATTERNS[name].test(folded)) map[name] = i;
    }
  });
  const required: ColumnName[] = ['date', 'description', 'debit', 'credit', 'balance'];
  if (required.some((c) => map[c] === undefined)) return null;
  return { valueDate: -1, available: -1, category: -1, ...map } as ColumnMap;
}

/** First amount that follows a label such as "Saldo contabilistico" on a footer line. */
function footerAmount(fields: string[], labelTest: RegExp): number | null {
  const at = fields.findIndex((f) => labelTest.test(foldText(f).toLowerCase()));
  if (at < 0) return null;
  for (let i = at + 1; i < fields.length; i++) {
    const v = parseAmountCents((fields[i] as string).trim());
    if (v !== null) return v;
  }
  return null;
}

/**
 * Parse one bank export. Tolerant of a preamble (title, account, period) before the
 * header and of a footer (closing balances) after the data. A row counts as a
 * transaction only if its first field is a real date.
 */
export function parseBankCsv(text: string, fileName: string): ParsedFile {
  const issues: Issue[] = [];
  const meta: FileMeta = { rangeStart: null, rangeEnd: null, closingBalance: null, closingAvailable: null };
  const lines = text.split(/\r\n|\n|\r/);

  let headerAt = -1;
  let delim = ';';
  let cols: ColumnMap | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    if (!line.trim()) continue;
    const d = detectDelimiter(line);
    const mapped = mapHeader(splitLine(line, d));
    if (mapped) {
      headerAt = i;
      delim = d;
      cols = mapped;
      break;
    }
  }
  if (headerAt < 0 || !cols) {
    issues.push({ level: 'error', message: 'No column header found (expected "Data mov.", "Descrição", "Débito", "Crédito", "Saldo contabilístico").' });
    return { fileName, rows: [], issues, meta };
  }

  // Preamble: the exported period.
  for (let i = 0; i < headerAt; i++) {
    const f = splitLine(lines[i] as string, delim);
    const label = foldText(f[0] ?? '').toLowerCase();
    const value = parseDate((f[1] ?? '').trim());
    if (/^data de in/.test(label) && value) meta.rangeStart = value;
    else if (/^data de fim/.test(label) && value) meta.rangeEnd = value;
  }

  const rows: RawRow[] = [];
  for (let i = headerAt + 1; i < lines.length; i++) {
    const line = lines[i] as string;
    if (!line.trim()) continue;
    const f = splitLine(line, delim);
    const date = parseDate((f[cols.date] ?? '').trim());
    if (!date) {
      // Not a transaction: footer. Pick up closing balances where present.
      const book = footerAmount(f, /^saldo contab/);
      const avail = footerAmount(f, /^saldo dispon/);
      if (book !== null) meta.closingBalance = book;
      if (avail !== null) meta.closingAvailable = avail;
      continue;
    }
    const lineNo = i + 1;
    const valueDate = cols.valueDate >= 0 ? parseDate((f[cols.valueDate] ?? '').trim()) : date;
    const debitRaw = (f[cols.debit] ?? '').trim();
    const creditRaw = (f[cols.credit] ?? '').trim();
    const debit = debitRaw ? parseAmountCents(debitRaw) : null;
    const credit = creditRaw ? parseAmountCents(creditRaw) : null;
    const balRaw = (f[cols.balance] ?? '').trim();
    const balance = balRaw ? parseAmountCents(balRaw) : null;
    const availRaw = cols.available >= 0 ? (f[cols.available] ?? '').trim() : '';
    const available = availRaw ? parseAmountCents(availRaw) : null;

    let problem: string | null = null;
    if (!valueDate) problem = 'invalid value date';
    else if (debitRaw && debit === null) problem = `unreadable debit "${debitRaw}"`;
    else if (creditRaw && credit === null) problem = `unreadable credit "${creditRaw}"`;
    else if (debit !== null && credit !== null) problem = 'both debit and credit filled';
    else if (debit === null && credit === null) problem = 'no amount';
    else if (balance === null) problem = 'missing or unreadable balance';
    if (problem || !valueDate || balance === null) {
      issues.push({ level: 'error', line: lineNo, message: `Row skipped: ${problem}.` });
      continue;
    }

    rows.push({
      date,
      valueDate,
      description: (f[cols.description] ?? '').trim(),
      amount: credit !== null ? credit : -(debit as number),
      balance,
      available,
      bankCategory: cols.category >= 0 ? (f[cols.category] ?? '').trim() : '',
    });
  }

  if (rows.length === 0 && issues.length === 0) {
    issues.push({ level: 'warning', message: 'The file has a header but no transactions.' });
  }
  return { fileName, rows, issues, meta };
}
