import type { Category, CategoryType, Cents } from './types.ts';
import type { Row } from './categorise.ts';
import { displayName } from './categorise.ts';

export const UNCATEGORISED = '(uncategorised)';

/**
 * How a row counts. Uncategorised credits count as income and uncategorised
 * debits as spending, so income - spending + movement to savings always equals
 * the change in balance.
 */
export function typeOf(row: Row, categories: Map<string, Category>): CategoryType {
  const c = row.categoryId ? categories.get(row.categoryId) : undefined;
  if (c) return c.type;
  return row.amount >= 0 ? 'income' : 'expense';
}

export const monthOf = (date: string): string => date.slice(0, 7);
export const yearOf = (date: string): string => date.slice(0, 4);
export type Granularity = 'month' | 'quarter' | 'year';

export function bucketOf(date: string, g: Granularity): string {
  if (g === 'year') return yearOf(date);
  if (g === 'quarter') return `${yearOf(date)}-Q${Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1}`;
  return monthOf(date);
}

/** Every bucket between two dates, so charts have no holes. */
export function bucketRange(from: string, to: string, g: Granularity): string[] {
  const out: string[] = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  const endY = Number(to.slice(0, 4));
  const endM = Number(to.slice(5, 7));
  while (y < endY || (y === endY && m <= endM)) {
    const b = bucketOf(`${y}-${String(m).padStart(2, '0')}-01`, g);
    if (out[out.length - 1] !== b) out.push(b);
    if (++m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

export function inRange(row: { date: string }, from?: string, to?: string): boolean {
  return (!from || row.date >= from) && (!to || row.date <= to);
}

export interface Totals {
  income: Cents;
  /** Positive number: refunds reduce it. */
  expense: Cents;
  net: Cents;
  /** Positive: money came back from savings. Negative: money moved into savings. */
  savings: Cents;
  uncategorisedCount: number;
  uncategorisedValue: Cents;
  count: number;
}

export function totals(rows: Row[], categories: Map<string, Category>): Totals {
  const t: Totals = {
    income: 0,
    expense: 0,
    net: 0,
    savings: 0,
    uncategorisedCount: 0,
    uncategorisedValue: 0,
    count: rows.length,
  };
  for (const r of rows) {
    const type = typeOf(r, categories);
    if (!r.categoryId) {
      t.uncategorisedCount++;
      t.uncategorisedValue += Math.abs(r.amount);
    }
    if (type === 'income') t.income += r.amount;
    else if (type === 'expense') t.expense -= r.amount;
    else if (type === 'savings') t.savings += r.amount;
  }
  t.net = t.income - t.expense;
  return t;
}

export interface Bucketed<T> {
  labels: string[];
  values: T[];
}

export function totalsByBucket(
  rows: Row[],
  categories: Map<string, Category>,
  g: Granularity,
  from: string,
  to: string,
): Bucketed<Totals> {
  const labels = bucketRange(from, to, g);
  const groups = new Map<string, Row[]>(labels.map((l) => [l, []]));
  for (const r of rows) groups.get(bucketOf(r.date, g))?.push(r);
  return { labels, values: labels.map((l) => totals(groups.get(l) as Row[], categories)) };
}

export interface Series {
  id: string;
  label: string;
  /** Signed so that expenses are positive: -amount for expense, +amount for income. */
  values: Cents[];
}

/** One line per category (or group) over time, in the category's natural sign. */
export function categorySeries(
  rows: Row[],
  categories: Map<string, Category>,
  g: Granularity,
  from: string,
  to: string,
  by: 'category' | 'group',
): Bucketed<Series> {
  const labels = bucketRange(from, to, g);
  const index = new Map(labels.map((l, i) => [l, i]));
  const series = new Map<string, Series>();
  for (const r of rows) {
    const c = r.categoryId ? categories.get(r.categoryId) : undefined;
    const id = c ? (by === 'group' ? `group:${c.group}` : c.id) : UNCATEGORISED;
    const label = c ? (by === 'group' ? c.group : c.name) : UNCATEGORISED;
    let s = series.get(id);
    if (!s) {
      s = { id, label, values: labels.map(() => 0) };
      series.set(id, s);
    }
    const i = index.get(bucketOf(r.date, g));
    if (i === undefined) continue;
    const type = typeOf(r, categories);
    // Spending shown as positive; income and savings as they came in.
    (s.values as number[])[i] = (s.values[i] as number) + (type === 'expense' ? -r.amount : r.amount);
  }
  return { labels, values: [...series.values()] };
}

export interface BreakdownLine {
  id: string;
  label: string;
  group: string;
  type: CategoryType;
  /** Positive for spending and income alike. */
  amount: Cents;
  count: number;
}

export function breakdown(rows: Row[], categories: Map<string, Category>): BreakdownLine[] {
  const m = new Map<string, BreakdownLine>();
  for (const r of rows) {
    const c = r.categoryId ? categories.get(r.categoryId) : undefined;
    const type = typeOf(r, categories);
    if (type === 'ignore') continue;
    const id = c ? c.id : `${UNCATEGORISED}:${type}`;
    let line = m.get(id);
    if (!line) {
      line = {
        id,
        label: c ? c.name : UNCATEGORISED,
        group: c ? c.group : UNCATEGORISED,
        type,
        amount: 0,
        count: 0,
      };
      m.set(id, line);
    }
    line.amount += type === 'expense' ? -r.amount : r.amount;
    line.count++;
  }
  return [...m.values()].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
}

export interface PersonTotal {
  name: string;
  label: string;
  inbound: Cents;
  outbound: Cents;
  net: Cents;
  count: number;
  first: string;
  last: string;
}

/** Money moved with each phone number / named party. */
export function counterpartyTotals(rows: Row[], aliases: Record<string, string>): PersonTotal[] {
  const m = new Map<string, PersonTotal>();
  for (const r of rows) {
    if (r.kind !== 'phone-transfer' && r.kind !== 'transfer') continue;
    const key = r.counterparty ?? r.name;
    let p = m.get(key);
    if (!p) {
      p = {
        name: key,
        label: displayName(key, aliases),
        inbound: 0,
        outbound: 0,
        net: 0,
        count: 0,
        first: r.date,
        last: r.date,
      };
      m.set(key, p);
    }
    if (r.amount >= 0) p.inbound += r.amount;
    else p.outbound += -r.amount;
    p.net += r.amount;
    p.count++;
    if (r.date < p.first) p.first = r.date;
    if (r.date > p.last) p.last = r.date;
  }
  return [...m.values()].sort((a, b) => b.inbound + b.outbound - (a.inbound + a.outbound));
}

/** End-of-bucket balance and lowest balance within each bucket. */
export function balanceSeries(
  rows: Row[],
  g: Granularity,
  from: string,
  to: string,
): Bucketed<{ end: Cents | null; low: Cents | null }> {
  const labels = bucketRange(from, to, g);
  const idx = new Map(labels.map((l, i) => [l, i]));
  const vals = labels.map(() => ({ end: null as Cents | null, low: null as Cents | null }));
  let carry: Cents | null = null;
  for (const r of rows) {
    const i = idx.get(bucketOf(r.date, g));
    if (i === undefined) continue;
    const v = vals[i] as { end: Cents | null; low: Cents | null };
    v.end = r.balance;
    v.low = v.low === null ? r.balance : Math.min(v.low, r.balance);
  }
  // Buckets with no rows hold the previous balance.
  for (let i = 0; i < vals.length; i++) {
    const v = vals[i] as { end: Cents | null; low: Cents | null };
    if (v.end === null) {
      v.end = carry;
      v.low = carry;
    } else carry = v.end;
  }
  return { labels, values: vals };
}

/**
 * Cumulative net movement into savings at each bucket end (positive = parked).
 * An estimate of what sits in deposits: interest folded into a withdrawal makes
 * it drift, and renewals inside the savings account are invisible from here.
 */
export function savingsHeld(
  rows: Row[],
  categories: Map<string, Category>,
  g: Granularity,
  from: string,
  to: string,
): Bucketed<Cents> {
  const labels = bucketRange(from, to, g);
  const idx = new Map(labels.map((l, i) => [l, i]));
  const delta = labels.map(() => 0);
  let before = 0;
  for (const r of rows) {
    if (typeOf(r, categories) !== 'savings') continue;
    if (r.date < from) {
      before -= r.amount;
      continue;
    }
    const i = idx.get(bucketOf(r.date, g));
    if (i !== undefined) delta[i] = (delta[i] as number) - r.amount;
  }
  let run = before;
  return {
    labels,
    values: delta.map((d) => {
      run += d;
      return run;
    }),
  };
}
