<script lang="ts">
  import { app } from '../store.svelte.ts';
  import { dmy, eur } from '../format.ts';
  import { displayName } from '../../core/categorise.ts';
  import CategorySelect from '../CategorySelect.svelte';
  import { foldText } from '../../core/text.ts';

  let { goto }: { goto: (v: string) => void } = $props();

  const PAGE = 100;
  let search = $state('');
  let category = $state<string>('all'); // all | none | <id>
  let year = $state('all');
  let direction = $state<'all' | 'in' | 'out'>('all');
  let page = $state(0);

  const years = $derived([...new Set(app.rows.map((r) => r.date.slice(0, 4)))].sort().reverse());
  const categories = $derived(app.config.categories);

  const filtered = $derived.by(() => {
    const q = foldText(search);
    const out = [];
    for (let i = app.rows.length - 1; i >= 0; i--) {
      const r = app.rows[i]!;
      if (year !== 'all' && !r.date.startsWith(year)) continue;
      if (direction === 'in' && r.amount < 0) continue;
      if (direction === 'out' && r.amount >= 0) continue;
      if (category === 'none' && r.categoryId) continue;
      if (category !== 'all' && category !== 'none' && r.categoryId !== category) continue;
      if (q) {
        const hay = foldText(`${r.description} ${displayName(r.counterparty ?? r.name, app.config.aliases)}`);
        if (!hay.includes(q)) continue;
      }
      out.push(r);
    }
    return out;
  });

  const pages = $derived(Math.max(1, Math.ceil(filtered.length / PAGE)));
  const shown = $derived(filtered.slice(page * PAGE, page * PAGE + PAGE));
  const sum = $derived(filtered.reduce((s, r) => s + r.amount, 0));

  $effect(() => {
    // Any filter change returns to the first page.
    void [search, category, year, direction];
    page = 0;
  });

  const sourceLabel = { override: 'manual', rule: 'rule', builtin: 'built-in' } as const;
</script>

<h1>Transactions</h1>

{#if app.rows.length === 0}
  <p class="muted">Nothing loaded yet. <button class="link" onclick={() => goto('load')}>Load files</button>.</p>
{:else}
  <div class="toolbar">
    <label>
      Search
      <input type="search" bind:value={search} placeholder="description or name" />
    </label>
    <label>
      Category
      <select bind:value={category}>
        <option value="all">All</option>
        <option value="none">Uncategorised</option>
        {#each categories as c (c.id)}
          <option value={c.id}>{c.group} · {c.name}</option>
        {/each}
      </select>
    </label>
    <label>
      Year
      <select bind:value={year}>
        <option value="all">All</option>
        {#each years as y (y)}<option value={y}>{y}</option>{/each}
      </select>
    </label>
    <div class="seg" role="group" aria-label="Direction">
      <button aria-pressed={direction === 'all'} onclick={() => (direction = 'all')}>All</button>
      <button aria-pressed={direction === 'in'} onclick={() => (direction = 'in')}>In</button>
      <button aria-pressed={direction === 'out'} onclick={() => (direction = 'out')}>Out</button>
    </div>
  </div>

  <p class="muted small">
    {filtered.length.toLocaleString('en')} transactions, net
    <span class={sum >= 0 ? 'pos' : 'neg'}>{eur(sum, { sign: true })}</span>
  </p>

  <div class="card table-wrap" style="padding: 4px 8px">
    <table>
      <thead>
        <tr>
          <th>Date</th>
          <th>Description</th>
          <th class="num">Amount</th>
          <th class="num">Balance</th>
          <th>Category</th>
        </tr>
      </thead>
      <tbody>
        {#each shown as r (r.id)}
          {@const who = displayName(r.counterparty ?? r.name, app.config.aliases)}
          <tr>
            <td class="nowrap">{dmy(r.date)}</td>
            <td class="desc">
              {r.description}
              {#if app.config.aliases[r.counterparty ?? r.name]}<span class="chip">{who}</span>{/if}
              {#if r.reversal}<span class="chip">reversal</span>{/if}
            </td>
            <td class="num {r.amount >= 0 ? 'pos' : ''}">{eur(r.amount, { sign: true })}</td>
            <td class="num muted">{eur(r.balance)}</td>
            <td class="nowrap">
              <CategorySelect
                {categories}
                value={r.categoryId}
                label={`Category for ${r.description}`}
                onpick={(id) => app.setOverride(r.id, id)}
              />
              {#if r.source}<span class="chip">{sourceLabel[r.source]}</span>{/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  {#if pages > 1}
    <div class="toolbar" style="margin-top: 12px">
      <button class="btn small" disabled={page === 0} onclick={() => (page -= 1)}>Previous</button>
      <span class="muted small">Page {page + 1} of {pages}</span>
      <button class="btn small" disabled={page >= pages - 1} onclick={() => (page += 1)}>Next</button>
    </div>
  {/if}
{/if}
