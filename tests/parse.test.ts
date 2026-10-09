import { describe as suite, expect, it } from 'vitest';
import { decodeBytes, parseBankCsv } from '../src/core/parse.ts';
import { formatCents, parseAmountCents, parseDate } from '../src/core/text.ts';
import { cp1252, makeCsv, utf8 } from './helpers.ts';

suite('parseAmountCents', () => {
  it('reads Portuguese numbers into integer cents', () => {
    expect(parseAmountCents('1.891,47')).toBe(189147);
    expect(parseAmountCents('66,03')).toBe(6603);
    expect(parseAmountCents('6.000,00')).toBe(600000);
    expect(parseAmountCents('1.234.567,89')).toBe(123456789);
    expect(parseAmountCents('0,05')).toBe(5);
    expect(parseAmountCents('12')).toBe(1200);
    expect(parseAmountCents('12,5')).toBe(1250);
  });
  it('keeps the sign of negative balances', () => {
    expect(parseAmountCents('-477,50')).toBe(-47750);
    expect(parseAmountCents('-0,01')).toBe(-1);
  });
  it('ignores a currency suffix', () => {
    expect(parseAmountCents('2.480,61 EUR')).toBe(248061);
  });
  it('refuses dot-decimal and junk instead of guessing', () => {
    expect(parseAmountCents('12.50')).toBeNull();
    expect(parseAmountCents('1,234.56')).toBeNull();
    expect(parseAmountCents('abc')).toBeNull();
    expect(parseAmountCents('')).toBeNull();
  });
  it('has no floating point drift', () => {
    // 0.1 + 0.2 style traps: sum a thousand 0,10 amounts.
    let sum = 0;
    for (let i = 0; i < 1000; i++) sum += parseAmountCents('0,10') as number;
    expect(sum).toBe(10000);
  });
});

suite('formatCents', () => {
  it('round-trips with the parser', () => {
    for (const c of [0, 5, 100, 189147, 123456789, -47750]) {
      expect(parseAmountCents(formatCents(c))).toBe(c);
    }
  });
});

suite('parseDate', () => {
  it('converts DD-MM-YYYY to ISO', () => {
    expect(parseDate('30-12-2024')).toBe('2024-12-30');
    expect(parseDate('01-01-2018')).toBe('2018-01-01');
  });
  it('rejects impossible dates', () => {
    expect(parseDate('31-02-2024')).toBeNull();
    expect(parseDate('2024-12-30')).toBeNull();
    expect(parseDate('')).toBeNull();
  });
});

suite('decodeBytes', () => {
  it('reads Windows-1252 when the bytes are not valid UTF-8', () => {
    expect(decodeBytes(cp1252('Descrição;Débito'))).toBe('Descrição;Débito');
  });
  it('reads UTF-8 and strips a BOM', () => {
    expect(decodeBytes(utf8('﻿Descrição'))).toBe('Descrição');
  });
});

suite('parseBankCsv', () => {
  const ops = [
    { date: '2030-03-01', desc: 'COMPRA ACME MARKET', amount: -1250 },
    { date: '2030-03-02', desc: 'TRF MBWAY 912xxx345', amount: 5000 },
    { date: '2030-03-02', desc: 'CAFE EXEMPLO', amount: -180, valueDate: '2030-02-28' },
  ];

  it('reads a bare export, newest first', () => {
    const f = parseBankCsv(makeCsv(ops), 'a.csv');
    expect(f.issues).toEqual([]);
    expect(f.rows).toHaveLength(3);
    expect(f.rows[0]?.description).toBe('CAFE EXEMPLO');
    expect(f.rows[0]?.amount).toBe(-180);
    expect(f.rows[0]?.valueDate).toBe('2030-02-28');
    expect(f.rows[2]?.amount).toBe(-1250);
  });

  it('skips a preamble and footer and reads the period and closing balance', () => {
    const f = parseBankCsv(makeCsv(ops, { preamble: true, footer: true }), 'a.csv');
    expect(f.rows).toHaveLength(3);
    expect(f.meta.rangeStart).toBe('2030-03-01');
    expect(f.meta.rangeEnd).toBe('2030-03-02');
    expect(f.meta.closingBalance).toBe(f.rows[0]?.balance);
    expect(f.issues).toEqual([]);
  });

  it('does not mistake footer lines for transactions', () => {
    const f = parseBankCsv(makeCsv(ops, { footer: true }), 'a.csv');
    expect(f.rows.map((r) => r.description)).not.toContain('');
    expect(f.rows).toHaveLength(3);
  });

  it('parses negative balances', () => {
    const f = parseBankCsv(makeCsv([{ date: '2030-03-01', desc: 'X', amount: -5000 }], { start: 1000 }), 'a.csv');
    expect(f.rows[0]?.balance).toBe(-4000);
  });

  it('copes with LF endings and a blank last line', () => {
    const f = parseBankCsv(makeCsv(ops, { eol: '\n' }) + '\n\n', 'a.csv');
    expect(f.rows).toHaveLength(3);
  });

  it('finds the header even when its accents were mis-decoded', () => {
    const mangled = makeCsv(ops).replace('Descrição', 'Descri��o').replace('Débito', 'D�bito');
    expect(parseBankCsv(mangled, 'a.csv').rows).toHaveLength(3);
  });

  it('reports a row it cannot read instead of dropping it silently', () => {
    const csv = makeCsv(ops).replace('12,50', '12.50x');
    const f = parseBankCsv(csv, 'a.csv');
    expect(f.rows).toHaveLength(2);
    expect(f.issues).toHaveLength(1);
    expect(f.issues[0]?.level).toBe('error');
  });

  it('reports a file with no header', () => {
    const f = parseBankCsv('a;b;c\n1;2;3\n', 'x.csv');
    expect(f.rows).toHaveLength(0);
    expect(f.issues[0]?.level).toBe('error');
  });
});
