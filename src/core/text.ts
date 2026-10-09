import type { Cents } from './types.ts';

/**
 * Parse a Portuguese-formatted amount into integer cents.
 * `1.234,56` -> 123456, `-477,50` -> -47750. A trailing EUR / € is ignored.
 * Returns null for anything that is not clearly a number in that format.
 */
export function parseAmountCents(raw: string): Cents | null {
  const s = raw.replace(/\s+/g, '').replace(/EUR|€/gi, '');
  if (s === '') return null;
  const m = /^([+-])?(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const whole = Number((m[2] as string).replace(/\./g, ''));
  const frac = Number(((m[3] ?? '') + '00').slice(0, 2));
  const cents = whole * 100 + frac;
  if (!Number.isSafeInteger(cents)) return null;
  return m[1] === '-' ? -cents : cents;
}

/** `DD-MM-YYYY` (also `/` or `.`) to `YYYY-MM-DD`, or null if not a real date. */
export function parseDate(raw: string): string | null {
  const m = /^(\d{2})[-/.](\d{2})[-/.](\d{4})$/.exec(raw.trim());
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  const y = Number(m[3]);
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/** Fold case and diacritics, turn anything non-alphanumeric into a space. */
export function foldText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

/** Small, fast, non-cryptographic 53-bit hash, base 36. */
export function hash53(str: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** Cents to `1.234,56`. */
export function formatCents(c: Cents, opts: { sign?: boolean } = {}): string {
  const neg = c < 0;
  const abs = Math.abs(c);
  const whole = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const frac = String(abs % 100).padStart(2, '0');
  const sign = neg ? '-' : opts.sign && c > 0 ? '+' : '';
  return `${sign}${whole},${frac}`;
}
