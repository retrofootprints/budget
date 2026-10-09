import { categorise } from '../core/categorise.ts';
import { defaultConfig } from '../core/defaults.ts';
import { coverage, ingest, newId } from '../core/ingest.ts';
import type { FileReport } from '../core/ingest.ts';
import type { Category, Config, Period, Rule, Tx } from '../core/types.ts';
import { sanitiseConfig, serialiseConfig, serialiseWorkspace, toFlatCsv } from '../core/workspace.ts';
import { dbErase, dbGet, dbSet } from './db.ts';
import { download, today } from './format.ts';

const REMEMBER_KEY = 'budget.remember';

interface Saved {
  version: 1;
  txs: Tx[];
  config: unknown;
}

function isSaved(v: unknown): v is Saved {
  return typeof v === 'object' && v !== null && (v as Saved).version === 1 && Array.isArray((v as Saved).txs);
}

class AppStore {
  // Plain (non-proxied) state: these are replaced wholesale, never mutated.
  txs = $state.raw<Tx[]>([]);
  config = $state.raw<Config>(defaultConfig());
  fileReports = $state.raw<FileReport[]>([]);

  ready = $state(false);
  busy = $state(false);
  remember = $state(true);
  saveError = $state<string | null>(null);
  restored = $state(false);

  analysis = $derived.by(() => categorise(this.txs, this.config));
  cov = $derived.by(() => coverage(this.txs));

  private saveTimer: ReturnType<typeof setTimeout> | undefined;

  get rows() {
    return this.analysis.rows;
  }

  get categories() {
    return this.analysis.categories;
  }

  async init(): Promise<void> {
    try {
      this.remember = localStorage.getItem(REMEMBER_KEY) !== 'off';
    } catch {
      /* storage blocked: keep the default */
    }
    if (this.remember) {
      try {
        const saved = await dbGet<unknown>('workspace');
        if (isSaved(saved) && saved.txs.length) {
          this.txs = saved.txs;
          this.config = sanitiseConfig(saved.config);
          this.restored = true;
        }
      } catch {
        /* nothing remembered */
      }
    }
    this.ready = true;
  }

  async addFiles(files: File[]): Promise<void> {
    this.busy = true;
    try {
      let ws = { txs: this.txs, config: this.config };
      const reports: FileReport[] = [];
      for (const f of files) {
        const bytes = new Uint8Array(await f.arrayBuffer());
        const r = ingest(ws, f.name, bytes);
        ws = r.ws;
        reports.push(r.report);
      }
      this.txs = ws.txs;
      this.config = ws.config;
      this.fileReports = [...reports, ...this.fileReports].slice(0, 50);
      this.restored = false;
      this.queueSave();
    } finally {
      this.busy = false;
    }
  }

  // ---- configuration edits -------------------------------------------------

  private setConfig(next: Config): void {
    this.config = next;
    this.queueSave();
  }

  setOverride(txId: string, categoryId: string | null): void {
    const overrides = { ...this.config.overrides };
    if (categoryId === null) delete overrides[txId];
    else overrides[txId] = categoryId;
    this.setConfig({ ...this.config, overrides });
  }

  addRule(rule: Omit<Rule, 'id'>): void {
    this.setConfig({ ...this.config, rules: [...this.config.rules, { id: newId('rule'), ...rule }] });
  }

  updateRule(id: string, patch: Partial<Rule>): void {
    this.setConfig({
      ...this.config,
      rules: this.config.rules.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    });
  }

  removeRule(id: string): void {
    this.setConfig({ ...this.config, rules: this.config.rules.filter((r) => r.id !== id) });
  }

  setAlias(name: string, alias: string): void {
    const aliases = { ...this.config.aliases };
    const v = alias.trim();
    if (v) aliases[name] = v;
    else delete aliases[name];
    this.setConfig({ ...this.config, aliases });
  }

  addCategory(c: Omit<Category, 'id'>): void {
    this.setConfig({ ...this.config, categories: [...this.config.categories, { id: newId('cat'), ...c }] });
  }

  updateCategory(id: string, patch: Partial<Category>): void {
    this.setConfig({
      ...this.config,
      categories: this.config.categories.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    });
  }

  removeCategory(id: string): void {
    this.setConfig({
      ...this.config,
      categories: this.config.categories.filter((c) => c.id !== id),
      rules: this.config.rules.filter((r) => r.categoryId !== id),
      overrides: Object.fromEntries(Object.entries(this.config.overrides).filter(([, v]) => v !== id)),
    });
  }

  addPeriod(p: Omit<Period, 'id'>): void {
    this.setConfig({ ...this.config, periods: [...this.config.periods, { id: newId('period'), ...p }] });
  }

  removePeriod(id: string): void {
    this.setConfig({
      ...this.config,
      periods: this.config.periods.filter((p) => p.id !== id),
      rules: this.config.rules.filter((r) => r.periodId !== id),
    });
  }

  // ---- persistence ---------------------------------------------------------

  private queueSave(): void {
    if (!this.remember) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.saveNow(), 400);
  }

  private async saveNow(): Promise<void> {
    try {
      const payload: Saved = { version: 1, txs: this.txs, config: this.config };
      await dbSet('workspace', payload);
      this.saveError = null;
    } catch {
      this.saveError =
        'This browser would not store the data. It will be lost when you close the page; export a workspace file.';
    }
  }

  async setRemember(on: boolean): Promise<void> {
    this.remember = on;
    try {
      localStorage.setItem(REMEMBER_KEY, on ? 'on' : 'off');
    } catch {
      /* ignore */
    }
    if (on) await this.saveNow();
    else await dbErase();
  }

  /** Remove everything from memory and from this browser's storage. */
  async eraseAll(): Promise<void> {
    clearTimeout(this.saveTimer);
    this.txs = [];
    this.config = defaultConfig();
    this.fileReports = [];
    this.restored = false;
    await dbErase();
    try {
      localStorage.removeItem(REMEMBER_KEY);
    } catch {
      /* ignore */
    }
    this.remember = true;
  }

  // ---- exports -------------------------------------------------------------

  exportWorkspace(): void {
    download(`budget-workspace-${today()}.json`, serialiseWorkspace(this.txs, this.config), 'application/json');
  }

  exportConfig(): void {
    download(`budget-config-${today()}.json`, serialiseConfig(this.config), 'application/json');
  }

  exportCsv(decimal: ',' | '.'): void {
    download(
      `budget-transactions-${today()}.csv`,
      toFlatCsv(this.rows, this.config, { decimal }),
      'text/csv;charset=utf-8',
    );
  }
}

export const app = new AppStore();
