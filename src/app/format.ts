import { formatCents } from '../core/text.ts';

/** `1.234,56 €` */
export const eur = (c: number, o: { sign?: boolean } = {}): string => `${formatCents(c, o)} €`;

/** `1.235 €`, for axes and tight spaces. */
export function eurWhole(c: number): string {
  const rounded = Math.round(c / 100);
  return `${formatCents(rounded * 100).replace(/,00$/, '')} €`;
}

/** `YYYY-MM-DD` to `DD-MM-YYYY`, the way the bank prints it. */
export const dmy = (iso: string): string => iso.split('-').reverse().join('-');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `2024-03` -> `Mar 2024`; quarters and years pass through. */
export function bucketLabel(b: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(b);
  if (!m) return b;
  return `${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

export function pct(part: number, whole: number): string {
  return whole === 0 ? '0%' : `${Math.round((100 * part) / whole)}%`;
}

export function download(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const today = (): string => new Date().toISOString().slice(0, 10);
