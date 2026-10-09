import { describe as suite, expect, it } from 'vitest';
import { coverage, ingest } from '../src/core/ingest.ts';
import type { Workspace } from '../src/core/ingest.ts';
import { defaultConfig } from '../src/core/defaults.ts';
import { findChainBreaks } from '../src/core/merge.ts';
import { formatCents } from '../src/core/text.ts';
import { cp1252, makeCsv, utf8 } from './helpers.ts';
import type { Op } from './helpers.ts';

const empty = (): Workspace => ({ txs: [], config: defaultConfig() });
const load = (ws: Workspace, name: string, csv: string, enc = cp1252) => ingest(ws, name, enc(csv));

const jan: Op[] = [
  { date: '2030-01-03', desc: 'COMPRA ACME MARKET', amount: -2500 },
  { date: '2030-01-10', desc: 'TRF MBWAY 912xxx345', amount: 4000 },
  { date: '2030-01-20', desc: 'COMPRA CORNER CAFE', amount: -350 },
];
const feb: Op[] = [
  { date: '2030-02-04', desc: 'COMPRA ACME MARKET', amount: -3100 },
  { date: '2030-02-15', desc: 'EDP COMERCIAL', amount: -6000 },
];

suite('ingest and merge', () => {
  it('loads a file and the balance chain holds', () => {
    const { ws, report } = load(empty(), 'jan.csv', makeCsv(jan));
    expect(report.type).toBe('bank-csv');
    expect(report.added).toBe(3);
    expect(coverage(ws.txs).breaks).toEqual([]);
  });

  it('loading the same file twice changes nothing', () => {
    const once = load(empty(), 'jan.csv', makeCsv(jan));
    const twice = load(once.ws, 'jan.csv', makeCsv(jan));
    expect(twice.report.added).toBe(0);
    expect(twice.report.duplicates).toBe(3);
    expect(twice.ws.txs.map((t) => t.id)).toEqual(once.ws.txs.map((t) => t.id));
  });

  it('chains consecutive files without a break', () => {
    const a = makeCsv(jan, { start: 100_000 });
    const endBalance = 100_000 + jan.reduce((s, o) => s + o.amount, 0);
    const b = makeCsv(feb, { start: endBalance });
    const ws = load(load(empty(), 'jan.csv', a).ws, 'feb.csv', b).ws;
    expect(ws.txs).toHaveLength(5);
    expect(coverage(ws.txs).breaks).toEqual([]);
  });

  it('merges overlapping files and keeps one copy of the shared rows', () => {
    const all = [...jan, ...feb];
    const first = makeCsv(all.slice(0, 4));
    const second = makeCsv(all.slice(2), { start: 100_000 + all.slice(0, 2).reduce((s, o) => s + o.amount, 0) });
    const ws = load(load(empty(), 'a.csv', first).ws, 'b.csv', second).ws;
    expect(ws.txs).toHaveLength(5);
    expect(coverage(ws.txs).breaks).toEqual([]);
  });

  it('does not depend on the order files are loaded', () => {
    const endBalance = 100_000 + jan.reduce((s, o) => s + o.amount, 0);
    const a = makeCsv(jan, { start: 100_000 });
    const b = makeCsv(feb, { start: endBalance });
    const ab = load(load(empty(), 'a', a).ws, 'b', b).ws;
    const ba = load(load(empty(), 'b', b).ws, 'a', a).ws;
    expect(ba.txs.map((t) => t.id)).toEqual(ab.txs.map((t) => t.id));
    expect(coverage(ba.txs).breaks).toEqual([]);
  });

  it('keeps both rows of a charge / cancel / charge on one day', () => {
    const ops: Op[] = [
      { date: '2030-03-05', desc: 'COMPRA ACME KEBAB', amount: -550 },
      { date: '2030-03-05', desc: 'ANUL COMPRA ACME K', amount: 550 },
      { date: '2030-03-05', desc: 'COMPRA ACME KEBAB', amount: -550 },
    ];
    const first = load(empty(), 'a.csv', makeCsv(ops));
    expect(first.ws.txs).toHaveLength(3);
    const again = load(first.ws, 'a.csv', makeCsv(ops));
    expect(again.ws.txs).toHaveLength(3);
    expect(coverage(again.ws.txs).breaks).toEqual([]);
  });

  it('keeps two genuinely identical purchases on one day', () => {
    const ops: Op[] = [
      { date: '2030-03-05', desc: 'COMPRA ACME MARKET', amount: -500 },
      { date: '2030-03-05', desc: 'COMPRA ACME MARKET', amount: -500 },
    ];
    expect(load(empty(), 'a.csv', makeCsv(ops)).ws.txs).toHaveLength(2);
  });

  it('takes the larger count when one export was taken mid-day', () => {
    const one: Op[] = [{ date: '2030-03-05', desc: 'COMPRA ACME MARKET', amount: -500 }];
    const two: Op[] = [...one, ...one];
    const ws = load(load(empty(), 'early.csv', makeCsv(one)).ws, 'late.csv', makeCsv(two)).ws;
    expect(ws.txs).toHaveLength(2);
  });

  it('recognises the same transaction even if the bank changed its letter case', () => {
    const a = load(empty(), 'a.csv', makeCsv([{ date: '2030-03-05', desc: 'TRF MBWAY 912XXX345', amount: -500 }]));
    const b = load(a.ws, 'b.csv', makeCsv([{ date: '2030-03-05', desc: 'Trf Mbway 912xxx345', amount: -500 }]));
    expect(b.ws.txs).toHaveLength(1);
  });

  it('puts same-day rows in chain order even when files disagree about it', () => {
    const day: Op[] = [
      { date: '2030-03-05', desc: 'COMPRA ONE', amount: -100 },
      { date: '2030-03-05', desc: 'COMPRA TWO', amount: -200 },
      { date: '2030-03-05', desc: 'COMPRA THREE', amount: -400 },
    ];
    const ws = load(empty(), 'a.csv', makeCsv(day)).ws;
    expect(ws.txs.map((t) => t.description)).toEqual(['COMPRA ONE', 'COMPRA TWO', 'COMPRA THREE']);
    expect(findChainBreaks(ws.txs)).toEqual([]);
  });

  it('flags a missing stretch and says how much is unaccounted for', () => {
    const a = makeCsv(jan, { start: 100_000 });
    const endBalance = 100_000 + jan.reduce((s, o) => s + o.amount, 0);
    // February export that starts 70,00 below where January ended: one posting is missing.
    const b = makeCsv(feb, { start: endBalance - 7000 });
    const ws = load(load(empty(), 'jan.csv', a).ws, 'feb.csv', b).ws;
    const c = coverage(ws.txs);
    expect(c.breaks).toHaveLength(1);
    expect(c.breaks[0]?.missing).toBe(-7000);
    expect(c.breaks[0]?.beforeDate).toBe('2030-01-20');
    expect(c.breaks[0]?.afterDate).toBe('2030-02-04');
  });

  it('lists months with no rows inside the loaded range', () => {
    const mar: Op[] = [{ date: '2030-04-02', desc: 'COMPRA X', amount: -100 }];
    const ws = load(load(empty(), 'jan.csv', makeCsv(jan)).ws, 'apr.csv', makeCsv(mar)).ws;
    expect(coverage(ws.txs).missingMonths).toEqual(['2030-02', '2030-03']);
  });

  it('checks the footer closing balance against the newest row', () => {
    const ok = load(empty(), 'a.csv', makeCsv(jan, { footer: true }));
    expect(ok.report.closingCheck).toBe('ok');
    const final = formatCents(100_000 + jan.reduce((s, o) => s + o.amount, 0));
    const bad = makeCsv(jan, { footer: true }).replaceAll(`${final} EUR`, '9.999,99 EUR');
    expect(bad).toContain('9.999,99 EUR');
    expect(load(empty(), 'a.csv', bad).report.closingCheck).toBe('mismatch');
  });

  it('reads UTF-8 and Windows-1252 files the same way', () => {
    const csv = makeCsv([{ date: '2030-03-05', desc: 'COMPRA PADARIA AÇORES', amount: -500 }]);
    const a = load(empty(), 'a.csv', csv, cp1252).ws.txs[0]?.description;
    const b = load(empty(), 'b.csv', csv, utf8).ws.txs[0]?.description;
    expect(a).toBe('COMPRA PADARIA AÇORES');
    expect(b).toBe(a);
  });

  it('reports a file it cannot use without touching the workspace', () => {
    const start = load(empty(), 'jan.csv', makeCsv(jan)).ws;
    const r = ingest(start, 'junk.csv', cp1252('hello;world\n1;2\n'));
    expect(r.report.type).toBe('unrecognised');
    expect(r.ws).toBe(start);
  });
});
