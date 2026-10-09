<script lang="ts">
  import { Chart, registerables } from 'chart.js';
  import type { ChartConfiguration, Plugin } from 'chart.js';
  import type { Band } from './chartTypes.ts';

  Chart.register(...registerables);

  let {
    config,
    bands = [],
    label,
    tall = false,
  }: { config: ChartConfiguration; bands?: Band[]; label: string; tall?: boolean } = $props();

  let canvas: HTMLCanvasElement;

  function token(name: string, fallback: string): string {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  }

  /** Shades named periods behind the datasets, with the name along the top. */
  function bandsPlugin(list: Band[]): Plugin {
    return {
      id: 'periodBands',
      beforeDatasetsDraw(chart) {
        const x = chart.scales['x'];
        if (!x || list.length === 0) return;
        const { ctx, chartArea } = chart;
        const step = x.getPixelForValue(1) - x.getPixelForValue(0);
        const half = Number.isFinite(step) && step > 0 ? step / 2 : 0;
        ctx.save();
        ctx.font = '11px system-ui, sans-serif';
        for (const b of list) {
          const left = Math.max(chartArea.left, x.getPixelForValue(b.from) - half);
          const right = Math.min(chartArea.right, x.getPixelForValue(b.to) + half);
          if (right <= left) continue;
          ctx.fillStyle = token('--band', 'rgba(0,0,0,0.08)');
          ctx.fillRect(left, chartArea.top, right - left, chartArea.bottom - chartArea.top);
          ctx.fillStyle = token('--ink-2', '#555');
          ctx.textBaseline = 'top';
          ctx.fillText(b.label, left + 4, chartArea.top + 3, Math.max(0, right - left - 6));
        }
        ctx.restore();
      },
    };
  }

  $effect(() => {
    const cfg = config;
    const list = bands;
    const chart = new Chart(canvas, { ...cfg, plugins: [bandsPlugin(list), ...(cfg.plugins ?? [])] });
    return () => chart.destroy();
  });
</script>

<div class="chart" class:tall role="img" aria-label={label}>
  <canvas bind:this={canvas}></canvas>
</div>
