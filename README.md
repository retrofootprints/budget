# Budget

A private, static budget app for analysing a bank account from its CSV exports.
It runs entirely in the browser and is served from GitHub Pages. **No bank data is
ever uploaded, stored on the server, or committed to this repository.**

## What it does

- Load any number of bank CSV exports. Overlapping files and repeated loads are
  merged without duplicates, and the running balance is checked so missing
  stretches are reported.
- Categorise transactions with rules (merchant, phone number, direction, amount,
  named date periods) and manual overrides. Name the people behind phone numbers.
- Reports: income and spending over time, any category over time, breakdown with
  change against the previous period, balance, money parked in savings, and
  totals per person.
- Save a **workspace** (transactions + categories) to load next time, a
  **config** (categories and rules only), or one flat **CSV** of everything.

Money that is only moved in and out of savings is kept out of income and
spending, and shown separately.

## Privacy rules

1. The page makes no network requests of its own. A content security policy blocks
   everything except the page's own origin.
2. Real exports live in `data/`, which is gitignored. Test fixtures are synthetic.
3. Built-in categorisation rules are generic (banking mechanics, utilities,
   nationwide chains). Anything naming a person, a phone number, an employer or a
   local shop belongs in your own config file.
4. Exported workspaces and configs contain real data. Keep them private.

A guard (`npm run guard`) fails if bank data or an exported workspace is tracked.
It runs in CI and as a pre-commit hook; enable the hook once per clone:

```sh
git config core.hooksPath .githooks
```

## Using it

1. Open the page and drop your CSV exports on the Load tab.
2. Open Categorise. Each group is one merchant or person; choose a category once
   and it applies to every matching transaction, past and future.
3. Download a workspace from the Data tab. Next time, drop that file together with
   any newer exports.

The app can also remember your data in the browser's own storage on that device.
Turn that off on a shared computer from the Data tab.

## Bank format

Semicolon-separated, Portuguese numbers (`1.234,56`), dates `DD-MM-YYYY`,
Windows-1252 or UTF-8, newest first, optional preamble and footer. See
[PLAN.md](PLAN.md) for the full list of behaviours and why.

## Development

```sh
npm install
npm run dev      # http://localhost:5173/budget/
npm test         # unit tests, synthetic data only
npm run check    # type check
npm run build    # production build in dist/
```

Core logic (parsing, merging, categorising, reports) is plain TypeScript in
`src/core/` with no UI dependency. The interface is Svelte in `src/app/`.

## Deployment

Pushing to `main` runs `.github/workflows/deploy.yml`: guard, type check, tests,
build, then deploy to GitHub Pages. In the repository settings, set
**Pages → Source** to **GitHub Actions** once.
