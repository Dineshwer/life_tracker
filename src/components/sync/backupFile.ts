import { BACKUP_LISTS } from '../../lib/backup';
import { nounsOf } from './format';

const LISTS = BACKUP_LISTS;

export interface SummaryRow { key: string; label: string; added: number; replaced: number; removed: number }
const idOf = (x: unknown) => { const o = x as Record<string, unknown>; return String(o.id ?? o.date ?? JSON.stringify(o)); };

/** What applying a parsed backup does to the current data: per collection, how many items are new, changed, or no longer present. */
export function summarize(parsed: Record<string, unknown>, current: Record<string, unknown>): { rows: SummaryRow[]; settings: boolean } {
  const rows: SummaryRow[] = [];
  for (const k of LISTS) {
    if (!(k in parsed)) continue;
    const incoming = parsed[k] as unknown[]; const now = ((current[k] as unknown[] | undefined) ?? []);
    const cur = new Map(now.map((x) => [idOf(x), JSON.stringify(x)])); const inc = new Map(incoming.map((x) => [idOf(x), JSON.stringify(x)]));
    let added = 0, replaced = 0, removed = 0;
    for (const [id, v] of inc) { if (!cur.has(id)) added++; else if (cur.get(id) !== v) replaced++; }
    for (const id of cur.keys()) if (!inc.has(id)) removed++;
    if (added || replaced || removed) rows.push({ key: k, label: nounsOf(k), added, replaced, removed });
  }
  return { rows, settings: 'settings' in parsed && JSON.stringify(parsed.settings) !== JSON.stringify(current.settings) };
}
