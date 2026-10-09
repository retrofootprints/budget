import type { Category, Config, Period, RawRow, Rule, Tx } from './types.ts';
import { KINDS } from './types.ts';
import { defaultConfig } from './defaults.ts';
import type { Row } from './categorise.ts';
import { displayName } from './categorise.ts';
import { typeOf } from './reports.ts';
import { parseDate } from './text.ts';

export const WORKSPACE_FORMAT = 'budget-workspace';
export const CONFIG_FORMAT = 'budget-config';
const MAX_ITEMS = 500_000;

export interface WorkspaceFile {
  format: typeof WORKSPACE_FORMAT;
  version: 1;
  exportedAt: string;
  transactions: {
    date: string;
    valueDate: string;
    description: string;
    amount: number;
    balance: number;
    available: number | null;
    bankCategory: string;
  }[];
  config: Config;
}

export interface ConfigFile {
  format: typeof CONFIG_FORMAT;
  version: 1;
  exportedAt: string;
  config: Config;
}

export function serialiseWorkspace(txs: Tx[], config: Config): string {
  const file: WorkspaceFile = {
    format: WORKSPACE_FORMAT,
    version: 1,
    exportedAt: new Date().toISOString(),
    // Chronological, so the same-day order survives a round trip.
    transactions: txs.map((t) => ({
      date: t.date,
      valueDate: t.valueDate,
      description: t.description,
      amount: t.amount,
      balance: t.balance,
      available: t.available,
      bankCategory: t.bankCategory,
    })),
    config,
  };
  return JSON.stringify(file);
}

export function serialiseConfig(config: Config): string {
  const file: ConfigFile = { format: CONFIG_FORMAT, version: 1, exportedAt: new Date().toISOString(), config };
  return JSON.stringify(file, null, 2);
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v);
const isDate = (v: unknown): v is string => isStr(v) && parseDate(v.split('-').reverse().join('-')) !== null;

export class FormatError extends Error {}

/** Validate untrusted JSON into a Config. Unknown fields are dropped. */
export function sanitiseConfig(input: unknown): Config {
  if (!isObj(input)) throw new FormatError('Config is not an object.');
  const cfg = defaultConfig();
  cfg.categories = [];
  const catTypes = new Set(['income', 'expense', 'savings', 'ignore']);

  if (Array.isArray(input.categories)) {
    for (const c of input.categories.slice(0, 1000)) {
      if (isObj(c) && isStr(c.id) && isStr(c.name) && isStr(c.group) && isStr(c.type) && catTypes.has(c.type)) {
        cfg.categories.push({ id: c.id, name: c.name, group: c.group, type: c.type as Category['type'] });
      }
    }
  }
  if (Array.isArray(input.periods)) {
    for (const p of input.periods.slice(0, 1000)) {
      if (isObj(p) && isStr(p.id) && isStr(p.name) && isDate(p.from) && isDate(p.to)) {
        cfg.periods.push({ id: p.id, name: p.name, from: p.from, to: p.to } satisfies Period);
      }
    }
  }
  if (Array.isArray(input.rules)) {
    for (const r of input.rules.slice(0, 20000)) {
      if (!isObj(r) || !isStr(r.id) || !isStr(r.categoryId)) continue;
      const rule: Rule = { id: r.id, categoryId: r.categoryId };
      if (isStr(r.name) && r.name) rule.name = r.name;
      if (isStr(r.contains) && r.contains) rule.contains = r.contains;
      if (isStr(r.kind) && (KINDS as readonly string[]).includes(r.kind)) rule.kind = r.kind as Rule['kind'];
      if (r.direction === 'in' || r.direction === 'out') rule.direction = r.direction;
      if (isInt(r.minAmount)) rule.minAmount = r.minAmount;
      if (isInt(r.maxAmount)) rule.maxAmount = r.maxAmount;
      if (isDate(r.from)) rule.from = r.from;
      if (isDate(r.to)) rule.to = r.to;
      if (isStr(r.periodId)) rule.periodId = r.periodId;
      if (isStr(r.note)) rule.note = r.note;
      if (isInt(r.priority)) rule.priority = r.priority;
      cfg.rules.push(rule);
    }
  }
  if (isObj(input.aliases)) {
    for (const [k, v] of Object.entries(input.aliases).slice(0, 50000)) if (isStr(v)) cfg.aliases[k] = v;
  }
  if (isObj(input.overrides)) {
    for (const [k, v] of Object.entries(input.overrides).slice(0, 200000)) if (isStr(v)) cfg.overrides[k] = v;
  }
  return cfg;
}

/** Layer `incoming` over `base`: same id replaces, new ids are added. */
export function mergeConfig(base: Config, incoming: Config): Config {
  const byId = <T extends { id: string }>(a: T[], b: T[]): T[] => {
    const m = new Map(a.map((x) => [x.id, x]));
    for (const x of b) m.set(x.id, x);
    return [...m.values()];
  };
  return {
    version: 1,
    categories: byId(base.categories, incoming.categories),
    rules: byId(base.rules, incoming.rules),
    periods: byId(base.periods, incoming.periods),
    aliases: { ...base.aliases, ...incoming.aliases },
    overrides: { ...base.overrides, ...incoming.overrides },
  };
}

export type LoadedJson =
  | { type: 'workspace'; rows: RawRow[]; config: Config }
  | { type: 'config'; config: Config };

/** Read a workspace or config file. Throws FormatError on anything unexpected. */
export function parseJsonFile(text: string): LoadedJson {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new FormatError('Not valid JSON.');
  }
  if (!isObj(data)) throw new FormatError('Unexpected file contents.');
  if (data.version !== 1) throw new FormatError(`Unsupported version: ${String(data.version)}.`);

  if (data.format === CONFIG_FORMAT) {
    return { type: 'config', config: sanitiseConfig(data.config) };
  }
  if (data.format === WORKSPACE_FORMAT) {
    if (!Array.isArray(data.transactions)) throw new FormatError('Workspace has no transactions.');
    if (data.transactions.length > MAX_ITEMS) throw new FormatError('Workspace is too large.');
    const rows: RawRow[] = [];
    for (const t of data.transactions) {
      if (
        isObj(t) &&
        isDate(t.date) &&
        isDate(t.valueDate) &&
        isStr(t.description) &&
        isInt(t.amount) &&
        isInt(t.balance)
      ) {
        rows.push({
          date: t.date,
          valueDate: t.valueDate,
          description: t.description,
          amount: t.amount,
          balance: t.balance,
          available: isInt(t.available) ? t.available : null,
          bankCategory: isStr(t.bankCategory) ? t.bankCategory : '',
        });
      } else {
        throw new FormatError('Workspace contains a malformed transaction.');
      }
    }
    return { type: 'workspace', rows, config: sanitiseConfig(data.config) };
  }
  throw new FormatError('Not a budget workspace or config file.');
}

/** Spreadsheet formula injection: a cell that starts with one of these is treated as a formula. */
function safeCell(s: string): string {
  return /^[=+@\t\r]/.test(s) || /^-[^0-9]/.test(s) ? `'${s}` : s;
}

function cell(s: string, delim: string): string {
  const v = safeCell(s);
  return v.includes(delim) || v.includes('"') || v.includes('\n') ? `"${v.replace(/"/g, '""')}"` : v;
}

export function amountText(c: number, decimal: ',' | '.'): string {
  const s = (c / 100).toFixed(2);
  return decimal === ',' ? s.replace('.', ',') : s;
}

/** One flat CSV of everything. UTF-8 with BOM so Excel reads accents. */
export function toFlatCsv(
  rows: Row[],
  config: Config,
  opts: { decimal: ',' | '.' } = { decimal: ',' },
): string {
  const cats = new Map(config.categories.map((c) => [c.id, c]));
  const delim = ';';
  const head = [
    'date',
    'value_date',
    'description',
    'name',
    'kind',
    'amount',
    'balance',
    'category',
    'group',
    'type',
    'source',
    'bank_category',
  ];
  const lines = [head.join(delim)];
  for (const r of rows) {
    const c = r.categoryId ? cats.get(r.categoryId) : undefined;
    lines.push(
      [
        r.date,
        r.valueDate,
        r.description,
        displayName(r.counterparty ?? r.name, config.aliases),
        r.kind,
        amountText(r.amount, opts.decimal),
        amountText(r.balance, opts.decimal),
        c?.name ?? '',
        c?.group ?? '',
        typeOf(r, cats),
        r.source ?? '',
        r.bankCategory,
      ]
        .map((v) => cell(String(v), delim))
        .join(delim),
    );
  }
  return '﻿' + lines.join('\r\n') + '\r\n';
}
