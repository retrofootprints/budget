import { describe as suite, expect, it } from 'vitest';
import { categorise } from '../src/core/categorise.ts';
import { defaultConfig } from '../src/core/defaults.ts';
import type { Config, Rule, Tx } from '../src/core/types.ts';

let n = 0;
function tx(description: string, amount: number, date = '2030-03-10', bankCategory = ''): Tx {
  n++;
  return {
    id: `t${n}`,
    key: `k${n}`,
    occ: 1,
    date,
    valueDate: date,
    description,
    amount,
    balance: 0,
    available: null,
    bankCategory,
    seq: n,
  };
}

function cfg(over: Partial<Config> = {}): Config {
  return { ...defaultConfig(), ...over };
}
const rule = (r: Partial<Rule> & { categoryId: string }): Rule => ({ id: `r${++n}`, ...r });
const cat = (c: Config, t: Tx) => categorise([t], c).rows[0];

suite('categorise', () => {
  it('leaves unknown things uncategorised', () => {
    expect(cat(cfg(), tx('COMPRA SOMEWHERE ODD', -500))?.categoryId).toBeNull();
  });

  it('applies built-in generic rules', () => {
    expect(cat(cfg(), tx('COMPRA PINGO DOCE LOJA', -500))?.categoryId).toBe('groceries');
    expect(cat(cfg(), tx('VODAFONE PORTUGAL COM', -4000))?.categoryId).toBe('telecom');
    expect(cat(cfg(), tx('COMISSAO TRF MBWAY CR', -8))?.categoryId).toBe('fees');
  });

  it('matches whole words, not substrings', () => {
    // "MEO" is a telecom rule; it must not fire inside another word.
    expect(cat(cfg(), tx('COMPRA HOMEOPATIA CENTRO', -900))?.categoryId).not.toBe('telecom');
    expect(cat(cfg(), tx('MEO SERVICOS', -3000))?.categoryId).toBe('telecom');
  });

  it('user rules beat built-in rules', () => {
    const c = cfg({ rules: [rule({ name: 'PINGO DOCE LOJA', categoryId: 'dining' })] });
    expect(cat(c, tx('COMPRA PINGO DOCE LOJA', -500))?.categoryId).toBe('dining');
  });

  it('manual overrides beat every rule', () => {
    const t = tx('COMPRA PINGO DOCE LOJA', -500);
    const c = cfg({ overrides: { [t.id]: 'leisure' } });
    const r = cat(c, t);
    expect(r?.categoryId).toBe('leisure');
    expect(r?.source).toBe('override');
  });

  it('a rule written for one wording matches the truncated and the full name', () => {
    const c = cfg({ rules: [rule({ name: 'CORNER BAKERY', categoryId: 'cafes' })] });
    expect(cat(c, tx('COMPRA CORNER BAK', -200))?.categoryId).toBe('cafes');
    expect(cat(c, tx('CORNER BAKERY', -200, '2030-07-01', 'COMPRAS'))?.categoryId).toBe('cafes');
  });

  it('a rule for a phone number follows it across the P2P / MBWAY rename', () => {
    const c = cfg({ rules: [rule({ name: '912XXX345', categoryId: 'family' })] });
    expect(cat(c, tx('TRF P2P 912xxx345', -2000))?.categoryId).toBe('family');
    expect(cat(c, tx('Trf Mbway 912XXX345', -2000))?.categoryId).toBe('family');
    expect(cat(c, tx('TRF MBWAY 913xxx999', -2000))?.categoryId).toBeNull();
  });

  it('a date-bounded rule beats a general rule for that merchant', () => {
    const c = cfg({
      rules: [
        rule({ name: 'ACME MARKET', categoryId: 'groceries' }),
        rule({ name: 'ACME MARKET', categoryId: 'work-refunds', from: '2030-05-01', to: '2030-05-31' }),
      ],
    });
    expect(cat(c, tx('COMPRA ACME MARKET', -900, '2030-04-30'))?.categoryId).toBe('groceries');
    expect(cat(c, tx('COMPRA ACME MARKET', -900, '2030-05-15'))?.categoryId).toBe('work-refunds');
    expect(cat(c, tx('COMPRA ACME MARKET', -900, '2030-06-01'))?.categoryId).toBe('groceries');
  });

  it('resolves a rule bound to a period', () => {
    const c = cfg({
      periods: [{ id: 'p1', name: 'Trip', from: '2030-05-01', to: '2030-05-31' }],
      rules: [rule({ name: 'ACME MARKET', categoryId: 'work-refunds', periodId: 'p1' })],
    });
    expect(cat(c, tx('COMPRA ACME MARKET', -900, '2030-05-15'))?.categoryId).toBe('work-refunds');
    expect(cat(c, tx('COMPRA ACME MARKET', -900, '2030-06-15'))?.categoryId).toBeNull();
  });

  it('separates credits from debits when asked', () => {
    const c = cfg({
      rules: [
        rule({ name: 'ACME PAYROLL', direction: 'in', categoryId: 'salary' }),
        rule({ name: 'ACME PAYROLL', direction: 'out', categoryId: 'other' }),
      ],
    });
    expect(cat(c, tx('TRF ACME PAYROLL', 150000))?.categoryId).toBe('salary');
    expect(cat(c, tx('TRF ACME PAYROLL', -2000))?.categoryId).toBe('other');
  });

  it('honours amount bounds', () => {
    const c = cfg({ rules: [rule({ name: 'ACME MARKET', minAmount: 10000, categoryId: 'shopping' })] });
    expect(cat(c, tx('COMPRA ACME MARKET', -500))?.categoryId).toBeNull();
    expect(cat(c, tx('COMPRA ACME MARKET', -25000))?.categoryId).toBe('shopping');
  });

  it('higher priority wins over specificity', () => {
    const c = cfg({
      rules: [
        rule({ name: 'ACME MARKET', categoryId: 'groceries' }),
        rule({ contains: 'ACME', priority: 5, categoryId: 'shopping' }),
      ],
    });
    expect(cat(c, tx('COMPRA ACME MARKET', -500))?.categoryId).toBe('shopping');
  });

  it('ignores a rule with no conditions instead of matching everything', () => {
    const c = cfg({ rules: [rule({ categoryId: 'shopping' })] });
    expect(cat(c, tx('COMPRA ANYTHING', -500))?.categoryId).toBeNull();
  });

  it('ignores a rule pointing at a deleted category', () => {
    const c = cfg({ rules: [rule({ name: 'ACME MARKET', categoryId: 'no-such' })] });
    expect(cat(c, tx('COMPRA ACME MARKET', -500))?.categoryId).toBeNull();
  });

  it('prefix patterns need a trailing asterisk', () => {
    const c = cfg({ rules: [rule({ contains: 'SUBSCR*', categoryId: 'savings-invest' })] });
    expect(cat(c, tx('SUBSCRICACX FUNDO', -50000))?.categoryId).toBe('savings-invest');
  });
});
