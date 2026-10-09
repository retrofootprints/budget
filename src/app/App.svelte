<script lang="ts">
  import { onMount } from 'svelte';
  import { app } from './store.svelte.ts';
  import LoadView from './views/LoadView.svelte';
  import TransactionsView from './views/TransactionsView.svelte';
  import CategoriseView from './views/CategoriseView.svelte';
  import RulesView from './views/RulesView.svelte';
  import ReportsView from './views/ReportsView.svelte';
  import DataView from './views/DataView.svelte';

  type View = 'load' | 'transactions' | 'categorise' | 'rules' | 'reports' | 'data';
  let view = $state<View>('load');

  const tabs: { id: View; label: string }[] = [
    { id: 'load', label: 'Load' },
    { id: 'transactions', label: 'Transactions' },
    { id: 'categorise', label: 'Categorise' },
    { id: 'rules', label: 'Rules' },
    { id: 'reports', label: 'Reports' },
    { id: 'data', label: 'Data' },
  ];

  const uncategorised = $derived(app.rows.filter((r) => !r.categoryId).length);

  onMount(async () => {
    await app.init();
    // Returning with remembered data: go straight to the reports.
    if (app.restored) view = 'reports';
  });
</script>

<div class="shell">
  <header class="top">
    <span class="brand">Budget</span>
    <span class="privacy">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"
        ><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg
      >
      Runs entirely in this browser. Nothing is uploaded or stored on the server.
    </span>
  </header>

  <nav class="tabs" aria-label="Sections">
    {#each tabs as t (t.id)}
      <button aria-current={view === t.id ? 'page' : undefined} onclick={() => (view = t.id)}>
        {t.label}{#if t.id === 'categorise' && uncategorised > 0}<span class="badge">{uncategorised}</span>{/if}
      </button>
    {/each}
  </nav>

  {#if !app.ready}
    <p class="muted">Starting…</p>
  {:else if view === 'load'}
    <LoadView goto={(v) => (view = v as View)} />
  {:else if view === 'transactions'}
    <TransactionsView goto={(v) => (view = v as View)} />
  {:else if view === 'categorise'}
    <CategoriseView goto={(v) => (view = v as View)} />
  {:else if view === 'rules'}
    <RulesView />
  {:else if view === 'reports'}
    <ReportsView goto={(v) => (view = v as View)} />
  {:else}
    <DataView />
  {/if}
</div>
