<script lang="ts">
  import { app } from '../store.svelte.ts';
  import { dmy } from '../format.ts';

  let decimal = $state<',' | '.'>(',');
  let confirmErase = $state(false);

  const cov = $derived(app.cov);

  async function erase() {
    await app.eraseAll();
    confirmErase = false;
  }
</script>

<h1>Data</h1>

<div class="card">
  <h2>What you have</h2>
  {#if cov.count === 0}
    <p class="muted">Nothing loaded.</p>
  {:else}
    <p>
      {cov.count.toLocaleString('en')} transactions, {cov.from ? dmy(cov.from) : ''} → {cov.to ? dmy(cov.to) : ''},
      {app.config.rules.length} rules, {Object.keys(app.config.aliases).length} names,
      {Object.keys(app.config.overrides).length} manual changes.
    </p>
  {/if}
</div>

<div class="card">
  <h2>Save</h2>
  <p class="muted small">
    These files hold your real transactions, names and phone numbers. Keep them somewhere private and never commit
    them to a repository.
  </p>
  <div class="toolbar">
    <button class="btn primary" onclick={() => app.exportWorkspace()} disabled={cov.count === 0}>
      Workspace (transactions + categories)
    </button>
    <span class="muted small">Drop this back in next time, together with any newer bank exports.</span>
  </div>
  <div class="toolbar">
    <button class="btn" onclick={() => app.exportConfig()}>Categories and rules only</button>
    <span class="muted small">No transactions. Reusable on its own, or hand it over to update the app.</span>
  </div>
  <div class="toolbar">
    <button class="btn" onclick={() => app.exportCsv(decimal)} disabled={cov.count === 0}>All transactions as CSV</button>
    <div class="seg" role="group" aria-label="Decimal separator">
      <button aria-pressed={decimal === ','} onclick={() => (decimal = ',')}>1234,56</button>
      <button aria-pressed={decimal === '.'} onclick={() => (decimal = '.')}>1234.56</button>
    </div>
    <span class="muted small">For spreadsheets. Semicolon separated.</span>
  </div>
</div>

<div class="card">
  <h2>Remembering on this device</h2>
  <label class="toolbar">
    <input
      type="checkbox"
      checked={app.remember}
      onchange={(e) => void app.setRemember(e.currentTarget.checked)}
    />
    Keep my data in this browser so it is here next time
  </label>
  <p class="muted small">
    Stored in this browser's own database on this device only. Turn it off on a shared computer: the saved copy is
    deleted immediately and nothing more is kept.
  </p>
  {#if app.saveError}<p class="note warn">{app.saveError}</p>{/if}
</div>

<div class="card">
  <h2>Erase</h2>
  <p class="muted small">Removes every transaction, rule and name from this page and from this browser's storage.</p>
  {#if confirmErase}
    <button class="btn danger" onclick={erase}>Yes, erase everything</button>
    <button class="btn" onclick={() => (confirmErase = false)}>Cancel</button>
  {:else}
    <button class="btn danger" onclick={() => (confirmErase = true)}>Erase all data…</button>
  {/if}
</div>
