/** Integer cents. Never floating point. */
export type Cents = number;

/** One transaction as stored. Everything derived (kind, name, category) is computed on load. */
export interface Tx {
  /** Stable id: hash of the dedupe key plus the occurrence number. */
  id: string;
  /** Dedupe key, without the occurrence number. */
  key: string;
  /** 1-based occurrence among rows sharing the same key. */
  occ: number;
  /** Movement date, YYYY-MM-DD. All reporting uses this. */
  date: string;
  /** Value date, YYYY-MM-DD. Can be far earlier than `date` for reversals. */
  valueDate: string;
  /** Description as exported, trimmed. */
  description: string;
  /** Signed: credit minus debit. */
  amount: Cents;
  /** Booked balance after this transaction. */
  balance: Cents;
  /** Available balance after this transaction, if exported. */
  available: Cents | null;
  /** The bank's own category label. Only a hint. */
  bankCategory: string;
  /** Position in the batch it came from (chronological). Only used to break same-day ties. */
  seq: number;
}

/** One row read from a CSV, before it becomes a Tx. */
export interface RawRow {
  date: string;
  valueDate: string;
  description: string;
  amount: Cents;
  balance: Cents;
  available: Cents | null;
  bankCategory: string;
}

export type Kind =
  | 'purchase'
  | 'phone-transfer'
  | 'transfer'
  | 'cash'
  | 'fee'
  | 'term-deposit'
  | 'other';

export const KINDS: readonly Kind[] = [
  'purchase',
  'phone-transfer',
  'transfer',
  'cash',
  'fee',
  'term-deposit',
  'other',
];

export interface Described {
  kind: Kind;
  /** Entity the transaction is with: merchant, masked phone, or transfer name. */
  name: string;
  /** Masked phone number or transfer name, for person-to-person movements. */
  counterparty: string | null;
  /** True when the bank is cancelling or refunding an earlier row. */
  reversal: boolean;
  /** Whole description, uppercased, punctuation removed, whitespace collapsed. */
  norm: string;
}

export type CategoryType = 'income' | 'expense' | 'savings' | 'ignore';

export interface Category {
  id: string;
  name: string;
  group: string;
  type: CategoryType;
}

export interface Rule {
  id: string;
  categoryId: string;
  /** Match the entity name (merchant / phone / person), tolerant of truncation. */
  name?: string;
  /** Match when the whole normalised description contains this text. */
  contains?: string;
  kind?: Kind;
  direction?: 'in' | 'out';
  /** Absolute amount bounds, cents. */
  minAmount?: Cents;
  maxAmount?: Cents;
  /** Inclusive date bounds, YYYY-MM-DD. */
  from?: string;
  to?: string;
  /** Resolved to from/to through the matching period. */
  periodId?: string;
  note?: string;
  /** Higher wins over specificity. Default 0. */
  priority?: number;
}

export interface Period {
  id: string;
  name: string;
  from: string;
  to: string;
}

export interface Config {
  version: 1;
  categories: Category[];
  rules: Rule[];
  /** Entity name (e.g. masked phone) to display name. */
  aliases: Record<string, string>;
  periods: Period[];
  /** Transaction id to category id. Beats every rule. */
  overrides: Record<string, string>;
}

export interface Issue {
  level: 'error' | 'warning' | 'info';
  line?: number;
  message: string;
}

export interface FileMeta {
  rangeStart: string | null;
  rangeEnd: string | null;
  closingBalance: Cents | null;
  closingAvailable: Cents | null;
}

export interface ParsedFile {
  fileName: string;
  /** In file order, newest first for bank exports. */
  rows: RawRow[];
  issues: Issue[];
  meta: FileMeta;
}

export interface ChainBreak {
  /** Date of the last row before the gap. */
  beforeDate: string;
  /** Date of the first row after the gap. */
  afterDate: string;
  /** Net movement the balances imply but no row explains. */
  missing: Cents;
}
