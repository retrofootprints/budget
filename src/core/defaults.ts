import type { Category, Config, Rule } from './types.ts';

/**
 * Built-in categories and rules ship in the public app, so they are strictly
 * generic: banking mechanics, utilities and nationwide chains. Anything naming a
 * person, a phone number, an employer or a local shop belongs in the user's own
 * config file. tests/builtin-rules.test.ts enforces this.
 */

export const DEFAULT_CATEGORIES: Category[] = [
  { id: 'salary', name: 'Salary', group: 'Income', type: 'income' },
  { id: 'income-interest', name: 'Interest', group: 'Income', type: 'income' },
  { id: 'income-tax', name: 'Tax refunds', group: 'Income', type: 'income' },
  { id: 'income-other', name: 'Other income', group: 'Income', type: 'income' },

  // Counted as an expense category so employer refunds net against the spending
  // they reimburse. Change its type to "income" to see them as income instead.
  { id: 'work-refunds', name: 'Work expense refunds', group: 'Work', type: 'expense' },

  { id: 'housing-loan', name: 'Mortgage and loan payments', group: 'Housing', type: 'expense' },
  { id: 'housing-condo', name: 'Condominium and rent', group: 'Housing', type: 'expense' },
  { id: 'utilities', name: 'Electricity, gas and water', group: 'Housing', type: 'expense' },
  { id: 'telecom', name: 'Phone, TV and internet', group: 'Housing', type: 'expense' },

  { id: 'groceries', name: 'Groceries', group: 'Food', type: 'expense' },
  { id: 'dining', name: 'Restaurants and takeaway', group: 'Food', type: 'expense' },
  { id: 'cafes', name: 'Cafes and bakeries', group: 'Food', type: 'expense' },

  { id: 'fuel', name: 'Fuel', group: 'Transport', type: 'expense' },
  { id: 'transport', name: 'Tolls, parking and transport', group: 'Transport', type: 'expense' },

  { id: 'health', name: 'Health and pharmacy', group: 'Health', type: 'expense' },
  { id: 'insurance', name: 'Insurance', group: 'Insurance', type: 'expense' },
  { id: 'taxes', name: 'Taxes and municipal fees', group: 'Taxes', type: 'expense' },
  { id: 'shopping', name: 'Shopping', group: 'Shopping', type: 'expense' },
  { id: 'family', name: 'Children and family', group: 'Family', type: 'expense' },
  { id: 'leisure', name: 'Leisure and subscriptions', group: 'Leisure', type: 'expense' },

  { id: 'cash', name: 'Cash withdrawals', group: 'Cash', type: 'expense' },
  { id: 'fees', name: 'Bank fees and charges', group: 'Bank', type: 'expense' },
  { id: 'card', name: 'Credit card payments', group: 'Bank', type: 'expense' },
  { id: 'people', name: 'Transfers with people', group: 'People', type: 'expense' },
  { id: 'other', name: 'Other', group: 'Other', type: 'expense' },

  // Money that is only parked: left out of income and spending totals.
  { id: 'savings-deposits', name: 'Term deposits', group: 'Savings', type: 'savings' },
  { id: 'savings-invest', name: 'Investments', group: 'Savings', type: 'savings' },

  { id: 'ignore', name: 'Ignore (not counted)', group: 'Ignore', type: 'ignore' },
];

let n = 0;
const rule = (r: Omit<Rule, 'id'>): Rule => ({ id: `builtin-${++n}`, ...r });

export const BUILTIN_RULES: Rule[] = [
  // Banking mechanics.
  rule({ kind: 'fee', categoryId: 'fees' }),
  rule({ kind: 'cash', categoryId: 'cash' }),
  rule({ kind: 'term-deposit', contains: 'JUR*', categoryId: 'income-interest' }),
  rule({ kind: 'term-deposit', categoryId: 'savings-deposits' }),
  rule({ name: 'C CLASSIC', categoryId: 'card' }),
  rule({ contains: 'SUBSCRICA*', categoryId: 'savings-invest' }),
  rule({ contains: 'REEMBOLSOS IRS', categoryId: 'income-tax' }),
  rule({ name: 'IUC', categoryId: 'taxes' }),
  rule({ name: 'IMI', categoryId: 'taxes' }),
  rule({ contains: 'MUNICIPIO', categoryId: 'taxes' }),
  rule({ contains: 'COBRANCA PRESTACAO', categoryId: 'housing-loan' }),
  rule({ contains: 'CONDOMINIO', categoryId: 'housing-condo' }),

  // Utilities and telecom.
  rule({ contains: 'EDP', categoryId: 'utilities' }),
  rule({ contains: 'GALP', categoryId: 'fuel' }),
  rule({ contains: 'AGUAS', categoryId: 'utilities' }),
  rule({ contains: 'VODAFONE', categoryId: 'telecom' }),
  rule({ contains: 'MEO', categoryId: 'telecom' }),
  rule({ contains: 'NOS COMUNICACOES', categoryId: 'telecom' }),
  rule({ contains: 'NOWO', categoryId: 'telecom' }),

  // Insurance.
  rule({ contains: 'FIDELIDADE', categoryId: 'insurance' }),
  rule({ contains: 'SEGURADORAS', categoryId: 'insurance' }),

  // Supermarkets (nationwide chains).
  rule({ contains: 'PINGO DOCE', categoryId: 'groceries' }),
  rule({ contains: 'CONTINENTE', categoryId: 'groceries' }),
  rule({ contains: 'MODELO HIPER', categoryId: 'groceries' }),
  rule({ contains: 'MODELO CONTINENTE', categoryId: 'groceries' }),
  rule({ contains: 'LIDL', categoryId: 'groceries' }),
  rule({ contains: 'AUCHAN', categoryId: 'groceries' }),
  rule({ contains: 'MERCADONA', categoryId: 'groceries' }),
  rule({ contains: 'INTERMARCHE', categoryId: 'groceries' }),
  rule({ contains: 'MINIPRECO', categoryId: 'groceries' }),

  // Restaurants.
  rule({ contains: 'MCDONALDS', categoryId: 'dining' }),
  rule({ contains: 'BURGER KING', categoryId: 'dining' }),
  rule({ contains: 'PIZZA HUT', categoryId: 'dining' }),
  rule({ contains: 'KFC', categoryId: 'dining' }),
  rule({ contains: 'TELEPIZZA', categoryId: 'dining' }),
  rule({ contains: 'UBER EATS', categoryId: 'dining' }),
  rule({ contains: 'GLOVO', categoryId: 'dining' }),

  // Generic words. Lower specificity than a named merchant, so a user rule or a
  // chain above always wins.
  rule({ contains: 'PASTELARIA', categoryId: 'cafes' }),
  rule({ contains: 'PADARIA', categoryId: 'cafes' }),
  rule({ contains: 'CAFE', categoryId: 'cafes' }),
  rule({ contains: 'CAFETARIA', categoryId: 'cafes' }),
  rule({ contains: 'RESTAURANTE', categoryId: 'dining' }),
  rule({ contains: 'REST', categoryId: 'dining' }),
  rule({ contains: 'CHURRASQUEIRA', categoryId: 'dining' }),
  rule({ contains: 'PIZZARIA', categoryId: 'dining' }),
  rule({ contains: 'SUSHI', categoryId: 'dining' }),
  rule({ contains: 'SUPERMERCADO', categoryId: 'groceries' }),
  rule({ contains: 'MINIMERCADO', categoryId: 'groceries' }),
  rule({ contains: 'CLINICA', categoryId: 'health' }),
  rule({ contains: 'HOSPITAL', categoryId: 'health' }),
  rule({ contains: 'DENTARIA', categoryId: 'health' }),
  rule({ contains: 'OPTICA', categoryId: 'health' }),
  rule({ contains: 'VETERINARIA', categoryId: 'health' }),
  rule({ contains: 'COMBUSTIVEIS', categoryId: 'fuel' }),
  rule({ contains: 'PORTAGENS', categoryId: 'transport' }),

  // Fuel, transport, health.
  rule({ contains: 'REPSOL', categoryId: 'fuel' }),
  rule({ contains: 'VIA VERDE', categoryId: 'transport' }),
  rule({ contains: 'UBER', categoryId: 'transport' }),
  rule({ contains: 'FARMACIA', categoryId: 'health' }),

  // Shopping and subscriptions.
  rule({ contains: 'DECATHLON', categoryId: 'shopping' }),
  rule({ contains: 'ZARA', categoryId: 'shopping' }),
  rule({ contains: 'WORTEN', categoryId: 'shopping' }),
  rule({ contains: 'FNAC', categoryId: 'shopping' }),
  rule({ contains: 'EL CORTE INGLES', categoryId: 'shopping' }),
  rule({ contains: 'IKEA', categoryId: 'shopping' }),
  rule({ contains: 'AMAZON', categoryId: 'shopping' }),
  rule({ contains: 'NETFLIX', categoryId: 'leisure' }),
  rule({ contains: 'SPOTIFY', categoryId: 'leisure' }),
  rule({ contains: 'OPENAI', categoryId: 'leisure' }),
  rule({ contains: 'APPLE COM', categoryId: 'leisure' }),
];

export function defaultConfig(): Config {
  return {
    version: 1,
    categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })),
    rules: [],
    aliases: {},
    periods: [],
    overrides: {},
  };
}
