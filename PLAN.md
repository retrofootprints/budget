# Budget app — build plan

A static, offline-capable web app for analysing one checking account from bank
CSV exports. It is served from GitHub Pages, and all data stays in the browser
and in files the user keeps locally.

## Hard rules

1. **No bank data in the repo, ever.** No real transactions, names, phone
   numbers, account numbers or amounts in code, tests, docs or commit messages.
   Real exports live in `data/` (gitignored). Test fixtures are made up.
2. **The page sends nothing anywhere.** No backend, analytics, third-party
   scripts, fonts or CDNs. A content security policy restricts connections to
   the page's own origin, which the service worker needs to cache the app.
3. **Built-in rules are generic only.** Rules shipped in the public app cover
   merchants and utilities. Anything naming a person or a phone number stays in
   the user's private config file. A test fails if a built-in rule contains a
   masked phone number or a person-to-person transfer pattern.

## Stack

- Vite, TypeScript, Svelte 5
- Vitest for unit tests
- Chart.js for charts
- `vite-plugin-pwa` for the service worker and install manifest
- IndexedDB for on-device persistence
- GitHub Actions building to GitHub Pages (base path `/budget/`)

The parsing, merging and categorising code is plain TypeScript with no UI
dependency, so it is testable in isolation.

## Input format

Established from the real exports (2018 to October 2026, one account).

| Aspect | Behaviour |
|---|---|
| Encoding | UTF-8 or Windows-1252, both occur. Try strict UTF-8, fall back. |
| Delimiter | `;`, with a trailing `;` on every row. No quoting. |
| Line endings | CRLF; blank lines may occur. |
| Preamble | Optional: title, account, start date, end date. Find the header row by column names. Do not store the account number. |
| Footer | Optional: closing balances and overdraft facility. These rows have the same field count as data rows. |
| Row test | A row is a transaction only if its first field is a `DD-MM-YYYY` date. |
| Columns | Movement date, value date, description, debit, credit, book balance, available balance, bank category. |
| Numbers | `1.234,56`. Balances may be negative (`-477,50`). Parse to integer cents. |
| Amount | Exactly one of debit or credit is filled. Signed amount = credit − debit. |
| Order | Newest first. Same-day order is meaningful and must be kept. |
| Description | Trailing spaces, mixed case, truncated at about 21 characters. |
| Balance chain | `balance[n] = balance[n+1] + credit − debit` holds for every row and across files. |

Reporting uses the movement date. The value date is kept but can be months
earlier for reversals.

### Wording changes over time

The same thing is described differently in different years. Normalisation
produces a stable `kind` and `merchant` or `counterparty` so one rule covers
all eras.

- Card purchases: `COMPRA <name>`, `COMPRAS C DEB <name>`, and from June 2026
  just `<name>`. The merchant is the name with the prefix removed. Because
  truncation falls at a different point in each era, merchant matching is by
  shared prefix, not equality.
- Phone transfers: `TRF P2P <mask>`, `TRF MBWAY <mask>`, `Trf Mbway <mask>`.
  The mask (nine characters, three digits, `xxx`, three digits; either case) is the counterparty key. It shows six of
  nine digits, so two people can share one mask.
- Named transfers: `TRF <name>` and `TFI <name>`.
- Term deposits: opening, withdrawal, capital returned, interest.
- Punctuation variants of one description (`03 TRANS…` and `03-TRANS…`).

Normalisation: uppercase, collapse whitespace, treat punctuation as spaces.

## Data model

```ts
Transaction {
  id            // hash of dates, raw description, debit, credit, balance + occurrence
  date, valueDate
  description   // trimmed original
  kind          // purchase | phoneTransfer | transfer | cash | directDebit | fee | deposit | other
  merchant?     // normalised, prefix stripped
  counterparty? // masked phone or transfer name
  amount        // signed cents
  balance       // cents
  bankCategory  // kept as a hint only
  order         // position in the merged chronological sequence
}
Category { id, name, group, type }   // type: income | expense | savings | ignore
Rule     { id, field, op, value, direction?, amountMin?, amountMax?, from?, to?, categoryId }
Alias    { counterparty, name }
Period   { id, name, from, to }      // e.g. a stretch of work travel
Override { transactionId, categoryId, note? }
```

### Deduplication

A purchase that is charged, cancelled and charged again on the same day gives
two rows identical in every column, balance included. So the ID carries an
occurrence number within its file, and merging keeps, for each identical row,
the highest count seen in any single file. Loading the same file twice changes
nothing, and overlapping files merge cleanly.

After every load the balance chain is rechecked over the merged set. A break
means a missing stretch, reported with the dates on either side. Where a file
has a footer, its closing balance is checked against the newest row.

### Categorising

Order of precedence:

1. Manual override on a single transaction
2. User rules, most specific first: date-bounded, then exact counterparty,
   then merchant prefix, then description contains
3. Built-in generic rules
4. Uncategorised

Rules can be limited to a named period, which is how the same merchant can
mean different things during work travel.

### Savings

Term-deposit money is the same money going out and coming back, so its flows
are never added to income or spending. Categories of type `savings` are left
out of both totals. Reports show the amount currently held in deposits
(cumulative out minus back) as its own line. Deposit interest is income.

### Credit card

No card statements are available. The monthly card payment is one expense
category. Work-travel periods appear as larger card payments set against the
employer's refunds, shown net within a period.

## Files the user keeps

| File | Contents | Purpose |
|---|---|---|
| Workspace `.json` | Transactions plus all config | Load next time, then add new exports |
| Config `.json` | Categories, rules, aliases, periods, overrides | Reuse alone, or hand over to update built-in rules |
| Flat `.csv` | Every transaction with category, group and type | Spreadsheets and other tools |

All three carry a format version. Loading a workspace and loading CSVs can be
mixed freely; everything goes through the same merge.

## Screens

- **Load** — drop files (CSVs, a workspace, a config). Shows what each file
  added, what was already present, and any chain break.
- **Transactions** — searchable, filterable table; change a category inline.
- **Categorise** — uncategorised transactions grouped by merchant or
  counterparty, ordered by count and total. One action creates a rule for the
  whole group. Name a phone number here.
- **Rules and categories** — edit, reorder, define periods.
- **Reports** — see below.
- **Data** — date range loaded, chain status, export buttons, and a button to
  erase everything from this browser.

Interface in English, amounts shown as `1.234,56 €`.

## Reports, first version

- Income against spending per month and per year, with the net, savings excluded
- One category or group over time (salary progression)
- Breakdown by category for any period, compared with the previous one
- Counterparties: money in, out and net per named person
- Account balance over time
- Amount held in savings over time
- Share of spending still uncategorised, so gaps in the picture are visible
- Named periods drawn as shaded bands on time charts

## Phases

Each phase ends with tests passing and something usable.

1. **Core library.** Decoding, header and footer detection, number and date
   parsing, normalisation, IDs, merge, chain check. Unit tests on made-up
   fixtures covering every case in the format table. Local-only check against
   `data/`: 6,633 rows, no chain breaks, four same-day repeats kept, and
   loading every file twice gives the same result.
2. **App shell.** Project setup, Load screen, Transactions table, IndexedDB,
   workspace export and import, erase button.
3. **Categorising.** Categories, rules, aliases, overrides, periods, the
   Categorise screen, config export and import, built-in generic rules.
4. **Reports.**
5. **Release.** Service worker, install manifest, security policy, GitHub
   Actions deploy, and a CI check that fails if any data file is tracked
   outside `tests/fixtures/`.

## Later, if wanted

- Credit card statements as a second source linked to the monthly payment
- Budget targets per category
- Recurring-payment detection and price-change alerts
- SQLite export
