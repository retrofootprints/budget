import { describe as suite, expect, it } from 'vitest';
import { buildNameCanon, describe, nameMatches } from '../src/core/normalize.ts';

suite('describe', () => {
  it('gives the same merchant across the three wordings of a card purchase', () => {
    const a = describe('COMPRA ACME MARKET');
    const b = describe('COMPRAS C DEB ACME MARKET');
    const c = describe('ACME MARKET', 'COMPRAS');
    expect(a.kind).toBe('purchase');
    expect(b.kind).toBe('purchase');
    expect(c.kind).toBe('purchase');
    expect(new Set([a.name, b.name, c.name])).toEqual(new Set(['ACME MARKET']));
  });

  it('treats P2P and MBWAY phone transfers as one counterparty regardless of case', () => {
    const a = describe('TRF P2P 912xxx345');
    const b = describe('TRF MBWAY 912XXX345');
    const c = describe('Trf Mbway 912xxx345');
    for (const d of [a, b, c]) {
      expect(d.kind).toBe('phone-transfer');
      expect(d.counterparty).toBe('912XXX345');
      expect(d.name).toBe('912XXX345');
    }
  });

  it('handles a phone transfer with no number', () => {
    const d = describe('TRF MBWAY');
    expect(d.kind).toBe('phone-transfer');
    expect(d.counterparty).toBeNull();
  });

  it('reads named transfers, whichever prefix', () => {
    expect(describe('TRF ACME PAYROLL LD').counterparty).toBe('ACME PAYROLL LD');
    expect(describe('TFI JANE EXAMPLE').kind).toBe('transfer');
    expect(describe('TRANSFERENCIA').name).toBe('TRANSFERENCIA');
  });

  it('classifies fees before anything else', () => {
    expect(describe('COMISSAO TRF MBWAY CR').kind).toBe('fee');
    expect(describe('IMPOSTO SELO S COMISS').kind).toBe('fee');
    expect(describe('MANUT CONTA PACOTE CA').kind).toBe('fee');
  });

  it('recognises term deposit movements and their references', () => {
    expect(describe('Abr DepPrazo Online').kind).toBe('term-deposit');
    expect(describe('Lev DepPrazo Online').kind).toBe('term-deposit');
    const cap = describe('CAP0014 0864000000001');
    expect(cap.kind).toBe('term-deposit');
    expect(cap.name).toBe('CAP# #');
    expect(describe('JUR0033 0864000000001').kind).toBe('term-deposit');
  });

  it('recognises cash withdrawals and keeps the place', () => {
    const d = describe('LEVANTAMENTO Some Store');
    expect(d.kind).toBe('cash');
    expect(d.name).toBe('SOME STORE');
  });

  it('flags reversals and keeps them on the same merchant', () => {
    const d = describe('ANUL COMPRA ACME KEBAB');
    expect(d.reversal).toBe(true);
    expect(d.kind).toBe('purchase');
    expect(d.name).toBe('ACME KEBAB');
    expect(describe('DEVOLUCAO COMISSAO TR').reversal).toBe(true);
  });

  it('does not treat a merchant that merely starts with DEV as a reversal', () => {
    expect(describe('DEVICE SHOP').reversal).toBe(false);
  });

  it('folds punctuation variants together', () => {
    expect(describe('BX VALOR 03 TRANSACCO').name).toBe(describe('BX VALOR 03-TRANSACCO').name);
  });

  it('collapses long digit references', () => {
    expect(describe('PGT2412200000318').name).toBe(describe('PGT2501010000999').name);
  });
});

suite('nameMatches', () => {
  it('matches truncations of one name', () => {
    expect(nameMatches('CORNER BAKERY', 'CORNER BAK')).toBe(true);
    expect(nameMatches('CORNER BAK', 'CORNER BAKERY')).toBe(true);
  });
  it('does not match unrelated or very short names', () => {
    expect(nameMatches('CORNER BAKERY', 'CORNER SHOP')).toBe(false);
    expect(nameMatches('EDP', 'EDP COMERCIAL')).toBe(false);
  });
});

suite('buildNameCanon', () => {
  it('maps truncated names to the longest form', () => {
    const c = buildNameCanon(['CORNER BAK', 'CORNER BAKERY', 'OTHER PLACE']);
    expect(c.get('CORNER BAK')).toBe('CORNER BAKERY');
    expect(c.get('CORNER BAKERY')).toBe('CORNER BAKERY');
    expect(c.get('OTHER PLACE')).toBe('OTHER PLACE');
  });
});
