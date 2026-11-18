import type { ConflictEntry, SyncInfo } from '../../sync/types';

const NOUN: Record<string, string> = {
  habits: 'habit', habitLogs: 'habit check-in', tasks: 'task', blocks: 'schedule block', workouts: 'workout', body: 'body measurement',
  journal: 'journal entry', rewards: 'reward', xp: 'XP entry', wake: 'wake-up log', books: 'book', conversations: 'conversation',
  rejections: 'rejection', videos: 'video', channels: 'channel', oneLogs: 'daily exercise log', kv: 'saved setting', meta: 'settings',
};
export const nounOf = (collection: string) => NOUN[collection] ?? collection;

export function relTime(iso: string | undefined, now = Date.now()): string {
  if (!iso) return 'never';
  const t = Date.parse(iso); if (Number.isNaN(t)) return 'unknown';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60); if (m < 60) return m === 1 ? '1 minute ago' : `${m} minutes ago`;
  const h = Math.round(m / 60); if (h < 24) return h === 1 ? '1 hour ago' : `${h} hours ago`;
  const d = Math.round(h / 24); if (d < 14) return d === 1 ? 'yesterday' : `${d} days ago`;
  return new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** 'YYYY-MM-DD' shown in the reader's calendar without timezone drift. */
export function dayLabel(taken_on: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(taken_on); if (!m) return taken_on;
  return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

export const plural = (n: number, one: string, many = one + 's') => `${n.toLocaleString('en-IN')} ${n === 1 ? one : many}`;

/** Turn an engine or network error into a calm sentence fragment. */
export function readableError(e?: unknown): string {
  const raw = (e instanceof Error ? e.message : typeof e === 'string' ? e : '').trim();
  if (!raw) return 'something went wrong';
  if (/failed to fetch|network|load failed|timeout|timed out|offline/i.test(raw)) return 'the cloud could not be reached';
  if (/jwt|token|unauthori[sz]ed|401|403|expired|not authenticated/i.test(raw)) return 'your sign-in has expired. Sign out and sign back in';
  if (/rate|too many|once per|429/i.test(raw)) return 'that was tried too recently. Wait a few minutes and try again';
  return raw.charAt(0).toLowerCase() + raw.slice(1).replace(/\.$/, '');
}
export const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1) + (/[.!?]$/.test(s) ? '' : '.');

export type Tone = 'ok' | 'busy' | 'warn' | 'bad' | 'idle';
export interface Headline { tone: Tone; title: string; detail: string }
export function headline(info: SyncInfo, online: boolean, now = Date.now()): Headline {
  if (info.status === 'off') return { tone: 'idle', title: 'Not syncing', detail: 'Waiting to connect to your account.' };
  if (info.status === 'error') return { tone: 'bad', title: `Problem: ${readableError(info.error)}`, detail: 'Your data is safe on this device. Sync will keep trying.' };
  if (info.status === 'offline' || !online) return { tone: 'warn', title: 'Offline', detail: 'Changes are saved on this device and will upload when you are back online.' };
  if (info.status === 'syncing') return { tone: 'busy', title: 'Syncing…', detail: 'Sending and receiving changes.' };
  return { tone: 'ok', title: `Synced ${relTime(info.lastSyncAt, now)}`, detail: 'This device matches your cloud copy.' };
}

const itemName = (c: ConflictEntry): string => {
  for (const v of [c.local, c.remote]) {
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      for (const k of ['title', 'name', 'text', 'label', 'exercise', 'person', 'date']) if (typeof o[k] === 'string' && o[k]) return String(o[k]);
    }
  }
  return c.id.replace(/^wake:/, '');
};
const FIELD: Record<string, string> = { minutes: 'minutes', done: 'done', title: 'title', name: 'name', notes: 'notes', note: 'notes', amount: 'amount', cost: 'cost' };
const fieldList = (f?: string[]) => (f && f.length ? ` (${f.slice(0, 3).map((x) => FIELD[x] ?? x).join(', ')}${f.length > 3 ? ', …' : ''})` : '');

export function describeConflict(c: ConflictEntry): { what: string; sentence: string } {
  const n = nounOf(c.collection); const name = itemName(c);
  const what = c.collection === 'meta' ? 'Settings' : `${n.charAt(0).toUpperCase() + n.slice(1)}: ${name}`;
  const the = c.collection === 'meta' ? 'your settings' : `the ${n} '${name}'`;
  switch (c.kind) {
    case 'server-won': return { what, sentence: `Your edit to ${the}${fieldList(c.fields)} on this device was replaced by a newer edit from another device.` };
    case 'local-won': return { what, sentence: `Your edit to ${the}${fieldList(c.fields)} was kept. An older edit from another device was not applied.` };
    case 'merged': return { what, sentence: `Edits to ${the}${fieldList(c.fields)} on two devices were combined into one.` };
    case 'deleted-remotely': return { what, sentence: `${the.charAt(0).toUpperCase() + the.slice(1)} was deleted on another device, so it was removed from this one.` };
    case 'deleted-locally': return { what, sentence: `You deleted ${the} on this device while another device changed it. The other device's change was kept and the item is back.` };
  }
}
export const nounsOf = (collection: string) => { const n = nounOf(collection); return n === 'XP entry' ? 'XP entries' : n === 'saved setting' ? 'saved settings' : n.endsWith('y') ? n.slice(0, -1) + 'ies' : n + 's'; };
