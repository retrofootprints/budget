<script lang="ts">
  import { app } from '../store.svelte.ts';
  import { dmy } from '../format.ts';
  import { BUILTIN_RULES } from '../../core/defaults.ts';
  import type { CategoryType, Rule } from '../../core/types.ts';
  import CategorySelect from '../CategorySelect.svelte';

  const types: { id: CategoryType; label: string; hint: string }[] = [
    { id: 'income', label: 'Income', hint: 'counts as money earned' },
    { id: 'expense', label: 'Spending', hint: 'counts as money spent; refunds reduce it' },
    { id: 'savings', label: 'Savings', hint: 'money parked; left out of income and spending' },
    { id: 'ignore', label: 'Ignore', hint: 'not counted anywhere' },
  ];

  // New category
  let newName = $state('');
  let newGroup = $state('');
  let newType = $state<CategoryType>('expense');

  // New period
  let pName = $state('');
  let pFrom = $state('');
  let pTo = $state('');

  const cats = $derived(app.config.categories);
  const catName = (id: string) => cats.find((c) => c.id === id)?.name ?? '(deleted)';
  const groupNames = $derived([...new Set(cats.map((c) => c.group))]);
  const userRules = $derived(app.config.rules);
  const aliasEntries = $derived(Object.entries(app.config.aliases).sort((a, b) => a[1].localeCompare(b[1])));

  function describeRule(r: Rule): string {
    const parts: string[] = [];
    if (r.name) parts.push(`name ≈ ${r.name}`);
    if (r.contains) parts.push(`contains "${r.contains}"`);
    if (r.kind) parts.push(`kind ${r.kind}`);
    if (r.direction) parts.push(r.direction === 'in' ? 'money in' : 'money out');
    if (r.minAmount !== undefined) parts.push(`≥ ${r.minAmount / 100}`);
    if (r.maxAmount !== undefined) parts.push(`≤ ${r.maxAmount / 100}`);
    const p = r.periodId ? app.config.periods.find((x) => x.id === r.periodId) : undefined;
    if (p) parts.push(`during ${p.name}`);
    else if (r.from || r.to) parts.push(`${r.from ? dmy(r.from) : '…'} → ${r.to ? dmy(r.to) : '…'}`);
    return parts.join(' · ') || '(no conditions)';
  }

  function addCategory() {
    if (!newName.trim()) return;
    app.addCategory({ name: newName.trim(), group: newGroup.trim() || 'Other', type: newType });
    newName = '';
  }

  function addPeriod() {
    if (!pName.trim() || !pFrom || !pTo || pFrom > pTo) return;
    app.addPeriod({ name: pName.trim(), from: pFrom, to: pTo });
    pName = '';
    pFrom = '';
    pTo = '';
  }

  const usedBy = (id: string) => app.rows.filter((r) => r.categoryId === id).length;
</script>

<h1>Rules and categories</h1>

<div class="card">
  <h2>Rules ({userRules.length})</h2>
  <p class="muted small">
    Your rules, strongest first. A manual change on a single transaction beats every rule; your rules beat the
    {BUILTIN_RULES.length} built-in ones. Create rules from the Categorise tab.
  </p>
  {#if userRules.length === 0}
    <p class="muted">No rules yet.</p>
  {:else}
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>Matches</th><th>Category</th><th class="num">Priority</th><th></th></tr>
        </thead>
        <tbody>
          {#each userRules as r (r.id)}
            <tr>
              <td class="desc">
                {describeRule(r)}
                {#if r.name && app.config.aliases[r.name]}<span class="chip">{app.config.aliases[r.name]}</span>{/if}
              </td>
              <td>
                <CategorySelect
                  categories={cats}
                  value={r.categoryId}
                  label="Category for this rule"
                  onpick={(id) => id && app.updateRule(r.id, { categoryId: id })}
                />
              </td>
              <td class="num">
                <input
                  type="number"
                  style="width: 4.5em"
                  aria-label="Priority"
                  value={r.priority ?? 0}
                  onchange={(e) => app.updateRule(r.id, { priority: Number(e.currentTarget.value) || 0 })}
                />
              </td>
              <td><button class="btn small danger" onclick={() => app.removeRule(r.id)}>Delete</button></td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

<div class="grid cols-2">
  <div class="card">
    <h2>Periods</h2>
    <p class="muted small">
      A named stretch of time, for example a work trip. Rules can be limited to a period, and reports shade it.
    </p>
    {#each app.config.periods as p (p.id)}
      <div class="toolbar">
        <strong>{p.name}</strong>
        <span class="muted small">{dmy(p.from)} → {dmy(p.to)}</span>
        <button class="btn small danger" onclick={() => app.removePeriod(p.id)}>Delete</button>
      </div>
    {/each}
    <div class="toolbar">
      <input type="text" placeholder="Name" aria-label="Period name" bind:value={pName} />
      <input type="date" aria-label="From" bind:value={pFrom} />
      <input type="date" aria-label="To" bind:value={pTo} />
      <button class="btn" disabled={!pName.trim() || !pFrom || !pTo || pFrom > pTo} onclick={addPeriod}>Add</button>
    </div>
  </div>

  <div class="card">
    <h2>Names ({aliasEntries.length})</h2>
    <p class="muted small">Names you gave to phone numbers and transfer parties.</p>
    {#if aliasEntries.length === 0}
      <p class="muted">None yet. Name people in the Categorise tab.</p>
    {/if}
    {#each aliasEntries as [key, alias] (key)}
      <div class="toolbar">
        <input
          type="text"
          value={alias}
          aria-label={`Name for ${key}`}
          onchange={(e) => app.setAlias(key, e.currentTarget.value)}
        />
        <span class="muted small">{key}</span>
        <button class="btn small" onclick={() => app.setAlias(key, '')}>Remove</button>
      </div>
    {/each}
  </div>
</div>

<div class="card">
  <h2>Categories</h2>
  <div class="table-wrap">
    <table>
      <thead>
        <tr><th>Name</th><th>Group</th><th>Counts as</th><th class="num">Uses</th><th></th></tr>
      </thead>
      <tbody>
        {#each cats as c (c.id)}
          <tr>
            <td>
              <input
                type="text"
                value={c.name}
                aria-label="Category name"
                onchange={(e) => app.updateCategory(c.id, { name: e.currentTarget.value.trim() || c.name })}
              />
            </td>
            <td>
              <input
                type="text"
                value={c.group}
                aria-label="Group"
                list="groups"
                onchange={(e) => app.updateCategory(c.id, { group: e.currentTarget.value.trim() || c.group })}
              />
            </td>
            <td>
              <select
                aria-label="Counts as"
                value={c.type}
                onchange={(e) => app.updateCategory(c.id, { type: e.currentTarget.value as CategoryType })}
              >
                {#each types as t (t.id)}<option value={t.id}>{t.label}</option>{/each}
              </select>
            </td>
            <td class="num">{usedBy(c.id)}</td>
            <td><button class="btn small danger" onclick={() => app.removeCategory(c.id)}>Delete</button></td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
  <datalist id="groups">
    {#each groupNames as g (g)}<option value={g}></option>{/each}
  </datalist>

  <h3 style="margin-top: 16px">Add a category</h3>
  <div class="toolbar">
    <input type="text" placeholder="Name" aria-label="New category name" bind:value={newName} />
    <input type="text" placeholder="Group" aria-label="New category group" list="groups" bind:value={newGroup} />
    <select bind:value={newType} aria-label="Counts as">
      {#each types as t (t.id)}<option value={t.id}>{t.label}: {t.hint}</option>{/each}
    </select>
    <button class="btn" disabled={!newName.trim()} onclick={addCategory}>Add</button>
  </div>
  <p class="muted small">
    Deleting a category also removes the rules and manual changes that pointed at it; those transactions become
    uncategorised.
  </p>
</div>
