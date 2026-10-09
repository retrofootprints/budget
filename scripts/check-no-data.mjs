#!/usr/bin/env node
// Fails if anything that looks like bank data is tracked or staged.
//
//   node scripts/check-no-data.mjs            checks every tracked file (CI)
//   node scripts/check-no-data.mjs --staged   checks what is about to be committed (hook)
//
// Synthetic fixtures under tests/fixtures/ are the only data files allowed.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const staged = process.argv.includes('--staged');

const git = (args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

const files = staged
  ? git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z']).split('\0').filter(Boolean)
  : git(['ls-files', '-z']).split('\0').filter(Boolean);

const DATA_EXT = /\.(csv|tsv|xls|xlsx|ofx|qif|sqlite3?|db)$/i;
const EXPORT_NAME = /(^|\/)budget-(workspace|config|transactions)[^/]*\.json$/i;
const ALLOWED = /^tests\/fixtures\//;

// Content signatures of the bank export and of our own exports. A header on its
// own is just the format's column names (tests and docs mention it); what matters
// is a header followed by real rows, or a workspace holding transaction objects.
const BANK_ROWS = /Data mov\.\s*;\s*Data valor[^\n]*\n(?:[^\n]*\n)?\s*\d{2}-\d{2}-\d{4};\d{2}-\d{2}-\d{4};/i;
const WORKSPACE_DATA = /"format"\s*:\s*"budget-workspace"[\s\S]*"transactions"\s*:\s*\[\s*\{\s*"date"/;
const CONFIG_DATA = /"format"\s*:\s*"budget-config"[\s\S]*"config"\s*:\s*\{/;
// Masked phone number as the bank prints it.
const MASKED_PHONE = /\b9\d{2}[xX]{3}\d{3}\b/;

const problems = [];

for (const f of files) {
  if (ALLOWED.test(f)) continue;
  if (DATA_EXT.test(f)) problems.push(`${f}: data file type`);
  else if (EXPORT_NAME.test(f)) problems.push(`${f}: looks like an exported workspace or config`);
}

for (const f of files) {
  if (ALLOWED.test(f) || /^(package-lock\.json|scripts\/check-no-data\.mjs)$/.test(f)) continue;
  let text;
  try {
    text = staged ? git(['show', `:${f}`]) : readFileSync(f, 'utf8');
  } catch {
    continue;
  }
  if (text.length > 20_000_000 || text.includes('\0')) continue;
  if (BANK_ROWS.test(text)) problems.push(`${f}: contains bank export rows`);
  else if (WORKSPACE_DATA.test(text) || CONFIG_DATA.test(text)) problems.push(`${f}: contains an exported workspace or config`);
  else if (MASKED_PHONE.test(text) && !/^tests\//.test(f)) problems.push(`${f}: contains a masked phone number`);
}

if (problems.length) {
  console.error('\nRefusing: bank data must never be committed.\n');
  for (const p of problems) console.error(`  - ${p}`);
  console.error('\nKeep real exports in data/ (gitignored). Test fixtures must be synthetic and live in tests/fixtures/.\n');
  process.exit(1);
}
console.log(`check-no-data: ${files.length} file(s) checked, none look like bank data.`);
