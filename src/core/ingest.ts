import type { Config, Issue, Tx } from './types.ts';
import { decodeBytes, parseBankCsv } from './parse.ts';
import { chronological, findChainBreaks, mergeRows, orderChronologically } from './merge.ts';
import { FormatError, mergeConfig, parseJsonFile } from './workspace.ts';
import type { RawRow } from './types.ts';
import { hash53 } from './text.ts';

export interface Workspace {
  txs: Tx[];
  config: Config;
}

export interface FileReport {
  fileName: string;
  type: 'bank-csv' | 'workspace' | 'config' | 'unrecognised';
  rows: number;
  added: number;
  duplicates: number;
  rebalanced: number;
  from: string | null;
  to: string | null;
  /** Closing balance printed in the file footer against the newest row. */
  closingCheck: 'ok' | 'mismatch' | 'none';
  issues: Issue[];
}

const blank = (fileName: string, type: FileReport['type']): FileReport => ({
  fileName,
  type,
  rows: 0,
  added: 0,
  duplicates: 0,
  rebalanced: 0,
  from: null,
  to: null,
  closingCheck: 'none',
  issues: [],
});

function mergeBatch(ws: Workspace, rows: RawRow[], report: FileReport): Workspace {
  const res = mergeRows(ws.txs, rows);
  report.rows = rows.length;
  report.added = res.added;
  report.duplicates = res.duplicates;
  report.rebalanced = res.rebalanced;
  if (rows.length) {
    report.from = (rows[0] as RawRow).date;
    report.to = (rows[rows.length - 1] as RawRow).date;
  }
  return { ...ws, txs: res.txs };
}

/**
 * Load one file (bank CSV, workspace JSON or config JSON) into the workspace.
 * Never throws: problems are returned in the report.
 */
export function ingest(ws: Workspace, fileName: string, bytes: Uint8Array): { ws: Workspace; report: FileReport } {
  const text = decodeBytes(bytes);
  const trimmed = text.trimStart();

  if (trimmed.startsWith('{')) {
    const report = blank(fileName, 'workspace');
    try {
      const loaded = parseJsonFile(text);
      if (loaded.type === 'config') {
        report.type = 'config';
        return { ws: { ...ws, config: mergeConfig(ws.config, loaded.config) }, report };
      }
      const merged = mergeBatch(ws, loaded.rows, report);
      return { ws: { ...merged, config: mergeConfig(merged.config, loaded.config) }, report };
    } catch (e) {
      report.type = 'unrecognised';
      report.issues.push({ level: 'error', message: e instanceof FormatError ? e.message : 'Could not read this file.' });
      return { ws, report };
    }
  }

  const parsed = parseBankCsv(text, fileName);
  const report = blank(fileName, parsed.rows.length || parsed.issues.length === 0 ? 'bank-csv' : 'unrecognised');
  report.issues = parsed.issues;
  if (parsed.rows.length === 0) return { ws, report };

  const next = mergeBatch(ws, chronological(parsed), report);
  const newest = parsed.rows[0];
  if (parsed.meta.closingBalance !== null && newest) {
    report.closingCheck = parsed.meta.closingBalance === newest.balance ? 'ok' : 'mismatch';
    if (report.closingCheck === 'mismatch') {
      report.issues.push({ level: 'warning', message: 'The closing balance in the file footer does not match its newest row.' });
    }
  }
  return { ws: next, report };
}

export interface Coverage {
  count: number;
  from: string | null;
  to: string | null;
  months: number;
  missingMonths: string[];
  breaks: ReturnType<typeof findChainBreaks>;
  latestBalance: number | null;
}

/** Summary of what is loaded: range, empty months in the middle, balance chain gaps. */
export function coverage(txs: Tx[]): Coverage {
  if (txs.length === 0) {
    return { count: 0, from: null, to: null, months: 0, missingMonths: [], breaks: [], latestBalance: null };
  }
  const present = new Set(txs.map((t) => t.date.slice(0, 7)));
  const from = (txs[0] as Tx).date;
  const last = txs[txs.length - 1] as Tx;
  const missing: string[] = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  const endY = Number(last.date.slice(0, 4));
  const endM = Number(last.date.slice(5, 7));
  while (y < endY || (y === endY && m <= endM)) {
    const k = `${y}-${String(m).padStart(2, '0')}`;
    if (!present.has(k)) missing.push(k);
    if (++m > 12) {
      m = 1;
      y++;
    }
  }
  return {
    count: txs.length,
    from,
    to: last.date,
    months: present.size,
    missingMonths: missing,
    breaks: findChainBreaks(txs),
    latestBalance: last.balance,
  };
}

/** Re-sort after any edit that could have changed order (kept for callers that hold raw lists). */
export const resort = orderChronologically;

/** Short stable id for new rules, periods and categories. */
export function newId(prefix: string): string {
  return `${prefix}-${hash53(`${Date.now()}-${Math.random()}`)}`;
}
