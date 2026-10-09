<script lang="ts">
  import type { Category } from '../core/types.ts';

  let {
    categories,
    value,
    onpick,
    noneLabel = 'Uncategorised',
    label,
  }: {
    categories: Category[];
    value: string | null;
    onpick: (id: string | null) => void;
    noneLabel?: string;
    label: string;
  } = $props();

  const groups = $derived.by(() => {
    const m = new Map<string, Category[]>();
    for (const c of categories) {
      const list = m.get(c.group);
      if (list) list.push(c);
      else m.set(c.group, [c]);
    }
    return [...m.entries()];
  });
</script>

<select
  aria-label={label}
  value={value ?? ''}
  onchange={(e) => onpick(e.currentTarget.value || null)}
>
  <option value="">{noneLabel}</option>
  {#each groups as [group, list] (group)}
    <optgroup label={group}>
      {#each list as c (c.id)}
        <option value={c.id}>{c.name}</option>
      {/each}
    </optgroup>
  {/each}
</select>
