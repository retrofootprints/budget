import type { ChainBreak, Cents, ParsedFile, RawRow, Tx } from './types.ts';
import { foldText, hash53 } from './text.ts';

/**
 * Identity of a transaction, excluding balance: a re-export after a late posting
 * shifts later balances but not the transactions themselves. Case and punctuation
 * in the description are folded because the bank has varied them.
 */
export function dedupeKey(r: Pick<RawRow, 'date' | 'valueDate' | 'description' | 'amount'>): string {
  return `${r.date}|${r.valueDate}|${foldText(r.description)}|${r.amount}`;
}

export interface MergeResult {
  txs: Tx[];
  added: number;
  /** Incoming rows already present. */
  duplicates: number;
  /** Incoming rows already present whose balance differed (kept the incoming one). */
  rebalanced: number;
}

/**
 * Merge rows (chronological order, oldest first) into the existing transactions.
 *
 * Rows sharing a key are counted. The merged count for a key is the highest count
 * seen in any single batch. So the same file loaded twice adds nothing, overlapping
 * files merge, and a charge / cancel / charge sequence (two identical rows on one
 * day) keeps both rows.
 */
export function mergeRows(existing: Tx[], incoming: RawRow[]): MergeResult {
  const byId = new Map<string, Tx>();
  for (const t of existing) {
    byId.set(t.id, t);
  }

  const seen = new Map<string, number>();
  const added: Tx[] = [];
  let duplicates = 0;
  let rebalanced = 0;

  incoming.forEach((r, i) => {
    const key = dedupeKey(r);
    const occ = (seen.get(key) ?? 0) + 1;
    seen.set(key, occ);
    const id = `${hash53(key)}.${occ}`;
    const present = byId.get(id);
    if (present) {
      duplicates++;
      if (present.balance !== r.balance || present.available !== r.available) {
        rebalanced++;
        const updated: Tx = { ...present, balance: r.balance, available: r.available, seq: i };
        byId.set(id, updated);
      }
      return;
    }
    const tx: Tx = {
      id,
      key,
      occ,
      date: r.date,
      valueDate: r.valueDate,
      description: r.description.replace(/\s+/g, ' ').trim(),
      amount: r.amount,
      balance: r.balance,
      available: r.available,
      bankCategory: r.bankCategory,
      seq: i,
    };
    byId.set(id, tx);
    added.push(tx);
  });

  return {
    txs: orderChronologically([...byId.values()]),
    added: added.length,
    duplicates,
    rebalanced,
  };
}

/** Convenience: rows of a bank file in chronological order (files are newest first). */
export function chronological(file: ParsedFile): RawRow[] {
  return [...file.rows].reverse();
}

/**
 * Sort by date, then order each day so the running balance chains. Same-day order
 * in the export is kept when it already chains; otherwise rows are placed by
 * following the balances.
 */
export function orderChronologically(txs: Tx[]): Tx[] {
  const days = new Map<string, Tx[]>();
  for (const t of txs) {
    const d = days.get(t.date);
    if (d) d.push(t);
    else days.set(t.date, [t]);
  }
  const dates = [...days.keys()].sort();
  const out: Tx[] = [];
  let prev: Cents | null = null;
  for (const date of dates) {
    const day = (days.get(date) as Tx[]).sort((a, b) => a.seq - b.seq || a.id.localeCompare(b.id));
    const placed: Tx[] = prev === null ? day : chainOrder(day, prev);
    out.push(...placed);
    prev = (placed[placed.length - 1] as Tx).balance;
  }
  return out;
}

function chainOrder(day: Tx[], start: Cents): Tx[] {
  // Already valid in stored order?
  let bal = start;
  let ok = true;
  for (const t of day) {
    if (bal + t.amount !== t.balance) {
      ok = false;
      break;
    }
    bal = t.balance;
  }
  if (ok || day.length === 1) return day;

  const left = [...day];
  const placed: Tx[] = [];
  bal = start;
  while (left.length) {
    const i = left.findIndex((t) => bal + t.amount === t.balance);
    if (i < 0) break;
    const [t] = left.splice(i, 1) as [Tx];
    placed.push(t);
    bal = t.balance;
  }
  // Chain broke (a row is missing): keep the remainder in stored order.
  return [...placed, ...left];
}

/** Find every place where the running balance does not follow from the rows. */
export function findChainBreaks(txs: Tx[]): ChainBreak[] {
  const breaks: ChainBreak[] = [];
  for (let i = 1; i < txs.length; i++) {
    const p = txs[i - 1] as Tx;
    const t = txs[i] as Tx;
    const expected = p.balance + t.amount;
    if (expected !== t.balance) {
      breaks.push({ beforeDate: p.date, afterDate: t.date, missing: t.balance - expected });
    }
  }
  return breaks;
}
