import { describe as suite, expect, it } from 'vitest';
import { categorise } from '../src/core/categorise.ts';
import { defaultConfig, BUILTIN_RULES, DEFAULT_CATEGORIES } from '../src/core/defaults.ts';
import { ingest } from '../src/core/ingest.ts';
import type { Workspace } from '../src/core/ingest.ts';
import {
  FormatError,
  parseJsonFile,
  sanitiseConfig,
  serialiseConfig,
  serialiseWorkspace,
  toFlatCsv,
} from '../src/core/workspace.ts';
import { KINDS } from '../src/core/types.ts';
import { cp1252, makeCsv, utf8 } from './helpers.ts';

const ops = [
  { date: '2030-03-01', desc: 'COMPRA ACME MARKET', amount: -1250 },
  { date: '2030-03-02', desc: 'TRF MBWAY 912xxx345', amount: 5000 },
  { date: '2030-03-02', desc: '=HYPERLINK("http://x")', amount: -100 },
];

function loaded(): Workspace {
  const config = defaultConfig();
  config.aliases['912XXX345'] = 'Test Person';
  config.rules.push({ id: 'r1', name: 'ACME MARKET', categoryId: 'groceries' });
  config.periods.push({ id: 'p1', name: 'Trip', from: '2030-03-01', to: '2030-03-31' });
  return ingest({ txs: [], config }, 'a.csv', cp1252(makeCsv(ops))).ws;
}

suite('workspace file', () => {
  it('round-trips transactions, order and config', () => {
    const ws = loaded();
    const text = serialiseWorkspace(ws.txs, ws.config);
    const back = ingest({ txs: [], config: defaultConfig() }, 'w.json', utf8(text));
    expect(back.report.type).toBe('workspace');
    expect(back.ws.txs.map((t) => t.id)).toEqual(ws.txs.map((t) => t.id));
    expect(back.ws.txs.map((t) => t.amount)).toEqual(ws.txs.map((t) => t.amount));
    expect(back.ws.config.aliases['912XXX345']).toBe('Test Person');
    expect(back.ws.config.rules).toHaveLength(1);
    expect(back.ws.config.periods).toHaveLength(1);
  });

  it('merges with a CSV that overlaps it without duplicating', () => {
    const ws = loaded();
    const text = serialiseWorkspace(ws.txs, ws.config);
    const a = ingest({ txs: [], config: defaultConfig() }, 'w.json', utf8(text));
    const b = ingest(a.ws, 'a.csv', cp1252(makeCsv(ops)));
    expect(b.report.added).toBe(0);
    expect(b.ws.txs).toHaveLength(3);
  });

  it('a config file adds rules and aliases without touching transactions', () => {
    const ws = loaded();
    const text = serialiseConfig({ ...defaultConfig(), aliases: { X: 'Y' } });
    const r = ingest(ws, 'c.json', utf8(text));
    expect(r.report.type).toBe('config');
    expect(r.ws.txs).toBe(ws.txs);
    expect(r.ws.config.aliases['X']).toBe('Y');
    expect(r.ws.config.aliases['912XXX345']).toBe('Test Person');
  });

  it('rejects files that are not ours', () => {
    expect(() => parseJsonFile('{"a":1}')).toThrow(FormatError);
    expect(() => parseJsonFile('not json')).toThrow(FormatError);
    expect(() => parseJsonFile('{"format":"budget-workspace","version":2}')).toThrow(FormatError);
  });

  it('refuses a workspace with a malformed transaction', () => {
    const bad = JSON.stringify({
      format: 'budget-workspace',
      version: 1,
      transactions: [{ date: 'x', amount: 'lots' }],
      config: {},
    });
    expect(() => parseJsonFile(bad)).toThrow(FormatError);
  });
});

suite('sanitiseConfig', () => {
  it('drops unknown fields and wrongly typed entries', () => {
    const c = sanitiseConfig({
      categories: [{ id: 'a', name: 'A', group: 'G', type: 'expense', extra: 1 }, { id: 'b' }, 'junk'],
      rules: [{ id: 'r', categoryId: 'a', name: 'X', kind: 'nonsense', minAmount: 'big', __proto__: { x: 1 } }],
      aliases: { ok: 'name', bad: 5 },
      overrides: { t1: 'a', t2: 7 },
      periods: [{ id: 'p', name: 'P', from: '2030-01-01', to: 'not-a-date' }],
      unknown: 'x',
    });
    expect(c.categories).toEqual([{ id: 'a', name: 'A', group: 'G', type: 'expense' }]);
    expect(c.rules).toEqual([{ id: 'r', categoryId: 'a', name: 'X' }]);
    expect(c.aliases).toEqual({ ok: 'name' });
    expect(c.overrides).toEqual({ t1: 'a' });
    expect(c.periods).toEqual([]);
    expect(Object.keys(c)).not.toContain('unknown');
  });

  it('does not let __proto__ keys pollute', () => {
    const c = sanitiseConfig(JSON.parse('{"aliases":{"__proto__":"x","a":"b"}}'));
    expect(({} as Record<string, unknown>)['x']).toBeUndefined();
    expect(c.aliases['a']).toBe('b');
  });
});

suite('flat CSV', () => {
  it('has one row per transaction with category and a decimal comma', () => {
    const ws = loaded();
    const { rows } = categorise(ws.txs, ws.config);
    const text = toFlatCsv(rows, ws.config, { decimal: ',' });
    const lines = text.replace('﻿', '').trim().split('\r\n');
    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain('category');
    expect(text).toContain('-12,50');
    expect(text).toContain('Test Person');
    expect(text).toContain('Groceries');
  });

  it('can use a decimal point', () => {
    const ws = loaded();
    const { rows } = categorise(ws.txs, ws.config);
    expect(toFlatCsv(rows, ws.config, { decimal: '.' })).toContain('-12.50');
  });

  it('neutralises spreadsheet formulas in descriptions', () => {
    const ws = loaded();
    const { rows } = categorise(ws.txs, ws.config);
    const text = toFlatCsv(rows, ws.config);
    expect(text).not.toMatch(/(^|;)=HYPERLINK/m);
    expect(text).toContain("'=HYPERLINK");
  });
});

/**
 * The public app ships with these rules. They must never carry anything personal:
 * no phone numbers, no person-to-person transfers, no references or amounts.
 */
suite('built-in rules are generic', () => {
  it('contain no phone masks, digits or transfer patterns', () => {
    for (const r of BUILTIN_RULES) {
      expect(r.kind === 'phone-transfer' || r.kind === 'transfer').toBe(false);
      for (const text of [r.name, r.contains].filter((v): v is string => typeof v === 'string')) {
        expect(text).not.toMatch(/\d/);
        expect(text).not.toMatch(/X{3}/i);
        expect(text).not.toMatch(/\b(TRF|TFI|MBWAY|P2P)\b/i);
      }
      expect(r.minAmount).toBeUndefined();
      expect(r.maxAmount).toBeUndefined();
      expect(r.from).toBeUndefined();
      expect(r.to).toBeUndefined();
    }
  });

  it('only point at categories that exist, with valid kinds', () => {
    const ids = new Set(DEFAULT_CATEGORIES.map((c) => c.id));
    for (const r of BUILTIN_RULES) {
      expect(ids.has(r.categoryId)).toBe(true);
      if (r.kind) expect(KINDS).toContain(r.kind);
    }
  });

  it('give every default category a unique id', () => {
    const ids = DEFAULT_CATEGORIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
