<script lang="ts">
  import { onMount } from 'svelte';
  import type { ChartConfiguration } from 'chart.js';
  import { app } from '../store.svelte.ts';
  import { bucketLabel, dmy, eur, eurWhole } from '../format.ts';
  import Chart from '../Chart.svelte';
  import type { Band } from '../chartTypes.ts';
  import {
    balanceSeries,
    breakdown,
    bucketOf,
    categorySeries,
    counterpartyTotals,
    inRange,
    savingsHeld,
    totals,
    totalsByBucket,
    type Granularity,
  } from '../../core/reports.ts';

  let { goto }: { goto: (v: string) => void } = $props();

  // ---- theme tokens, re-read when the OS theme flips ----------------------
  let themeTick = $state(0);
  onMount(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const bump = () => (themeTick += 1);
    mq.addEventListener('change', bump);
    return () => mq.removeEventListener('change', bump);
  });

  const colors = $derived.by(() => {
    void themeTick;
    const cs = getComputedStyle(document.documentElement);
    const v = (n: string) => cs.getPropertyValue(n).trim();
    return {
      series: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => v(`--series-${i}`)),
      ink: v('--ink'),
      ink2: v('--ink-2'),
      grid: v('--grid'),
      surface: v('--surface'),
    };
  });

  // ---- range --------------------------------------------------------------
  const bounds = $derived({ from: app.cov.from ?? '', to: app.cov.to ?? '' });
  let customFrom = $state<string | null>(null);
  let customTo = $state<string | null>(null);
  const from = $derived(customFrom ?? bounds.from);
  const to = $derived(customTo ?? bounds.to);
  const years = $derived(
    bounds.from ? Array.from({ length: Number(bounds.to.slice(0, 4)) - Number(bounds.from.slice(0, 4)) + 1 }, (_, i) => String(Number(bounds.from.slice(0, 4)) + i)).reverse() : [],
  );

  function setAll() {
    customFrom = null;
    customTo = null;
  }
  function setYear(y: string) {
    customFrom = `${y}-01-01`;
    customTo = `${y}-12-31`;
  }
  function setLast12() {
    const end = new Date(`${bounds.to}T00:00:00Z`);
    const start = new Date(end);
    start.setUTCFullYear(start.getUTCFullYear() - 1);
    start.setUTCDate(start.getUTCDate() + 1);
    customFrom = start.toISOString().slice(0, 10);
    customTo = bounds.to;
  }

  let gran = $state<Granularity | null>(null);
  const monthsInRange = $derived(
    from && to ? (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5, 7)) - Number(from.slice(5, 7)) + 1 : 0,
  );
  const g = $derived<Granularity>(gran ?? (monthsInRange > 48 ? 'quarter' : 'month'));

  const valid = $derived(!!from && !!to && from <= to);
  const rows = $derived(valid ? app.rows.filter((r) => inRange(r, from, to)) : []);
  const cats = $derived(app.categories);

  // Previous stretch of equal length, for comparison.
  const prev = $derived.by(() => {
    if (!valid) return null;
    const a = new Date(`${from}T00:00:00Z`).getTime();
    const b = new Date(`${to}T00:00:00Z`).getTime();
    const day = 86_400_000;
    const len = Math.round((b - a) / day) + 1;
    const pTo = new Date(a - day);
    const pFrom = new Date(a - len * day);
    return { from: pFrom.toISOString().slice(0, 10), to: pTo.toISOString().slice(0, 10) };
  });
  const prevRows = $derived(prev ? app.rows.filter((r) => inRange(r, prev!.from, prev!.to)) : []);
  const hasPrev = $derived(prevRows.length > 0);

  const tot = $derived(totals(rows, cats));
  const perMonth = $derived(monthsInRange > 0 ? Math.round(tot.expense / monthsInRange) : 0);

  // ---- bands --------------------------------------------------------------
  function bandsFor(labels: string[]): Band[] {
    const out: Band[] = [];
    for (const p of app.config.periods) {
      const a = bucketOf(p.from, g);
      const b = bucketOf(p.to, g);
      const first = labels.findIndex((l) => l >= a);
      let last = -1;
      labels.forEach((l, i) => {
        if (l <= b) last = i;
      });
      if (first >= 0 && last >= first) out.push({ from: first, to: last, label: p.name });
    }
    return out;
  }

  // ---- shared chart options -----------------------------------------------
  const euros = (c: number) => c / 100;
  function options(opts: { legend?: boolean } = {}): ChartConfiguration['options'] {
    const c = colors;
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          display: opts.legend ?? true,
          position: 'bottom',
          labels: { color: c.ink2, boxWidth: 10, boxHeight: 10, usePointStyle: true },
        },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${eur(Math.round((ctx.parsed.y ?? 0) * 100))}`,
          },
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: c.ink2, maxRotation: 0, autoSkip: true, maxTicksLimit: 14 }, border: { color: c.grid } },
        y: { grid: { color: c.grid }, border: { display: false }, ticks: { color: c.ink2, callback: (v) => eurWhole(Number(v) * 100) } },
      },
    };
  }

  // ---- 1. income vs spending ------------------------------------------------
  const flow = $derived(valid ? totalsByBucket(rows, cats, g, from, to) : { labels: [], values: [] });
  const flowConfig = $derived.by<ChartConfiguration>(() => {
    const c = colors;
    return {
      type: 'bar',
      data: {
        labels: flow.labels.map(bucketLabel),
        datasets: [
          { type: 'bar', label: 'Income', data: flow.values.map((v) => euros(v.income)), backgroundColor: c.series[0], borderRadius: 4, maxBarThickness: 22 },
          { type: 'bar', label: 'Spending', data: flow.values.map((v) => euros(v.expense)), backgroundColor: c.series[1], borderRadius: 4, maxBarThickness: 22 },
          { type: 'line', label: 'Net', data: flow.values.map((v) => euros(v.net)), borderColor: c.ink, backgroundColor: c.ink, borderWidth: 2, pointRadius: flow.labels.length > 24 ? 0 : 3, pointHoverRadius: 5, tension: 0 },
        ],
      },
      options: options(),
    };
  });

  // ---- 2. a category over time --------------------------------------------
  let by = $state<'category' | 'group'>('category');
  let chosen = $state<string[] | null>(null);
  const seriesAll = $derived(valid ? categorySeries(rows, cats, g, from, to, by) : { labels: [], values: [] });
  const seriesList = $derived(
    seriesAll.values
      .map((s) => ({ ...s, total: s.values.reduce((a, b) => a + Math.abs(b), 0) }))
      .filter((s) => s.total > 0)
      .sort((a, b) => b.total - a.total),
  );
  const selectedIds = $derived.by(() => {
    const valid = new Set(seriesList.map((s) => s.id));
    const picked = (chosen ?? []).filter((id) => valid.has(id));
    if (chosen !== null) return picked.slice(0, 8);
    // Default: the biggest income line if there is one, else the biggest spending line.
    const income = seriesList.find((s) => {
      const c = by === 'category' ? cats.get(s.id) : [...cats.values()].find((x) => `group:${x.group}` === s.id);
      return c?.type === 'income';
    });
    const first = income ?? seriesList[0];
    return first ? [first.id] : [];
  });
  const selectedSeries = $derived(selectedIds.map((id) => seriesList.find((s) => s.id === id)!).filter(Boolean));
  const seriesColor = (id: string) => colors.series[Math.max(0, selectedIds.indexOf(id)) % 8] as string;

  function toggle(id: string) {
    const cur = selectedIds;
    chosen = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id].slice(0, 8);
  }

  const seriesConfig = $derived.by<ChartConfiguration>(() => ({
    type: 'line',
    data: {
      labels: seriesAll.labels.map(bucketLabel),
      datasets: selectedSeries.map((s) => ({
        label: s.label,
        data: s.values.map(euros),
        borderColor: seriesColor(s.id),
        backgroundColor: seriesColor(s.id),
        borderWidth: 2,
        pointRadius: seriesAll.labels.length > 24 ? 0 : 3,
        pointHoverRadius: 5,
        tension: 0,
      })),
    },
    options: options(),
  }));

  // ---- 3. balance and savings ---------------------------------------------
  const bal = $derived(valid ? balanceSeries(app.rows.filter((r) => r.date <= to), g, from, to) : { labels: [], values: [] });
  const parked = $derived(valid ? savingsHeld(app.rows, cats, g, from, to) : { labels: [], values: [] });
  const hasSavings = $derived(parked.values.some((v) => v !== 0));
  const balanceConfig = $derived.by<ChartConfiguration>(() => {
    const c = colors;
    const datasets = [
      {
        label: 'Balance at end of period',
        data: bal.values.map((v) => (v.end === null ? null : euros(v.end))),
        borderColor: c.series[0],
        backgroundColor: c.series[0],
        borderWidth: 2,
        pointRadius: bal.labels.length > 24 ? 0 : 3,
        pointHoverRadius: 5,
        tension: 0,
        spanGaps: true,
      },
      ...(hasSavings
        ? [
            {
              label: 'Net moved to savings (cumulative)',
              data: parked.values.map(euros),
              borderColor: c.series[1],
              backgroundColor: c.series[1],
              borderWidth: 2,
              borderDash: [6, 4],
              pointRadius: 0,
              pointHoverRadius: 5,
              tension: 0,
            },
          ]
        : []),
    ];
    return { type: 'line', data: { labels: bal.labels.map(bucketLabel), datasets }, options: options() };
  });

  // ---- 4. breakdown ------------------------------------------------------------
  const lines = $derived(breakdown(rows, cats));
  const prevLines = $derived(new Map(breakdown(prevRows, cats).map((l) => [l.id, l.amount])));
  const spendLines = $derived(lines.filter((l) => l.type === 'expense'));
  const incomeLines = $derived(lines.filter((l) => l.type === 'income'));
  const spendMax = $derived(Math.max(1, ...spendLines.map((l) => Math.abs(l.amount))));
  const incomeMax = $derived(Math.max(1, ...incomeLines.map((l) => Math.abs(l.amount))));
  const spendTotal = $derived(spendLines.reduce((s, l) => s + l.amount, 0));

  function change(now: number, before: number | undefined): string {
    if (before === undefined || before === 0) return '–';
    const p = Math.round(((now - before) / Math.abs(before)) * 100);
    return p === 0 ? '0%' : `${p > 0 ? '▲' : '▼'} ${Math.abs(p)}%`;
  }

  // ---- 5. people -------------------------------------------------------------
  const people = $derived(counterpartyTotals(rows, app.config.aliases).slice(0, 25));
</script>

<h1>Reports</h1>

{#if app.rows.length === 0}
  <p class="muted">Nothing loaded yet. <button class="link" onclick={() => goto('load')}>Load files</button>.</p>
{:else}
  <div class="toolbar">
    <div class="seg" role="group" aria-label="Range">
      <button aria-pressed={customFrom === null && customTo === null} onclick={setAll}>All time</button>
      <button onclick={setLast12}>Last 12 months</button>
    </div>
    <label>
      Year
      <select onchange={(e) => e.currentTarget.value && setYear(e.currentTarget.value)} value="">
        <option value="">–</option>
        {#each years as y (y)}<option value={y}>{y}</option>{/each}
      </select>
    </label>
    <label>
      From <input type="date" value={from} min={bounds.from} max={bounds.to} onchange={(e) => (customFrom = e.currentTarget.value || null)} />
    </label>
    <label>
      To <input type="date" value={to} min={bounds.from} max={bounds.to} onchange={(e) => (customTo = e.currentTarget.value || null)} />
    </label>
    <div class="seg" role="group" aria-label="Group by">
      <button aria-pressed={g === 'month'} onclick={() => (gran = 'month')}>Month</button>
      <button aria-pressed={g === 'quarter'} onclick={() => (gran = 'quarter')}>Quarter</button>
      <button aria-pressed={g === 'year'} onclick={() => (gran = 'year')}>Year</button>
    </div>
  </div>

  {#if !valid}
    <p class="note warn">The start date is after the end date.</p>
  {:else}
    <div class="stats">
      <div class="stat">
        <div class="label">Income</div>
        <div class="value">{eur(tot.income)}</div>
      </div>
      <div class="stat">
        <div class="label">Spending</div>
        <div class="value">{eur(tot.expense)}</div>
        <div class="sub">{eur(perMonth)} a month</div>
      </div>
      <div class="stat">
        <div class="label">Net</div>
        <div class="value {tot.net >= 0 ? 'pos' : 'neg'}">{eur(tot.net, { sign: true })}</div>
        <div class="sub">income − spending</div>
      </div>
      <div class="stat">
        <div class="label">{tot.savings <= 0 ? 'Moved to savings' : 'Returned from savings'}</div>
        <div class="value">{eur(Math.abs(tot.savings))}</div>
        <div class="sub">not counted above</div>
      </div>
      <div class="stat">
        <div class="label">Uncategorised</div>
        <div class="value">{tot.count ? Math.round((100 * tot.uncategorisedCount) / tot.count) : 0}%</div>
        <div class="sub">
          {tot.uncategorisedCount} of {tot.count}
          {#if tot.uncategorisedCount > 0}· <button class="link" onclick={() => goto('categorise')}>fix</button>{/if}
        </div>
      </div>
    </div>

    {#if app.cov.breaks.length}
      <p class="note warn">
        The loaded files have {app.cov.breaks.length} gap{app.cov.breaks.length === 1 ? '' : 's'} in the balance, so
        some transactions may be missing and totals can be off. See the Load tab.
      </p>
    {/if}

    <div class="card">
      <figure>
        <figcaption class="title">Income and spending</figcaption>
        <Chart config={flowConfig} bands={bandsFor(flow.labels)} label="Income, spending and net per period" />
      </figure>
      <details class="as-table">
        <summary>View as table</summary>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Period</th><th class="num">Income</th><th class="num">Spending</th><th class="num">Net</th><th class="num">To savings</th></tr></thead>
            <tbody>
              {#each flow.labels as l, i (l)}
                {@const v = flow.values[i]!}
                <tr>
                  <td>{bucketLabel(l)}</td>
                  <td class="num">{eur(v.income)}</td>
                  <td class="num">{eur(v.expense)}</td>
                  <td class="num">{eur(v.net, { sign: true })}</td>
                  <td class="num">{eur(-v.savings, { sign: true })}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </details>
    </div>

    <div class="card">
      <figure>
        <figcaption class="title">One category over time</figcaption>
        <div class="toolbar">
          <div class="seg" role="group" aria-label="Show by">
            <button aria-pressed={by === 'category'} onclick={() => { by = 'category'; chosen = null; }}>Categories</button>
            <button aria-pressed={by === 'group'} onclick={() => { by = 'group'; chosen = null; }}>Groups</button>
          </div>
          <span class="muted small">Pick up to 8. Spending is shown as positive amounts.</span>
        </div>
        <div class="chips" style="margin-bottom: 10px">
          {#each seriesList.slice(0, 40) as s (s.id)}
            {@const on = selectedIds.includes(s.id)}
            <label>
              <input type="checkbox" checked={on} onchange={() => toggle(s.id)} />
              {#if on}<span class="swatch" style="background: {seriesColor(s.id)}"></span>{/if}
              {s.label}
            </label>
          {/each}
        </div>
        {#if selectedSeries.length}
          <Chart config={seriesConfig} bands={bandsFor(seriesAll.labels)} label="Selected categories per period" />
        {:else}
          <p class="muted">Pick a category above.</p>
        {/if}
      </figure>
      {#if selectedSeries.length}
        <details class="as-table">
          <summary>View as table</summary>
          <div class="table-wrap">
            <table>
              <thead>
                <tr><th>Period</th>{#each selectedSeries as s (s.id)}<th class="num">{s.label}</th>{/each}</tr>
              </thead>
              <tbody>
                {#each seriesAll.labels as l, i (l)}
                  <tr>
                    <td>{bucketLabel(l)}</td>
                    {#each selectedSeries as s (s.id)}<td class="num">{eur(s.values[i] ?? 0)}</td>{/each}
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        </details>
      {/if}
    </div>

    <div class="grid cols-2">
      <div class="card">
        <h2>Spending by category</h2>
        {#if prev && hasPrev}<p class="muted small">Change against {dmy(prev.from)} → {dmy(prev.to)}.</p>{/if}
        <div class="table-wrap">
          <table>
            <thead><tr><th>Category</th><th class="num">Amount</th><th>Share</th>{#if hasPrev}<th class="num">Change</th>{/if}</tr></thead>
            <tbody>
              {#each spendLines as l (l.id)}
                <tr>
                  <td>{l.label}{#if l.group !== l.label && l.group !== '(uncategorised)'}<div class="muted small">{l.group}</div>{/if}</td>
                  <td class="num">{eur(l.amount)}</td>
                  <td class="bar-cell">
                    <div class="bar" style="width: {Math.max(2, (Math.abs(l.amount) / spendMax) * 100)}%"></div>
                    <span class="muted small">{spendTotal ? Math.round((100 * l.amount) / spendTotal) : 0}%</span>
                  </td>
                  {#if hasPrev}<td class="num">{change(l.amount, prevLines.get(l.id))}</td>{/if}
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <h2>Income by category</h2>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Category</th><th class="num">Amount</th><th>Share</th>{#if hasPrev}<th class="num">Change</th>{/if}</tr></thead>
            <tbody>
              {#each incomeLines as l (l.id)}
                <tr>
                  <td>{l.label}</td>
                  <td class="num">{eur(l.amount)}</td>
                  <td class="bar-cell"><div class="bar" style="width: {Math.max(2, (Math.abs(l.amount) / incomeMax) * 100)}%"></div></td>
                  {#if hasPrev}<td class="num">{change(l.amount, prevLines.get(l.id))}</td>{/if}
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="card">
      <figure>
        <figcaption class="title">Account balance{hasSavings ? ' and money parked in savings' : ''}</figcaption>
        <Chart config={balanceConfig} bands={bandsFor(bal.labels)} label="Balance at the end of each period" />
        {#if hasSavings}
          <p class="muted small">
            Savings is the cumulative net amount moved out of this account into deposits and investments. It is an
            estimate: interest folded into a withdrawal and renewals inside the savings account are not visible here.
          </p>
        {/if}
      </figure>
      <details class="as-table">
        <summary>View as table</summary>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Period</th><th class="num">Balance (end)</th><th class="num">Lowest</th>{#if hasSavings}<th class="num">Net moved to savings</th>{/if}</tr></thead>
            <tbody>
              {#each bal.labels as l, i (l)}
                {@const v = bal.values[i]!}
                <tr>
                  <td>{bucketLabel(l)}</td>
                  <td class="num">{v.end === null ? '–' : eur(v.end)}</td>
                  <td class="num">{v.low === null ? '–' : eur(v.low)}</td>
                  {#if hasSavings}<td class="num">{eur(parked.values[i] ?? 0)}</td>{/if}
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </details>
    </div>

    <div class="card">
      <h2>People and transfer parties</h2>
      <p class="muted small">Phone numbers and named transfers in this range. Name them in the Categorise tab.</p>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Who</th><th class="num">In</th><th class="num">Out</th><th class="num">Net</th><th class="num">Count</th><th>Last</th></tr></thead>
          <tbody>
            {#each people as p (p.name)}
              <tr>
                <td>{p.label}{#if p.label !== p.name}<div class="muted small">{p.name}</div>{/if}</td>
                <td class="num">{eur(p.inbound)}</td>
                <td class="num">{eur(p.outbound)}</td>
                <td class="num {p.net >= 0 ? 'pos' : ''}">{eur(p.net, { sign: true })}</td>
                <td class="num">{p.count}</td>
                <td class="nowrap">{dmy(p.last)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
  {/if}
{/if}
