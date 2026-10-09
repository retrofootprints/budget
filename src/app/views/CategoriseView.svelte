<script lang="ts">
  import { app } from '../store.svelte.ts';
  import { dmy, eur } from '../format.ts';
  import { buildNameCanon } from '../../core/normalize.ts';
  import { displayName } from '../../core/categorise.ts';
  import type { Kind } from '../../core/types.ts';
  import CategorySelect from '../CategorySelect.svelte';
  import { foldText } from '../../core/text.ts';

  let { goto }: { goto: (v: string) => void } = $props();

  interface Group {
    /** Canonical entity name; also what a rule created here matches on. */
    name: string;
    kind: Kind;
    count: number;
    inbound: number;
    outbound: number;
    first: string;
    last: string;
    sample: string;
  }

  type Sort = 'count' | 'value' | 'recent';
  let sort = $state<Sort>('count');
  let kindFilter = $state<'all' | Kind>('all');
  let search = $state('');
  let limit = $state(25);

  const uncategorised = $derived(app.rows.filter((r) => !r.categoryId));

  const groups = $derived.by(() => {
    const canon = buildNameCanon(uncategorised.map((r) => (r.counterparty ?? r.name)));
    const m = new Map<string, Group>();
    for (const r of uncategorised) {
      const raw = r.counterparty ?? r.name;
      const name = canon.get(raw) ?? raw;
      let g = m.get(name);
      if (!g) {
        g = { name, kind: r.kind, count: 0, inbound: 0, outbound: 0, first: r.date, last: r.date, sample: r.description };
        m.set(name, g);
      }
      g.count++;
      if (r.amount >= 0) g.inbound += r.amount;
      else g.outbound += -r.amount;
      if (r.date < g.first) g.first = r.date;
      if (r.date > g.last) {
        g.last = r.date;
        g.sample = r.description;
      }
    }
    return [...m.values()];
  });

  const visible = $derived.by(() => {
    const q = foldText(search);
    const list = groups.filter(
      (g) =>
        (kindFilter === 'all' || g.kind === kindFilter) &&
        (!q || foldText(`${g.name} ${displayName(g.name, app.config.aliases)} ${g.sample}`).includes(q)),
    );
    return list.sort((x, y) =>
      sort === 'count'
        ? y.count - x.count
        : sort === 'value'
          ? y.inbound + y.outbound - (x.inbound + x.outbound)
          : y.last.localeCompare(x.last),
    );
  });

  const totalValue = $derived(app.rows.reduce((s, r) => s + Math.abs(r.amount), 0));
  const uncValue = $derived(uncategorised.reduce((s, r) => s + Math.abs(r.amount), 0));

  // Per-group form state, keyed by group name.
  let picks = $state<Record<string, string | null>>({});
  let dirs = $state<Record<string, 'both' | 'in' | 'out'>>({});
  let periods = $state<Record<string, string>>({});
  let aliasDraft = $state<Record<string, string>>({});

  function apply(g: Group) {
    const categoryId = picks[g.name];
    if (!categoryId) return;
    const dir = dirs[g.name] ?? 'both';
    const periodId = periods[g.name];
    app.addRule({
      name: g.name,
      categoryId,
      ...(dir !== 'both' ? { direction: dir } : {}),
      ...(periodId ? { periodId } : {}),
    });
    const alias = aliasDraft[g.name];
    if (alias !== undefined) app.setAlias(g.name, alias);
  }

  function saveAlias(g: Group) {
    app.setAlias(g.name, aliasDraft[g.name] ?? '');
  }

  const kindLabel: Record<Kind, string> = {
    purchase: 'purchase',
    'phone-transfer': 'phone',
    transfer: 'transfer',
    cash: 'cash',
    fee: 'fee',
    'term-deposit': 'deposit',
    other: 'other',
  };
  const isPerson = (k: Kind) => k === 'phone-transfer' || k === 'transfer';
  const pctOf = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : '0%');
</script>

<h1>Categorise</h1>

{#if app.rows.length === 0}
  <p class="muted">Nothing loaded yet. <button class="link" onclick={() => goto('load')}>Load files</button>.</p>
{:else if uncategorised.length === 0}
  <p class="note ok">Every transaction has a category.</p>
{:else}
  <p class="muted">
    {uncategorised.length.toLocaleString('en')} of {app.rows.length.toLocaleString('en')} transactions
    ({pctOf(uncategorised.length, app.rows.length)}, {pctOf(uncValue, totalValue)} by value) have no category. Each
    group below is one merchant or person; pick a category once and it applies to every matching transaction, past
    and future.
  </p>

  <div class="toolbar">
    <label>
      Sort
      <select bind:value={sort}>
        <option value="count">Most transactions</option>
        <option value="value">Largest total</option>
        <option value="recent">Most recent</option>
      </select>
    </label>
    <label>
      Kind
      <select bind:value={kindFilter}>
        <option value="all">All</option>
        {#each Object.entries(kindLabel) as [k, label] (k)}<option value={k}>{label}</option>{/each}
      </select>
    </label>
    <label>
      Search
      <input type="search" bind:value={search} />
    </label>
  </div>

  {#each visible.slice(0, limit) as g (g.name)}
    {@const alias = app.config.aliases[g.name]}
    <div class="group-card">
      <div class="group-head">
        <span class="name">{alias ?? g.name}</span>
        {#if alias}<span class="muted small">{g.name}</span>{/if}
        <span class="chip">{kindLabel[g.kind]}</span>
        <span class="muted small">
          {g.count} × · in {eur(g.inbound)} · out {eur(g.outbound)} · {dmy(g.first)} → {dmy(g.last)}
        </span>
      </div>
      <div class="muted small">e.g. {g.sample}</div>

      <div class="group-form">
        {#if isPerson(g.kind)}
          <input
            type="text"
            placeholder="Name this person"
            aria-label={`Name for ${g.name}`}
            value={alias ?? ''}
            oninput={(e) => (aliasDraft[g.name] = e.currentTarget.value)}
            onchange={() => saveAlias(g)}
          />
        {/if}
        <CategorySelect
          categories={app.config.categories}
          value={picks[g.name] ?? null}
          label={`Category for ${g.name}`}
          noneLabel="Choose category…"
          onpick={(id) => (picks[g.name] = id)}
        />
        <select
          aria-label="Direction"
          value={dirs[g.name] ?? 'both'}
          onchange={(e) => (dirs[g.name] = e.currentTarget.value as 'both' | 'in' | 'out')}
        >
          <option value="both">in and out</option>
          <option value="in">only money in</option>
          <option value="out">only money out</option>
        </select>
        {#if app.config.periods.length}
          <select
            aria-label="Limit to period"
            value={periods[g.name] ?? ''}
            onchange={(e) => (periods[g.name] = e.currentTarget.value)}
          >
            <option value="">any date</option>
            {#each app.config.periods as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
          </select>
        {/if}
        <button class="btn primary" disabled={!picks[g.name]} onclick={() => apply(g)}>
          Apply to {g.count}
        </button>
      </div>
    </div>
  {/each}

  {#if visible.length > limit}
    <button class="btn" onclick={() => (limit += 25)}>Show more ({visible.length - limit} groups left)</button>
  {/if}
  {#if visible.length === 0}<p class="muted">No groups match.</p>{/if}
{/if}
