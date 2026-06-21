// In-memory cache backed by the two Google Sheets workbooks, accessed via
// the Apps Script Web App (ACC_Sheets_API.gs). Reads are served from memory.
// Writes update memory immediately and push the single changed row to
// Sheets in the background. A periodic refresh reconciles against manual
// edits made directly in the Sheet.

import fetch from 'node-fetch';

const SHEETS_API_BASE = process.env.SHEETS_API_BASE!; // the .../exec URL
const SHEETS_API_KEY = process.env.SHEETS_API_KEY!;
const REFRESH_INTERVAL_MS = Number(process.env.SHEETS_REFRESH_INTERVAL_MS || 5 * 60 * 1000);

type Book = 'operational' | 'config';
type Row = Record<string, any>;

const TABLES: { name: string; book: Book; cacheKey: string }[] = [
  { name: 'Lubrication Points',           book: 'operational', cacheKey: 'lubricationPoints' },
  { name: 'Lubrication History',          book: 'operational', cacheKey: 'lubricationRecords' },
  { name: 'Oil Samples',                  book: 'operational', cacheKey: 'oilSamples' },
  { name: 'Oil Sample Parameters',        book: 'operational', cacheKey: 'oilSampleParameters' },
  { name: 'Action Plans',                 book: 'operational', cacheKey: 'actionPlans' },
  { name: 'Routes',                       book: 'operational', cacheKey: 'routes' },
  { name: 'Route Assignments',            book: 'operational', cacheKey: 'routeAssignments' },
  { name: 'Route Execution Log',          book: 'operational', cacheKey: 'routeExecutionLog' },
  { name: 'Notifications',                book: 'operational', cacheKey: 'notifications' },
  { name: 'Audit Log',                    book: 'operational', cacheKey: 'auditLog' },
  { name: 'Oil Purchase Log',             book: 'operational', cacheKey: 'oilPurchaseLog' },
  { name: 'Users',                        book: 'config', cacheKey: 'users' },
  { name: 'Titles',                       book: 'config', cacheKey: 'titles' },
  { name: 'Permission Templates',         book: 'config', cacheKey: 'permissionTemplates' },
  { name: 'Organizations',                book: 'config', cacheKey: 'organizations' },
  { name: 'Equipment',                    book: 'config', cacheKey: 'equipment' },
  { name: 'Areas',                        book: 'config', cacheKey: 'areas' },
  { name: 'Lubricant Types',              book: 'config', cacheKey: 'lubricantTypes' },
  { name: 'Action Types',                 book: 'config', cacheKey: 'actionTypes' },
  { name: 'Notification Types & Routing', book: 'config', cacheKey: 'notificationTypes' },
  { name: 'General Settings',             book: 'config', cacheKey: 'generalSettings' },
];

class SheetsCache {
  private store: Record<string, Row[]> = {};
  private loaded = false;
  private loadingPromise: Promise<void> | null = null;

  private async apiGet(book: Book, sheet: string, action: string, extra: Record<string, string> = {}) {
    const params = new URLSearchParams({ apiKey: SHEETS_API_KEY, book, sheet, action, ...extra });
    const res = await fetch(`${SHEETS_API_BASE}?${params.toString()}`);
    const json: any = await res.json();
    if (!json.ok) throw new Error(`Sheets API error (${book}/${sheet}/${action}): ${json.error}`);
    return json;
  }

  private async apiPost(book: Book, sheet: string, action: string, body: Record<string, any>) {
    const res = await fetch(SHEETS_API_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: SHEETS_API_KEY, book, sheet, action, ...body }),
    });
    const json: any = await res.json();
    if (!json.ok) throw new Error(`Sheets API error (${book}/${sheet}/${action}): ${json.error}`);
    return json;
  }

  async loadAll(): Promise<void> {
    if (this.loadingPromise) return this.loadingPromise;
    this.loadingPromise = (async () => {
      const start = Date.now();
      for (const t of TABLES) {
        const { rows } = await this.apiGet(t.book, t.name, 'getAll');
        this.store[t.cacheKey] = rows;
      }
      this.loaded = true;
      console.log(`[sheetsCache] loaded ${TABLES.length} tables in ${Date.now() - start}ms`);
    })();
    await this.loadingPromise;
    this.loadingPromise = null;
  }

  startBackgroundRefresh() {
    setInterval(() => {
      this.loadAll().catch(err => console.error('[sheetsCache] background refresh failed:', err));
    }, REFRESH_INTERVAL_MS);
  }

  isReady() { return this.loaded; }

  getAll(cacheKey: string): Row[] {
    return this.store[cacheKey] || [];
  }

  getByKey(cacheKey: string, keyColumn: string, keyValue: any): Row | undefined {
    return this.getAll(cacheKey).find(r => String(r[keyColumn]) === String(keyValue));
  }

  async append(cacheKey: string, row: Row): Promise<void> {
    const table = TABLES.find(t => t.cacheKey === cacheKey);
    if (!table) throw new Error(`Unknown cache key: ${cacheKey}`);
    this.store[cacheKey] = [...(this.store[cacheKey] || []), row]; // instant
    this.apiPost(table.book, table.name, 'append', { row }).catch(err =>
      console.error(`[sheetsCache] background append to ${table.name} failed (will reconcile on next refresh):`, err)
    );
  }

  async update(cacheKey: string, keyColumn: string, keyValue: any, updates: Row): Promise<void> {
    const table = TABLES.find(t => t.cacheKey === cacheKey);
    if (!table) throw new Error(`Unknown cache key: ${cacheKey}`);
    const rows = this.store[cacheKey] || [];
    const idx = rows.findIndex(r => String(r[keyColumn]) === String(keyValue));
    if (idx === -1) throw new Error(`No row found in ${cacheKey} where ${keyColumn} = ${keyValue}`);
    rows[idx] = { ...rows[idx], ...updates }; // instant
    this.apiPost(table.book, table.name, 'update', { keyColumn, keyValue, updates }).catch(err =>
      console.error(`[sheetsCache] background update to ${table.name} failed (will reconcile on next refresh):`, err)
    );
  }

  async remove(cacheKey: string, keyColumn: string, keyValue: any): Promise<void> {
    const table = TABLES.find(t => t.cacheKey === cacheKey);
    if (!table) throw new Error(`Unknown cache key: ${cacheKey}`);
    this.store[cacheKey] = (this.store[cacheKey] || []).filter(r => String(r[keyColumn]) !== String(keyValue)); // instant
    this.apiPost(table.book, table.name, 'delete', { keyColumn, keyValue }).catch(err =>
      console.error(`[sheetsCache] background delete from ${table.name} failed (will reconcile on next refresh):`, err)
    );
  }
}

export const sheetsCache = new SheetsCache();
