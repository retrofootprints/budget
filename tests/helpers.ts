import { formatCents } from '../src/core/text.ts';

/** `YYYY-MM-DD` to `DD-MM-YYYY`. */
const dmy = (iso: string): string => iso.split('-').reverse().join('-');

export interface Op {
  date: string;
  desc: string;
  /** Signed cents: negative for a debit. */
  amount: number;
  valueDate?: string;
  cat?: string;
}

export const HEADER =
  'Data mov. ;Data valor ;Descrição ;Débito ;Crédito ;Saldo contabilístico ;Saldo disponível ;Categoria ;';

/**
 * Build an export the way the bank writes it: newest first, `;` separated with a
 * trailing `;`, Portuguese numbers. Balances are computed so the chain is valid.
 */
export function makeCsv(
  ops: Op[],
  opts: { start?: number; preamble?: boolean; footer?: boolean; eol?: string } = {},
): string {
  const eol = opts.eol ?? '\r\n';
  let bal = opts.start ?? 100_000;
  const lines: string[] = [];
  for (const op of ops) {
    bal += op.amount;
    const debit = op.amount < 0 ? formatCents(-op.amount) : '';
    const credit = op.amount > 0 ? formatCents(op.amount) : '';
    const b = formatCents(bal);
    lines.push(
      [dmy(op.date), dmy(op.valueDate ?? op.date), `${op.desc} `, debit, credit, b, b, `${op.cat ?? 'Diversos'} `, ''].join(';'),
    );
  }
  lines.reverse();
  const head: string[] = [];
  if (opts.preamble) {
    head.push(
      'Consultar saldos e movimentos à ordem - 01-01-2030',
      '',
      'Conta ;000000000000 - EUR - Conta à ordem ',
      `Data de início ;${dmy(ops[0]?.date ?? '2030-01-01')}`,
      `Data de fim ;${dmy(ops[ops.length - 1]?.date ?? '2030-01-01')}`,
      '',
    );
  }
  const tail: string[] = [];
  if (opts.footer) {
    const b = formatCents(bal);
    tail.push(
      ` ; ; ; ;Saldo contabilístico ;${b} EUR ; ; ;`,
      ` ; ; Saldo disponível  ;${b} EUR ; ; ; ; ;`,
      ' Facilidade descoberto contratada  ;500,00 EUR ; ; ; ; ; Facilidade descoberto utilizada  ;0,00 EUR ;',
    );
  }
  return [...head, HEADER, ...lines, ...tail, ''].join(eol);
}

/** Encode as Windows-1252 (latin1 covers every accented letter used here). */
export function cp1252(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}
export const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);
