import { describe as suite, expect, it } from 'vitest';
import { categorise } from '../src/core/categorise.ts';
import { defaultConfig } from '../src/core/defaults.ts';
import { ingest } from '../src/core/ingest.ts';
import type { Workspace } from '../src/core/ingest.ts';
import {
  balanceSeries,
  bucketRange,
  breakdown,
  counterpartyTotals,
  savingsHeld,
  totals,
  totalsByBucket,
  UNCATEGORISED,
} from '../src/core/reports.ts';
import type { Config } from '../src/core/types.ts';
import { cp1252, makeCsv } from './helpers.ts';
import type { Op } from './helpers.ts';

const START = 500_000;
const ops: Op[] = [
  { date: '2030-01-05', desc: 'TRF ACME PAYROLL', amount: 200_000 },
  { date: '2030-01-10', desc: 'COMPRA PINGO DOCE LOJA', amount: -4_500 },
  { date: '2030-01-12', desc: 'VODAFONE PORTUGAL COM', amount: -3_000 },
  { date: '2030-01-15', desc: 'Abr DepPrazo Online', amount: -300_000 },
  { date: '2030-02-15', desc: 'Lev DepPrazo Online', amount: 300_000 },
  { date: '2030-02-15', desc: 'JUR0033 0864000000001', amount: 1_200 },
  { date: '2030-02-16', desc: 'Abr DepPrazo Online', amount: -300_000 },
  { date: '2030-02-20', desc: 'TRF ACME PAYROLL', amount: 200_000 },
  { date: '2030-02-21', desc: 'TRF P2P 912xxx345', amount: -2_000 },
  { date: '2030-02-25', desc: 'TRF MBWAY 912xxx345', amount: 800 },
  { date: '2030-03-02', desc: 'COMPRA SOMEWHERE ODD', amount: -1_000 },
];

function setup(config: Config = defaultConfig()) {
  const ws: Workspace = { txs: [], config };
  const { ws: loaded } = ingest(ws, 'a.csv', cp1252(makeCsv(ops, { start: START })));
  const { rows, categories } = categorise(loaded.txs, config);
  return { rows, categories, txs: loaded.txs };
}

suite('totals', () => {
  it('income minus spending plus savings movement equals the change in balance', () => {
    const { rows, categories, txs } = setup();
    const t = totals(rows, categories);
    const change = (txs[txs.length - 1]?.balance ?? 0) - START;
    expect(t.net + t.savings).toBe(change);
  });

  it('leaves savings out of income and spending', () => {
    const { rows, categories } = setup();
    const t = totals(rows, categories);
    // Salary 400_000 + interest 1_200 + an uncategorised credit of 800 counted as income.
    // The 300k moved out, back and out again is not spending.
    expect(t.income).toBe(402_000);
    expect(t.expense).toBe(4_500 + 3_000 + 2_000 + 1_000);
    expect(t.savings).toBe(-300_000);
  });

  it('counts uncategorised rows and their value', () => {
    const { rows, categories } = setup();
    const t = totals(rows, categories);
    expect(t.uncategorisedCount).toBeGreaterThan(0);
    expect(t.uncategorisedValue).toBeGreaterThan(0);
  });

  it('rolls up by month with no gaps', () => {
    const { rows, categories } = setup();
    const m = totalsByBucket(rows, categories, 'month', '2030-01-01', '2030-03-31');
    expect(m.labels).toEqual(['2030-01', '2030-02', '2030-03']);
    expect(m.values[0]?.income).toBe(200_000);
    expect(m.values[2]?.expense).toBe(1_000);
  });
});

suite('breakdown', () => {
  it('shows spending as positive and refunds reducing it', () => {
    const { rows, categories } = setup();
    const b = breakdown(rows, categories);
    const unc = b.find((l) => l.label === UNCATEGORISED && l.type === 'expense');
    expect(unc).toBeDefined();
    const groceries = b.find((l) => l.id === 'groceries');
    expect(groceries?.amount).toBe(4_500);
  });
});

suite('savings', () => {
  it('tracks the net amount parked over time', () => {
    const { rows, categories } = setup();
    const s = savingsHeld(rows, categories, 'month', '2030-01-01', '2030-03-31');
    expect(s.values).toEqual([300_000, 300_000, 300_000]);
  });
});

suite('counterparties', () => {
  it('totals money in and out per phone number across the rename', () => {
    const { rows } = setup();
    const c = counterpartyTotals(rows, { '912XXX345': 'Test Person' });
    expect(c).toHaveLength(2); // the payroll transfer and the phone number
    const p = c.find((x) => x.name === '912XXX345');
    expect(p?.label).toBe('Test Person');
    expect(p?.inbound).toBe(800);
    expect(p?.outbound).toBe(2_000);
    expect(p?.count).toBe(2);
  });
});

suite('balance series', () => {
  it('carries the balance through empty buckets', () => {
    const { rows } = setup();
    const b = balanceSeries(rows, 'month', '2029-12-01', '2030-04-30');
    expect(b.values[0]?.end).toBeNull();
    expect(b.values[4]?.end).toBe(b.values[3]?.end);
  });
});

suite('bucketRange', () => {
  it('lists every quarter and year in range', () => {
    expect(bucketRange('2029-11-15', '2030-05-01', 'quarter')).toEqual(['2029-Q4', '2030-Q1', '2030-Q2']);
    expect(bucketRange('2028-06-01', '2030-02-01', 'year')).toEqual(['2028', '2029', '2030']);
  });
});
