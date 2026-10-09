<script lang="ts">
  import { app } from '../store.svelte.ts';
  import { dmy, eur } from '../format.ts';

  let { goto }: { goto: (v: string) => void } = $props();

  let over = $state(false);
  let input: HTMLInputElement;

  async function take(list: FileList | File[] | null) {
    if (!list || list.length === 0) return;
    await app.addFiles([...list]);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    over = false;
    void take(e.dataTransfer?.files ?? null);
  }

  const typeLabel = { 'bank-csv': 'Bank CSV', workspace: 'Workspace', config: 'Config', unrecognised: 'Not recognised' } as const;
  const cov = $derived(app.cov);
</script>

<h1>Load your data</h1>

{#if app.restored}
  <p class="note ok">
    Restored {cov.count.toLocaleString('en')} transactions remembered on this device. Add newer exports below, or
    <button class="link" onclick={() => goto('reports')}>go to the reports</button>.
  </p>
{/if}

<div
  class="drop"
  class:over
  role="region"
  aria-label="File drop area"
  ondragover={(e) => {
    e.preventDefault();
    over = true;
  }}
  ondragleave={() => (over = false)}
  ondrop={onDrop}
>
  <p><strong>Drop files here</strong></p>
  <p class="muted small">
    Bank CSV exports (any number, overlaps are fine), a workspace file, or a config file. Files are read on this
    device only.
  </p>
  <input
    bind:this={input}
    type="file"
    multiple
    accept=".csv,.txt,.json,text/csv,application/json"
    onchange={(e) => {
      void take(e.currentTarget.files);
      e.currentTarget.value = '';
    }}
  />
  <button class="btn primary" onclick={() => input.click()} disabled={app.busy}>
    {app.busy ? 'Reading…' : 'Choose files'}
  </button>
</div>

{#if app.fileReports.length}
  <div class="card" style="margin-top: 16px">
    <h2>This session</h2>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>File</th>
            <th>Type</th>
            <th class="num">Rows</th>
            <th class="num">New</th>
            <th class="num">Already loaded</th>
            <th>Covers</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          {#each app.fileReports as r, i (i + r.fileName)}
            <tr>
              <td class="desc">{r.fileName}</td>
              <td><span class="chip">{typeLabel[r.type]}</span></td>
              <td class="num">{r.rows}</td>
              <td class="num">{r.added}</td>
              <td class="num">{r.duplicates}</td>
              <td class="nowrap">{r.from ? `${dmy(r.from)} → ${r.to ? dmy(r.to) : ''}` : ''}</td>
              <td>
                {#if r.closingCheck === 'ok'}<span class="chip">closing balance matches</span>{/if}
                {#if r.rebalanced > 0}<span class="chip">{r.rebalanced} balances refreshed</span>{/if}
                {#each r.issues.slice(0, 3) as issue, j (j)}
                  <div class="small {issue.level === 'error' ? 'neg' : 'muted'}">
                    {issue.line ? `Line ${issue.line}: ` : ''}{issue.message}
                  </div>
                {/each}
                {#if r.issues.length > 3}<div class="small muted">…and {r.issues.length - 3} more</div>{/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>
{/if}

{#if cov.count > 0}
  <div class="card">
    <h2>What is loaded</h2>
    <div class="stats">
      <div class="stat">
        <div class="label">Transactions</div>
        <div class="value">{cov.count.toLocaleString('en')}</div>
      </div>
      <div class="stat">
        <div class="label">From</div>
        <div class="value">{cov.from ? dmy(cov.from) : '–'}</div>
      </div>
      <div class="stat">
        <div class="label">To</div>
        <div class="value">{cov.to ? dmy(cov.to) : '–'}</div>
      </div>
      <div class="stat">
        <div class="label">Latest balance</div>
        <div class="value">{cov.latestBalance === null ? '–' : eur(cov.latestBalance)}</div>
      </div>
    </div>

    {#if cov.breaks.length === 0 && cov.missingMonths.length === 0}
      <p class="note ok">Every balance follows from the rows before it, and no month is missing.</p>
    {/if}

    {#if cov.breaks.length}
      <p class="note warn">
        <strong>The balance does not add up in {cov.breaks.length} place{cov.breaks.length === 1 ? '' : 's'}.</strong>
        Some transactions are probably missing from the files loaded.
      </p>
      <ul class="small">
        {#each cov.breaks.slice(0, 12) as b, i (i)}
          <li>
            Between {dmy(b.beforeDate)} and {dmy(b.afterDate)}: {eur(b.missing, { sign: true })} unexplained.
          </li>
        {/each}
        {#if cov.breaks.length > 12}<li>…and {cov.breaks.length - 12} more.</li>{/if}
      </ul>
    {/if}

    {#if cov.missingMonths.length}
      <p class="note warn">
        <strong>No transactions at all in:</strong>
        {cov.missingMonths.join(', ')}.
      </p>
    {/if}

    <button class="btn primary" onclick={() => goto('reports')}>Open reports</button>
    <button class="btn" onclick={() => goto('categorise')}>Categorise</button>
  </div>
{:else}
  <div class="card" style="margin-top: 16px">
    <h2>How this works</h2>
    <ul class="muted">
      <li>Export your account movements from the bank as CSV and drop as many files as you have.</li>
      <li>The same transaction in two files is only counted once, so overlapping exports are fine.</li>
      <li>Your data stays in this browser. To keep it, download a workspace file from the Data tab and drop it back in next time, together with any newer exports.</li>
    </ul>
  </div>
{/if}
