import type { Described, Kind } from './types.ts';
import { foldText } from './text.ts';

/** Long digit runs are references, not identity. `JUR0033 0864...` -> `JUR# #`. */
function collapseRefs(s: string): string {
  return s.replace(/\d{4,}/g, '#');
}

const REVERSAL_ANY = /^(ANUL|ANULACAO) (.+)$/;
const REVERSAL_KNOWN = /^(DEV|DEVOL|DEVOLUCAO) ((?:COMPRAS?|COMISS|IMPOSTO|DISP|LEVANT|TRF|MANUT|PAG).*)$/;
const MASK = /\b(\d{3})X{3}(\d{3})\b/;

/**
 * Turn a bank description into a stable kind and entity name. The same wording
 * changes the bank made over the years (`COMPRA X`, `COMPRAS C DEB X`, bare `X`;
 * `TRF P2P` / `TRF MBWAY`) all land on the same name.
 */
export function describe(description: string, bankCategory = ''): Described {
  const norm = foldText(description);
  let rest = norm;
  let reversal = false;

  const rev = REVERSAL_ANY.exec(rest) ?? REVERSAL_KNOWN.exec(rest);
  if (rev) {
    reversal = true;
    rest = rev[2] as string;
  }

  const make = (kind: Kind, name: string, counterparty: string | null = null): Described => ({
    kind,
    name: name || norm || '(empty)',
    counterparty,
    reversal,
    norm,
  });

  // Fees and taxes on the account itself.
  if (/^(COMISS|IMPOSTO SELO|MANUT CONTA|DESPESAS|ENCARGOS|JUROS DEVEDORES)/.test(rest)) {
    return make('fee', collapseRefs(rest));
  }

  // Phone transfers (TRF P2P / TRF MBWAY / TRF MB WAY).
  const phone = /^TRF (?:P2P|MBWAY|MB WAY)(?: (.*))?$/.exec(rest);
  if (phone) {
    const tail = phone[1] ?? '';
    const m = MASK.exec(tail);
    if (m) {
      const mask = `${m[1]}XXX${m[2]}`;
      return make('phone-transfer', mask, mask);
    }
    return make('phone-transfer', tail ? collapseRefs(tail) : 'MBWAY');
  }

  // Term deposits: opening, withdrawal, capital and interest references.
  if (/DEPPRAZO|DEP PRAZO/.test(rest) || /^(CAP|JUR)[A-Z]*\d{3,}/.test(rest)) {
    return make('term-deposit', collapseRefs(rest));
  }

  // Cash.
  const cash = /^(?:LEVANTAMENTO|LEV|ATM)(?: (.*))?$/.exec(rest);
  if (cash) return make('cash', collapseRefs(cash[1] ?? '') || 'ATM');

  // Card purchases, with or without the prefix the bank dropped in mid-2026.
  const buy = /^COMPRAS?(?: C DEB)?(?: (.*))?$/.exec(rest);
  if (buy) return make('purchase', collapseRefs(buy[1] ?? '') || 'COMPRA');

  // Named transfers.
  const trf = /^(?:TRF|TFI|TRANSF|TRANSFERENCIA)(?: (.*))?$/.exec(rest);
  if (trf) {
    const who = collapseRefs(trf[1] ?? '') || 'TRANSFERENCIA';
    return make('transfer', who, who);
  }

  if (bankCategory.trim().toUpperCase() === 'COMPRAS') {
    return make('purchase', collapseRefs(rest));
  }
  return make('other', collapseRefs(rest));
}

/**
 * Two entity names refer to the same thing if equal, or if one is a prefix of the
 * other and the shorter has at least 5 characters. The bank truncates names at a
 * point that moved when the wording changed, so `NAME SHO` and `NAME SHOP` match.
 */
export function nameMatches(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 5 && long.startsWith(short);
}

/**
 * Map every name to the longest name it is a truncation of, so groups shown in
 * the UI do not split one merchant into several.
 */
export function buildNameCanon(names: Iterable<string>): Map<string, string> {
  const unique = [...new Set(names)].sort((a, b) => a.length - b.length || a.localeCompare(b));
  const canon = new Map<string, string>();
  for (let i = 0; i < unique.length; i++) {
    const n = unique[i] as string;
    let best = n;
    for (let j = unique.length - 1; j > i; j--) {
      const longer = unique[j] as string;
      if (longer.length > best.length && nameMatches(n, longer)) {
        best = longer;
        break;
      }
    }
    canon.set(n, best);
  }
  // Resolve chains (A -> B -> C).
  for (const [k, v] of canon) {
    let cur = v;
    for (let guard = 0; guard < 5; guard++) {
      const next = canon.get(cur);
      if (!next || next === cur) break;
      cur = next;
    }
    canon.set(k, cur);
  }
  return canon;
}
