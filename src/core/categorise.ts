import type { Category, Config, Described, Period, Rule, Tx } from './types.ts';
import { BUILTIN_RULES } from './defaults.ts';
import { describe, nameMatches } from './normalize.ts';
import { foldText } from './text.ts';

export type Source = 'override' | 'rule' | 'builtin' | null;

/** A transaction with everything derived from it. */
export interface Row extends Tx, Described {
  categoryId: string | null;
  source: Source;
  ruleId: string | null;
}

interface Prepared {
  rule: Rule;
  builtin: boolean;
  from?: string;
  to?: string;
  name?: string;
  needle?: string[];
  needlePrefix: boolean;
  score: number;
  order: number;
}

/** Entity names keep `#`, which foldText would drop. */
function cleanName(s: string): string {
  return s.toUpperCase().replace(/\s+/g, ' ').trim();
}

/** Whole-word match of the needle inside the haystack; a trailing `*` allows a prefix. */
function wordsMatch(norm: string, needle: string[], prefixLast: boolean): boolean {
  if (needle.length === 0) return false;
  const hay = norm.split(' ');
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      const h = hay[i + j] as string;
      const n = needle[j] as string;
      const last = j === needle.length - 1;
      if (last && prefixLast ? !h.startsWith(n) : h !== n) continue outer;
    }
    return true;
  }
  return false;
}

/**
 * Specificity: date-bounded beats everything, then how exact the match is. A rule
 * with a higher `priority` always wins; user rules always beat built-ins.
 */
function prepare(rules: Rule[], periods: Map<string, Period>, builtin: boolean): Prepared[] {
  const out: Prepared[] = [];
  rules.forEach((rule, order) => {
    const period = rule.periodId ? periods.get(rule.periodId) : undefined;
    if (rule.periodId && !period) return; // refers to a deleted period
    const from = period?.from ?? rule.from;
    const to = period?.to ?? rule.to;
    const needleRaw = rule.contains ?? '';
    const needlePrefix = needleRaw.trim().endsWith('*');
    const needle = needlePrefix || needleRaw ? foldText(needleRaw).split(' ').filter(Boolean) : undefined;
    const name = rule.name ? cleanName(rule.name) : undefined;
    if (!name && !needle?.length && !rule.kind) return; // would match everything

    let score = 0;
    if (from || to) score += 40;
    if (name) score += 30;
    if (needle?.length) score += 15 + Math.min(needle.join(' ').length, 30) / 100;
    if (rule.kind) score += 5;
    if (rule.direction) score += 10;
    if (rule.minAmount !== undefined || rule.maxAmount !== undefined) score += 10;
    out.push({ rule, builtin, from, to, name, needle, needlePrefix, score, order });
  });
  return out;
}

function sortPrepared(list: Prepared[]): Prepared[] {
  return [...list].sort(
    (a, b) =>
      (b.rule.priority ?? 0) - (a.rule.priority ?? 0) || b.score - a.score || a.order - b.order,
  );
}

function matches(p: Prepared, t: Tx, d: Described): boolean {
  const r = p.rule;
  if (r.kind && r.kind !== d.kind) return false;
  if (p.name && !nameMatches(p.name, d.name)) return false;
  if (p.needle?.length && !wordsMatch(d.norm, p.needle, p.needlePrefix)) return false;
  if (r.direction === 'in' && t.amount < 0) return false;
  if (r.direction === 'out' && t.amount >= 0) return false;
  const abs = Math.abs(t.amount);
  if (r.minAmount !== undefined && abs < r.minAmount) return false;
  if (r.maxAmount !== undefined && abs > r.maxAmount) return false;
  if (p.from && t.date < p.from) return false;
  if (p.to && t.date > p.to) return false;
  return true;
}

export interface Categoriser {
  rows: Row[];
  categories: Map<string, Category>;
}

/**
 * Describe and categorise every transaction.
 * Precedence: manual override, user rules, built-in rules, uncategorised.
 */
export function categorise(txs: Tx[], config: Config): Categoriser {
  const categories = new Map(config.categories.map((c) => [c.id, c]));
  const periods = new Map(config.periods.map((p) => [p.id, p]));
  const user = sortPrepared(prepare(config.rules, periods, false));
  const builtin = sortPrepared(prepare(BUILTIN_RULES, periods, true));

  const rows: Row[] = txs.map((t) => {
    const d = describe(t.description, t.bankCategory);
    const base = { ...t, ...d };

    const ov = config.overrides[t.id];
    if (ov !== undefined && categories.has(ov)) {
      return { ...base, categoryId: ov, source: 'override', ruleId: null };
    }
    for (const p of user) {
      if (categories.has(p.rule.categoryId) && matches(p, t, d)) {
        return { ...base, categoryId: p.rule.categoryId, source: 'rule', ruleId: p.rule.id };
      }
    }
    for (const p of builtin) {
      if (categories.has(p.rule.categoryId) && matches(p, t, d)) {
        return { ...base, categoryId: p.rule.categoryId, source: 'builtin', ruleId: p.rule.id };
      }
    }
    return { ...base, categoryId: null, source: null, ruleId: null };
  });
  return { rows, categories };
}

/** Name to show for an entity: the user's alias if there is one. */
export function displayName(name: string, aliases: Record<string, string>): string {
  return aliases[name] ?? name;
}
