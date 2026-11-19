/* GOLDEN FIXTURES for the "typed tables" migration. Every item here is (or, for `invalid`, is not) accepted by validateItem
   (src/lib/validate.ts). The typed tables must map to and from exactly these JSON objects (see roundtrip.ts, README.md).

   Groups per collection:
     typical  realistic items (seed.ts / demo.ts / app-written shapes)
     edge     valid, at the validator's limits: max-length strings, unicode, empty arrays, optional field missing vs '' , nested data,
              numeric bounds, odd ids, boundary dates, free-form timestamp strings
     nulls    valid because the validator treats null like absent for optional fields; null is NOT the same as missing for the round trip
     extras   valid because the validator keeps unknown extra fields ("Unknown extra fields are kept"); typed columns cannot hold them
              unless the mapping keeps an overflow jsonb column
     invalid  { name, item } that validateItem must reject (one defect each) */
import { COLLECTIONS, type Collection } from '../../../src/sync/types';
import { TOPICS } from '../../../src/entertainment/contract';

export type Obj = Record<string, unknown>;
export interface Invalid { name: string; item: unknown }
export interface CollectionFixtures { typical: Obj[]; edge: Obj[]; nulls: Obj[]; extras: Obj[]; invalid: Invalid[] }
export const VALID_GROUPS = ['typical', 'edge', 'nulls', 'extras'] as const;
export type ValidGroup = (typeof VALID_GROUPS)[number];

/* ---------- string helpers (lengths are JS UTF-16 units, exactly like validate.ts counts them) ---------- */
/** String of EXACTLY n UTF-16 units mixing ASCII, accents, CJK, RTL, combining marks, ZWJ emoji and astral emoji (never splits a surrogate pair). */
export function uni(n: number, seed = 0): string {
  const parts = ['a', 'é', '日本語', 'שלום', 'e\u0301', '😀', '👨\u200D👩\u200D👧', '🇮🇳', 'ß', '"', '\\', "'", '\n', '\t', '<b>&amp;</b>', '%', '_', '{"k":[1,null]}', '\u2028', '\u00A0'];
  let out = '', i = seed;
  while (out.length < n) {
    const p = parts[i++ % parts.length];
    if (out.length + p.length <= n) out += p; else out += n - out.length === 1 ? 'x' : 'ab'.slice(0, n - out.length);
  }
  return out;
}
export const rep = (ch: string, n: number) => ch.repeat(n).slice(0, n);
const ascii = (n: number) => rep('lorem ipsum dolor sit amet. ', n);
const id200 = 'ü:😀:' + uni(195); // exactly 200 units: colon, accents, astral chars
const ID200 = (() => { let s = 'x'; while (s.length < 200) s += ':' + s.length; return s.slice(0, 200); })();
const sumKeys = (n: number) => Array.from({ length: n }, (_, i) => `k${i}`);

/** Copy `base`, apply patch (a value of undefined deletes the key). */
const mut = (base: Obj, patch: Obj): Obj => { const o: Obj = { ...base }; for (const k in patch) { if (patch[k] === undefined) delete o[k]; else o[k] = patch[k]; } return o; };
const inv = (base: Obj, name: string, patch: Obj): Invalid => ({ name, item: mut(base, patch) });
const BAD_STRINGS: [string, string][] = [['NUL char', 'a\u0000b'], ['lone high surrogate', 'a\uD800b'], ['lone low surrogate', 'a\uDC00b']];

/* ---------- date / time boundaries ---------- */
export const DATES = ['1970-01-01', '2000-02-29', '2024-02-29', '2026-11-19', '2099-12-31', '2200-12-31'];
const D0 = '1970-01-01', D1 = '2200-12-31', DL = '2024-02-29';

const F = {} as Record<Collection, CollectionFixtures>;

/* ---------------- habits ---------------- */
{
  const base: Obj = { id: 'meditate', name: 'Meditation', stat: 'mind', cadence: { type: 'daily' }, xp: 20, minimum: '2 minutes of breathing' };
  F.habits = {
    typical: [
      base,
      { id: 'read', name: 'Reading', stat: 'mind', cadence: { type: 'daily' }, xp: 15, minimum: '1 page' },
      { id: 'gym', name: 'Gym', stat: 'body', cadence: { type: 'weekly', perWeek: 4 }, xp: 30, minimum: '15 min mobility or one lift' },
      { id: 'run', name: 'Run', stat: 'body', cadence: { type: 'days', days: [1, 3, 5] }, xp: 25, unit: { label: 'minutes', target: 20 } },
      { id: 'old', name: 'Retired', stat: 'discipline', cadence: { type: 'daily' }, xp: 10, archived: true },
    ],
    edge: [
      { id: ID200, name: uni(200), stat: 'skill', cadence: { type: 'days', days: [0, 1, 2, 3, 4, 5, 6] }, xp: 100000, minimum: uni(2000), archived: true, unit: { label: uni(100), target: 1e6 } },
      { id: 'a', name: 'x', stat: 'body', cadence: { type: 'weekly', perWeek: 1 }, xp: 0 },
      { id: 'h:7', name: 'seven', stat: 'body', cadence: { type: 'weekly', perWeek: 7 }, xp: 1, minimum: '', archived: false },
      { id: 'h-empty-days', name: 'No days', stat: 'mind', cadence: { type: 'days', days: [] }, xp: 5 },
      { id: 'h-dupdays', name: 'Duplicate and unordered days', stat: 'mind', cadence: { type: 'days', days: [6, 0, 6, 3] }, xp: 5 },
      { id: 'h-unit0', name: 'Unit target zero', stat: 'skill', cadence: { type: 'daily' }, xp: 12.5, unit: { label: '', target: 0 } },
      { id: 'h-frac', name: 'Fractional', stat: 'skill', cadence: { type: 'weekly', perWeek: 2.5 }, xp: 0.1, unit: { label: 'km', target: 0.5 } },
      { id: 'ünï:cödé/😀', name: '名前 😀', stat: 'discipline', cadence: { type: 'daily' }, xp: 1 },
      { id: id200, name: 'unicode 200-unit id', stat: 'discipline', cadence: { type: 'daily' }, xp: 1 },
    ],
    nulls: [{ id: 'h-null', name: 'Nulls', stat: 'mind', cadence: { type: 'daily' }, xp: 3, minimum: null, archived: null, unit: null }],
    extras: [mut(base, { id: 'h-extra', color: '#ff0', sortOrder: 3, nested: { a: [1, { b: null }] } })],
    invalid: [
      inv(base, 'empty id', { id: '' }), inv(base, 'id 201 units', { id: rep('i', 201) }), inv(base, 'missing id', { id: undefined }), inv(base, 'numeric id', { id: 5 }),
      inv(base, 'empty name', { name: '' }), inv(base, 'name 201', { name: rep('n', 201) }), inv(base, 'unknown stat', { stat: 'luck' }),
      inv(base, 'xp negative', { xp: -1 }), inv(base, 'xp over max', { xp: 100001 }), inv(base, 'xp string', { xp: '20' }), inv(base, 'xp NaN', { xp: NaN }), inv(base, 'xp Infinity', { xp: Infinity }),
      inv(base, 'minimum 2001', { minimum: rep('m', 2001) }), inv(base, 'minimum number', { minimum: 5 }), inv(base, 'archived string', { archived: 'yes' }),
      inv(base, 'cadence missing', { cadence: undefined }), inv(base, 'cadence unknown type', { cadence: { type: 'monthly' } }), inv(base, 'cadence string', { cadence: 'daily' }),
      inv(base, 'weekly perWeek 0', { cadence: { type: 'weekly', perWeek: 0 } }), inv(base, 'weekly perWeek 8', { cadence: { type: 'weekly', perWeek: 8 } }), inv(base, 'weekly without perWeek', { cadence: { type: 'weekly' } }),
      inv(base, 'days missing', { cadence: { type: 'days' } }), inv(base, 'days has 7 (out of range)', { cadence: { type: 'days', days: [7] } }), inv(base, 'days 8 entries', { cadence: { type: 'days', days: [0, 1, 2, 3, 4, 5, 6, 0] } }), inv(base, 'days contains string', { cadence: { type: 'days', days: ['1'] } }),
      inv(base, 'unit without target', { unit: { label: 'x' } }), inv(base, 'unit label 101', { unit: { label: rep('u', 101), target: 1 } }), inv(base, 'unit target negative', { unit: { label: 'x', target: -1 } }), inv(base, 'unit target 1e6+1', { unit: { label: 'x', target: 1e6 + 1 } }),
      ...BAD_STRINGS.map(([n, s]) => inv(base, `name with ${n}`, { name: s })),
    ],
  };
}

/* ---------------- habitLogs ---------------- */
{
  const base: Obj = { id: 'hl:meditate:2026-11-01', habitId: 'meditate', date: '2026-11-01', level: 'full' };
  F.habitLogs = {
    typical: [base, { id: 'hl:run:2026-11-02', habitId: 'run', date: '2026-11-02', level: 'min', amount: 20, note: 'felt good' }],
    edge: [
      { id: ID200, habitId: ID200, date: D0, level: 'min', amount: 0, note: '' },
      { id: 'hl:é:' + D1, habitId: 'é', date: D1, level: 'full', amount: 1e7, note: uni(200_000) },
      { id: 'hl-leap', habitId: 'x', date: DL, level: 'full', amount: 0.5 },
      { id: 'hl-frac', habitId: 'x', date: '2000-02-29', level: 'full', amount: 1234567.891 },
      { id: 'hl-multiline', habitId: 'x', date: '2099-12-31', level: 'full', note: 'line1\r\nline2\n\ttabbed 😀' },
      { id: 'hl:orphan', habitId: 'does-not-exist', date: '2026-01-01', level: 'full' },
    ],
    nulls: [{ ...base, id: 'hl-null', amount: null, note: null }],
    extras: [mut(base, { id: 'hl-extra', source: 'import' })],
    invalid: [
      inv(base, 'empty id', { id: '' }), inv(base, 'missing habitId', { habitId: undefined }), inv(base, 'empty habitId', { habitId: '' }), inv(base, 'habitId 201', { habitId: rep('h', 201) }),
      inv(base, 'date Feb 30', { date: '2026-02-30' }), inv(base, 'date 1969', { date: '1969-12-31' }), inv(base, 'date 2201', { date: '2201-01-01' }), inv(base, 'date not zero padded', { date: '2026-1-1' }), inv(base, 'date with time', { date: '2026-11-01T00:00:00Z' }), inv(base, 'date non-leap Feb 29', { date: '2026-02-29' }), inv(base, 'date missing', { date: undefined }), inv(base, 'date number', { date: 20261101 }),
      inv(base, 'level unknown', { level: 'half' }), inv(base, 'level missing', { level: undefined }),
      inv(base, 'amount negative', { amount: -1 }), inv(base, 'amount 1e7+1', { amount: 1e7 + 1 }), inv(base, 'amount string', { amount: '5' }),
      inv(base, 'note over 200000', { note: rep('n', 200_001) }), ...BAD_STRINGS.map(([n, s]) => inv(base, `note with ${n}`, { note: s })),
    ],
  };
}

/* ---------------- tasks ---------------- */
{
  const base: Obj = { id: 't1', title: 'Ship it', done: false, context: 'job', tags: [], effort: 2, stat: 'skill' };
  F.tasks = {
    typical: [
      base,
      { id: 't2', title: 'Write report', done: true, doneAt: '2026-11-01T10:00:00.000Z', date: '2026-11-01', context: 'agency', tags: ['client', 'urgent'], effort: 3, stat: 'discipline', horizon: 'today' },
      { id: 't3', title: 'Weekly review', done: false, context: 'personal', tags: ['review'], effort: 1, stat: 'mind', horizon: 'short', recurrence: { every: 'week', interval: 1 } },
      { id: 't4', title: 'Learn Rust', done: false, context: 'learning', tags: [], effort: 3, stat: 'skill', horizon: 'long' },
      // a parent with three subtasks (flat rows linked by parentId)
      { id: 'p1', title: 'Parent goal', done: false, context: 'job', tags: [], effort: 3, stat: 'skill' },
      { id: 'p1:s1', title: 'Sub one', done: true, context: 'job', tags: [], effort: 1, stat: 'skill', parentId: 'p1', doneAt: '2026-11-02T09:00:00Z' },
      { id: 'p1:s2', title: 'Sub two', done: false, context: 'job', tags: ['x'], effort: 1, stat: 'skill', parentId: 'p1' },
      { id: 'p1:s3', title: 'Sub three', done: false, context: 'job', tags: [], effort: 2, stat: 'skill', parentId: 'p1', date: '2026-11-05' },
    ],
    edge: [
      { id: ID200, title: uni(1000), done: true, doneAt: '2026-11-01T10:00:00.123Z', date: D1, context: 'learning', tags: Array.from({ length: 50 }, (_, i) => uni(100, i)), parentId: ID200.slice(0, 199) + 'y', effort: 1, stat: 'body', horizon: 'long', recurrence: { every: 'month', interval: 366 } },
      { id: 'a', title: 'x', done: false, context: 'job', tags: [], effort: 3, stat: 'mind', date: D0, recurrence: { every: 'day', interval: 1 } },
      { id: 't-tags-odd', title: 'Odd tags', done: false, context: 'personal', tags: ['', 'dup', 'dup', 'Ünï', '😀', 'with space', 'a,b', '{"x":1}', '"quoted"', 'back\\slash'], effort: 2, stat: 'mind' },
      { id: 't-self', title: 'Self parent', done: false, context: 'job', tags: [], effort: 1, stat: 'mind', parentId: 't-self' },
      { id: 't-orphan', title: 'Orphan subtask', done: false, context: 'job', tags: [], effort: 1, stat: 'mind', parentId: 'no-such-parent' },
      { id: 'chain:1', title: 'chain root', done: false, context: 'job', tags: [], effort: 1, stat: 'mind' },
      { id: 'chain:2', title: 'chain child', done: false, context: 'job', tags: [], effort: 1, stat: 'mind', parentId: 'chain:1' },
      { id: 'chain:3', title: 'chain grandchild', done: false, context: 'job', tags: [], effort: 1, stat: 'mind', parentId: 'chain:2' },
      // doneAt is a free string accepted by Date.parse (<= 40 units), NOT a normalised timestamp: each format must survive verbatim
      { id: 'ts:offset', title: 'offset', done: true, doneAt: '2026-11-01T10:00:00+05:30', context: 'job', tags: [], effort: 1, stat: 'mind' },
      { id: 'ts:noms', title: 'no ms', done: true, doneAt: '2026-11-01T10:00:00Z', context: 'job', tags: [], effort: 1, stat: 'mind' },
      { id: 'ts:dateonly', title: 'date only', done: true, doneAt: '2026-11-01', context: 'job', tags: [], effort: 1, stat: 'mind' },
      { id: 'ts:micro', title: 'microseconds', done: true, doneAt: '2026-11-01T10:00:00.123456Z', context: 'job', tags: [], effort: 1, stat: 'mind' },
      { id: 'ts:rfc', title: 'RFC 2822', done: true, doneAt: 'Sun, 01 Nov 2026 10:00:00 GMT', context: 'job', tags: [], effort: 1, stat: 'mind' },
      { id: 't-done-no-doneAt', title: 'done without doneAt', done: true, context: 'job', tags: [], effort: 1, stat: 'mind' },
      { id: 't-empty-title-chars', title: ' ', done: false, context: 'job', tags: [], effort: 1, stat: 'mind' },
    ],
    nulls: [{ ...base, id: 't-null', doneAt: null, date: null, parentId: null, horizon: null, recurrence: null }],
    extras: [mut(base, { id: 't-extra', notes: 'free text', checklist: [{ t: 'a', done: true }] })],
    invalid: [
      inv(base, 'empty title', { title: '' }), inv(base, 'title 1001', { title: rep('t', 1001) }), inv(base, 'done string', { done: 'false' }), inv(base, 'done missing', { done: undefined }), inv(base, 'done 0', { done: 0 }),
      inv(base, 'doneAt unparseable', { doneAt: 'not a date' }), inv(base, 'doneAt 41 units', { doneAt: '2026-11-01T10:00:00.000Z' + ' '.repeat(17) }), inv(base, 'doneAt number', { doneAt: 1730000000000 }),
      inv(base, 'date invalid', { date: '2026-13-01' }), inv(base, 'context unknown', { context: 'home' }), inv(base, 'context missing', { context: undefined }),
      inv(base, 'tags not array', { tags: 'a' }), inv(base, 'tags missing', { tags: undefined }), inv(base, 'tags 51 entries', { tags: Array.from({ length: 51 }, (_, i) => 't' + i) }), inv(base, 'tag 101 units', { tags: [rep('t', 101)] }), inv(base, 'tag number', { tags: [1] }), inv(base, 'tag null', { tags: [null] }),
      inv(base, 'parentId empty', { parentId: '' }), inv(base, 'parentId 201', { parentId: rep('p', 201) }),
      inv(base, 'effort 0', { effort: 0 }), inv(base, 'effort 4', { effort: 4 }), inv(base, 'effort string', { effort: '2' }), inv(base, 'effort 1.5', { effort: 1.5 }), inv(base, 'effort missing', { effort: undefined }),
      inv(base, 'stat unknown', { stat: 'x' }), inv(base, 'horizon unknown', { horizon: 'tomorrow' }),
      inv(base, 'recurrence every year', { recurrence: { every: 'year', interval: 1 } }), inv(base, 'recurrence interval 0', { recurrence: { every: 'day', interval: 0 } }), inv(base, 'recurrence interval 367', { recurrence: { every: 'day', interval: 367 } }), inv(base, 'recurrence interval missing', { recurrence: { every: 'day' } }),
      ...BAD_STRINGS.map(([n, s]) => inv(base, `title with ${n}`, { title: s })), inv(base, 'tag with NUL', { tags: ['a\u0000'] }),
    ],
  };
}

/* ---------------- blocks ---------------- */
{
  const base: Obj = { id: 'b-job', title: 'Job', start: '09:30', end: '18:00', day: 'weekday', kind: 'fixed', fixed: true };
  F.blocks = {
    typical: [
      { id: 'b-wake', title: 'Wake', start: '07:00', end: '07:15', day: 'all', kind: 'fixed', fixed: true },
      { id: 'b-med', title: 'Meditation + stretch', start: '07:15', end: '07:45', day: 'all', kind: 'habit', habitId: 'meditate' },
      base,
      { id: 'b-focus', title: 'Focus: skill of the day', start: '20:45', end: '21:45', day: 'weekend', kind: 'focus' },
    ],
    edge: [
      { id: ID200, title: uni(200), start: '00:00', end: '23:59', day: 'all', kind: 'free', fixed: false, habitId: ID200 },
      { id: 'b-overnight', title: 'x', start: '23:00', end: '01:00', day: 'weekday', kind: 'agency' },
      { id: 'b-zero', title: 'Zero length', start: '12:00', end: '12:00', day: 'weekend', kind: 'focus' },
      { id: 'b-orphan-habit', title: 'Habit gone', start: '10:00', end: '10:30', day: 'all', kind: 'habit', habitId: 'deleted-habit' },
      { id: 'b-emptytitle?', title: 'é', start: '09:05', end: '09:06', day: 'all', kind: 'habit' },
    ],
    nulls: [{ ...base, id: 'b-null', fixed: null, habitId: null }],
    extras: [mut(base, { id: 'b-extra', color: 'red' })],
    invalid: [
      inv(base, 'empty title', { title: '' }), inv(base, 'title 201', { title: rep('b', 201) }),
      inv(base, 'start 24:00', { start: '24:00' }), inv(base, 'start 9:30 unpadded', { start: '9:30' }), inv(base, 'start 09:60', { start: '09:60' }), inv(base, 'start with seconds', { start: '09:30:00' }), inv(base, 'start missing', { start: undefined }), inv(base, 'end bad', { end: '25:00' }), inv(base, 'end number', { end: 1800 }),
      inv(base, 'day unknown', { day: 'monday' }), inv(base, 'kind unknown', { kind: 'meeting' }), inv(base, 'fixed string', { fixed: 'true' }), inv(base, 'habitId empty', { habitId: '' }), inv(base, 'habitId 201', { habitId: rep('h', 201) }),
    ],
  };
}

/* ---------------- workouts ---------------- */
{
  const set = (i: number, extra: Obj = {}): Obj => ({ id: `s${i}`, exercise: 'Bench press', reps: 5, weight: 60, unit: 'kg', ...extra });
  const base: Obj = { id: 'w1', date: '2026-11-01', name: 'Push', sets: [set(1)] };
  F.workouts = {
    typical: [
      base,
      { id: 'w2', date: '2026-11-03', name: 'Pull', notes: 'good session', planId: 'plan-pull', sets: [set(1, { exercise: 'Row', weight: 50 }), set(2, { exercise: 'Pull-up', weight: 0, unit: 'bw', reps: 8 }), set(3, { exercise: 'Plank', reps: 60, weight: 0, unit: 'sec', note: 'shaky' })],
        queue: [{ id: 'q1', name: 'Row', sets: 3, reps: 8, unit: 'kg', demo: 'row.gif', text: 'Pull to the hip', note: 'heavy' }, { id: 'q2', name: 'Pull-up', sets: 3, reps: 8, unit: 'bw', skipped: true }] },
    ],
    edge: [
      { id: ID200, date: D1, name: uni(200), notes: ascii(100_000), planId: uni(200), sets: Array.from({ length: 1000 }, (_, i) => set(i, { id: `s:${i}`, exercise: i % 100 === 0 ? uni(200, i) : uni(30, i), reps: i % 2 ? 100_000 : 0, weight: i % 3 ? 100_000 : 0.25, unit: (['kg', 'bw', 'sec'] as const)[i % 3], ...(i % 50 === 1 ? { note: uni(2000, i) } : {}) })) },
      { id: 'w-queue-max', date: D0, name: '', sets: [], queue: Array.from({ length: 500 }, (_, i) => ({ id: `q:${i}`, name: i % 50 === 0 ? uni(200, i) : uni(20, i), sets: i % 2 ? 1000 : 0, reps: i % 2 ? 100_000 : 0, unit: (['kg', 'bw', 'sec'] as const)[i % 3], ...(i % 25 === 0 ? { demo: uni(2000, i), text: uni(2000, i), note: uni(2000, i), skipped: i % 2 === 0 } : {}) })) },
      { id: 'w-big-text', date: DL, name: 'big', sets: [set(1)], queue: [{ id: 'q', name: 'x', sets: 1, reps: 1, unit: 'kg', text: ascii(200_000), note: ascii(200_000) }] },
      { id: 'w-empty', date: '2026-11-04', name: 'Empty', sets: [] },
      { id: 'w-empty-queue', date: '2026-11-04', name: 'Empty queue', sets: [], queue: [], notes: '', planId: '' },
      { id: 'w-dupsets', date: '2026-11-05', name: 'Duplicate set ids, order matters', sets: [set(1, { reps: 9 }), set(1, { reps: 1 }), set(0, { reps: 5 }), set(1, { reps: 9 })] },
      { id: 'w-fractional', date: '2026-11-05', name: 'Fractional', sets: [set(1, { weight: 22.5, reps: 7.5 }), set(2, { weight: 0.125 })], queue: [{ id: 'q', name: 'x', sets: 2.5, reps: 3, unit: 'sec' }] },
      { id: 'w-queue-optional-empty', date: '2026-11-05', name: 'empty optionals', sets: [set(1, { note: '' })], queue: [{ id: 'q', name: '', sets: 0, reps: 0, unit: 'kg', demo: '', text: '', note: '', skipped: false }] },
      { id: 'w:colon:é', date: '2026-02-28', name: '😀', sets: [set(1, { exercise: '' })] },
    ],
    nulls: [{ ...base, id: 'w-null', notes: null, queue: null, planId: null, sets: [set(1, { note: null })], }, { id: 'w-null-q', date: '2026-11-01', name: 'q', sets: [], queue: [{ id: 'q', name: 'x', sets: 1, reps: 1, unit: 'kg', demo: null, text: null, note: null, skipped: null }] }],
    extras: [mut(base, { id: 'w-extra', duration: 3600 }), { id: 'w-extra-nested', date: '2026-11-01', name: 'n', sets: [set(1, { rpe: 8 })], queue: [{ id: 'q', name: 'x', sets: 1, reps: 1, unit: 'kg', weightHint: 20 }] }],
    invalid: [
      inv(base, 'date missing', { date: undefined }), inv(base, 'date bad', { date: '2026-11-31' }), inv(base, 'name 201', { name: rep('n', 201) }), inv(base, 'name missing', { name: undefined }),
      inv(base, 'notes 200001', { notes: rep('n', 200_001) }), inv(base, 'planId 201', { planId: rep('p', 201) }), inv(base, 'sets missing', { sets: undefined }), inv(base, 'sets not array', { sets: {} }),
      inv(base, 'sets 1001 entries', { sets: Array.from({ length: 1001 }, (_, i) => set(i)) }), inv(base, 'set not object', { sets: ['x'] }), inv(base, 'set null', { sets: [null] }),
      inv(base, 'set id empty', { sets: [set(1, { id: '' })] }), inv(base, 'set exercise 201', { sets: [set(1, { exercise: rep('e', 201) })] }), inv(base, 'set reps negative', { sets: [set(1, { reps: -1 })] }), inv(base, 'set reps 100001', { sets: [set(1, { reps: 100_001 })] }),
      inv(base, 'set weight negative', { sets: [set(1, { weight: -0.5 })] }), inv(base, 'set weight missing', { sets: [set(1, { weight: undefined })] }), inv(base, 'set unit lb', { sets: [set(1, { unit: 'lb' })] }), inv(base, 'set note 2001', { sets: [set(1, { note: rep('n', 2001) })] }),
      inv(base, 'set note with NUL', { sets: [set(1, { note: 'a\u0000' })] }),
      inv(base, 'queue not array', { queue: 'x' }), inv(base, 'queue 501 entries', { queue: Array.from({ length: 501 }, (_, i) => ({ id: `q${i}`, name: 'x', sets: 1, reps: 1, unit: 'kg' })) }),
      inv(base, 'queue item name 201', { queue: [{ id: 'q', name: rep('n', 201), sets: 1, reps: 1, unit: 'kg' }] }), inv(base, 'queue sets 1001', { queue: [{ id: 'q', name: 'x', sets: 1001, reps: 1, unit: 'kg' }] }), inv(base, 'queue unit bad', { queue: [{ id: 'q', name: 'x', sets: 1, reps: 1, unit: 'm' }] }),
      inv(base, 'queue demo 2001', { queue: [{ id: 'q', name: 'x', sets: 1, reps: 1, unit: 'kg', demo: rep('d', 2001) }] }), inv(base, 'queue skipped string', { queue: [{ id: 'q', name: 'x', sets: 1, reps: 1, unit: 'kg', skipped: 'no' }] }), inv(base, 'queue item id missing', { queue: [{ name: 'x', sets: 1, reps: 1, unit: 'kg' }] }),
    ],
  };
}

/* ---------------- body ---------------- */
{
  const base: Obj = { id: 'bd1', date: '2026-11-01', weightKg: 70.5 };
  const hundred: Record<string, number> = Object.fromEntries(sumKeys(100).map((k, i) => [k, i % 2 ? 10_000 : 0]));
  F.body = {
    typical: [base, { id: 'bd2', date: '2026-11-08', weightKg: 70.1, measurements: { waist: 82, chest: 100.5, 'left arm': 35 } }, { id: 'bd3', date: '2026-11-15', photo: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==' }],
    edge: [
      { id: ID200, date: D1, weightKg: 1000, measurements: hundred, photo: 'data:image/png;base64,' + rep('QUJD', 400_000).slice(0, 400_000 - 22) },
      { id: 'bd-min', date: D0, weightKg: 1 },
      { id: 'bd-only', date: DL },
      { id: 'bd-precise', date: '2026-11-02', weightKg: 70.123456789012, measurements: { a: 0.1, b: 1 / 3, c: 9999.999 } },
      { id: 'bd-empty-meas', date: '2026-11-03', measurements: {}, photo: '' },
      { id: 'bd-odd-keys', date: '2026-11-04', weightKg: 80, measurements: { '': 1, ' ': 2, 'a.b': 3, 'x"y': 4, 'ünï😀': 5, '__proto__x': 6, 'constructor': 7, 'with/slash': 8, '123': 9, 'a b\tc': 10 } },
      { id: 'bd-key-order', date: '2026-11-05', measurements: { z: 1, a: 2, m: 3 } },
      { id: 'bd:1:é', date: '2026-11-06', weightKg: 55.5 },
    ],
    nulls: [{ ...base, id: 'bd-null', weightKg: null, measurements: null, photo: null }],
    extras: [mut(base, { id: 'bd-extra', bmi: 22.1 })],
    invalid: [
      inv(base, 'date missing', { date: undefined }), inv(base, 'weight 0', { weightKg: 0 }), inv(base, 'weight 0.99', { weightKg: 0.99 }), inv(base, 'weight 1001', { weightKg: 1001 }), inv(base, 'weight string', { weightKg: '70' }), inv(base, 'weight NaN', { weightKg: NaN }), inv(base, 'weight -Infinity', { weightKg: -Infinity }),
      inv(base, 'measurements array', { measurements: [1] }), inv(base, 'measurements 101 keys', { measurements: Object.fromEntries(sumKeys(101).map((k) => [k, 1])) }), inv(base, 'measurement negative', { measurements: { a: -1 } }), inv(base, 'measurement 10001', { measurements: { a: 10_001 } }), inv(base, 'measurement string', { measurements: { a: '1' } }), inv(base, 'measurement null', { measurements: { a: null } }),
      inv(base, 'photo 400001', { photo: rep('p', 400_001) }), inv(base, 'photo number', { photo: 1 }), inv(base, 'measurement key with NUL', { measurements: { 'a\u0000': 1 } }),
    ],
  };
}

/* ---------------- journal ---------------- */
{
  const base: Obj = { id: 'j1', date: '2026-11-01', body: 'Good day.', kind: 'daily', mood: 4, energy: 3 };
  F.journal = {
    typical: [base, { id: 'j2', date: '2026-11-07', body: 'Week in review.\n\n- shipped\n- slept', kind: 'weekly' }],
    edge: [
      { id: ID200, date: D1, body: uni(200_000), kind: 'weekly', mood: 1, energy: 5 },
      { id: 'j-empty', date: D0, body: '', kind: 'daily', mood: 5, energy: 1 },
      { id: 'j-ws', date: DL, body: '  leading and trailing whitespace \n\n\r\n\t', kind: 'daily' },
      { id: 'j-ascii-max', date: '2026-11-02', body: ascii(200_000), kind: 'daily' },
      { id: 'j-uniline', date: '2026-11-03', body: 'a\u2028b\u2029c\u0085d\u00A0e\u200Bf\uFEFFg \u202Eabc', kind: 'daily', mood: 3 },
      { id: 'j-md', date: '2026-11-04', body: '# H\n```js\nconst x = "\\n";\n```\n<script>alert(1)</script> \'; DROP TABLE records;-- %_ $1 ${x}', kind: 'daily' },
      { id: 'j-same-day-2', date: '2026-11-01', body: 'second entry same day and kind', kind: 'daily' },
    ],
    nulls: [{ ...base, id: 'j-null', mood: null, energy: null }],
    extras: [mut(base, { id: 'j-extra', tags: ['x'] })],
    invalid: [
      inv(base, 'body missing', { body: undefined }), inv(base, 'body null', { body: null }), inv(base, 'body 200001', { body: rep('b', 200_001) }), inv(base, 'kind unknown', { kind: 'monthly' }), inv(base, 'kind missing', { kind: undefined }),
      inv(base, 'mood 0', { mood: 0 }), inv(base, 'mood 6', { mood: 6 }), inv(base, 'mood 2.5', { mood: 2.5 }), inv(base, 'mood string', { mood: '3' }), inv(base, 'energy 0', { energy: 0 }), inv(base, 'energy 6', { energy: 6 }),
      inv(base, 'date bad', { date: '2026-00-10' }), ...BAD_STRINGS.map(([n, s]) => inv(base, `body with ${n}`, { body: s })),
    ],
  };
}

/* ---------------- rewards ---------------- */
{
  const base: Obj = { id: 'r1', title: 'A good meal out', cost: 500 };
  F.rewards = {
    typical: [base, { id: 'r2', title: 'New book', cost: 1200, claimedAt: '2026-11-10T18:00:00.000Z' }, { id: 'r3', title: 'Something for the desk', cost: 3000 }],
    edge: [
      { id: ID200, title: uni(300), cost: 1e7, claimedAt: '2026-11-10T18:00:00+01:00' },
      { id: 'r-free', title: 'x', cost: 0 },
      { id: 'r-frac', title: 'frac', cost: 0.5, claimedAt: '2026-11-10' },
      { id: 'r:é😀', title: '😀', cost: 1 },
    ],
    nulls: [{ ...base, id: 'r-null', claimedAt: null }],
    extras: [mut(base, { id: 'r-extra', icon: 'gift' })],
    invalid: [
      inv(base, 'title empty', { title: '' }), inv(base, 'title 301', { title: rep('t', 301) }), inv(base, 'cost negative', { cost: -1 }), inv(base, 'cost 1e7+1', { cost: 1e7 + 1 }), inv(base, 'cost string', { cost: '5' }), inv(base, 'cost missing', { cost: undefined }),
      inv(base, 'claimedAt unparseable', { claimedAt: 'never' }), inv(base, 'claimedAt boolean', { claimedAt: true }), inv(base, 'title with lone surrogate', { title: 'x\uD83D' }),
    ],
  };
}

/* ---------------- xp ---------------- */
{
  const base: Obj = { id: 'x1', date: '2026-11-01', stat: 'body', amount: 10, reason: 'Gym' };
  F.xp = {
    typical: [base, { id: 'x2', date: '2026-11-01', stat: 'mind', amount: 20, reason: 'Meditation', ref: 'habit:meditate:2026-11-01' }, { id: 'x3', date: '2026-11-02', stat: 'skill', amount: -50, reason: 'Reward claimed', ref: 'reward:r1' }],
    edge: [
      { id: ID200, date: D1, stat: 'discipline', amount: 100_000, reason: uni(500), ref: uni(200) },
      { id: 'x-neg', date: D0, stat: 'body', amount: -100_000, reason: '' },
      { id: 'x-zero', date: DL, stat: 'mind', amount: 0, reason: 'zero' },
      { id: 'x-frac', date: '2026-11-03', stat: 'mind', amount: -0.5, reason: '😀' },
      { id: 'x-ref-colons', date: '2026-11-03', stat: 'skill', amount: 5, reason: 'r', ref: 'task:t1:é:😀' },
      { id: 'x-ref-empty', date: '2026-11-03', stat: 'skill', amount: 5, reason: 'r', ref: '' },
      { id: 'x:dup-ref-b', date: '2026-11-03', stat: 'skill', amount: 5, reason: 'dup ref (dedupeXP collapses these on load)', ref: 'same' },
      { id: 'x:dup-ref-a', date: '2026-11-03', stat: 'skill', amount: 5, reason: 'dup ref', ref: 'same' },
    ],
    nulls: [{ ...base, id: 'x-null', ref: null }],
    extras: [mut(base, { id: 'x-extra', meta: { a: 1 } })],
    invalid: [
      inv(base, 'amount 100001', { amount: 100_001 }), inv(base, 'amount -100001', { amount: -100_001 }), inv(base, 'amount string', { amount: '10' }), inv(base, 'amount missing', { amount: undefined }), inv(base, 'amount NaN', { amount: NaN }),
      inv(base, 'stat unknown', { stat: 'luck' }), inv(base, 'reason missing', { reason: undefined }), inv(base, 'reason 501', { reason: rep('r', 501) }), inv(base, 'ref 201', { ref: rep('r', 201) }), inv(base, 'ref number', { ref: 5 }), inv(base, 'date bad', { date: '2026-04-31' }),
      inv(base, 'reason with NUL', { reason: 'a\u0000' }),
    ],
  };
}

/* ---------------- books ---------------- */
{
  const base: Obj = { id: 'bk1', title: 'Deep Work', status: 'reading' };
  F.books = {
    typical: [
      base,
      { id: 'bk2', title: 'Atomic Habits', author: 'James Clear', status: 'done', kind: 'self', pages: 320, page: 320, startedAt: '2026-10-01', finishedAt: '2026-10-20', rating: 5 },
      { id: 'bk3', title: 'Dune', author: 'Frank Herbert', status: 'queued', kind: 'story' },
    ],
    edge: [
      { id: ID200, title: uni(500), author: uni(300), status: 'done', kind: 'story', pages: 100_000, page: 100_000, startedAt: uni(40), finishedAt: uni(40), rating: 5 },
      { id: 'bk-min', title: 'x', status: 'queued', pages: 0, page: 0, rating: 0 },
      { id: 'bk-over', title: 'Page beyond pages', status: 'reading', pages: 100, page: 250 },
      { id: 'bk-frac', title: 'Fractional rating', status: 'done', rating: 4.5, pages: 10.5 },
      { id: 'bk-free-dates', title: 'free-form dates', status: 'done', startedAt: '2026-11-01T10:00:00.000Z', finishedAt: 'sometime in spring' },
      { id: 'bk-empty-strs', title: 'e', status: 'reading', author: '', startedAt: '', finishedAt: '' },
      { id: 'bk-done-unfinished', title: 'done but no finishedAt', status: 'done' },
    ],
    nulls: [{ ...base, id: 'bk-null', author: null, kind: null, pages: null, page: null, startedAt: null, finishedAt: null, rating: null }],
    extras: [mut(base, { id: 'bk-extra', isbn: '978-0' })],
    invalid: [
      inv(base, 'title empty', { title: '' }), inv(base, 'title 501', { title: rep('t', 501) }), inv(base, 'status unknown', { status: 'abandoned' }), inv(base, 'status missing', { status: undefined }), inv(base, 'author 301', { author: rep('a', 301) }), inv(base, 'kind unknown', { kind: 'comic' }),
      inv(base, 'pages negative', { pages: -1 }), inv(base, 'pages 100001', { pages: 100_001 }), inv(base, 'page string', { page: '3' }), inv(base, 'startedAt 41', { startedAt: rep('s', 41) }), inv(base, 'finishedAt number', { finishedAt: 5 }),
      inv(base, 'rating 6', { rating: 6 }), inv(base, 'rating negative', { rating: -1 }), inv(base, 'author with NUL', { author: 'a\u0000' }),
    ],
  };
}

/* ---------------- conversations ---------------- */
{
  const base: Obj = { id: 'cv1', date: '2026-11-01', who: 'Priya' };
  F.conversations = {
    typical: [base, { id: 'cv2', date: '2026-11-02', who: 'Neighbour', note: 'Asked about the dog' }],
    edge: [
      { id: ID200, date: D1, who: uni(300), note: uni(200_000) },
      { id: 'cv-empty', date: D0, who: '', note: '' },
      { id: 'cv-multi', date: DL, who: '日本語 😀', note: 'a\nb\r\nc' },
      { id: 'cv:dup-who-same-day', date: DL, who: '日本語 😀' },
    ],
    nulls: [{ ...base, id: 'cv-null', note: null }],
    extras: [mut(base, { id: 'cv-extra', place: 'cafe' })],
    invalid: [inv(base, 'who missing', { who: undefined }), inv(base, 'who 301', { who: rep('w', 301) }), inv(base, 'note 200001', { note: rep('n', 200_001) }), inv(base, 'date bad', { date: 'yesterday' }), inv(base, 'id empty', { id: '' }), inv(base, 'who null', { who: null }), inv(base, 'note with lone surrogate', { note: '\uDE00' })],
  };
}

/* ---------------- rejections ---------------- */
{
  const base: Obj = { id: 'rj1', date: '2026-11-01', createdAt: '2026-11-01T08:30:00.000Z', what: 'Asked for a discount' };
  F.rejections = {
    typical: [base, { id: 'rj2', date: '2026-11-02', createdAt: '2026-11-02T20:00:00.000Z', what: 'Pitched the agency', who: 'Acme Ltd', note: 'Said no, learned to ask for budget early' }],
    edge: [
      { id: ID200, date: D1, createdAt: '2026-11-01T08:30:00.000+05:30', what: uni(200_000), who: uni(500), note: uni(20_000) },
      { id: 'rj-empty', date: D0, createdAt: '2026-11-01', what: '', who: '', note: '' },
      { id: 'rj-stamps', date: DL, createdAt: 'Sun, 01 Nov 2026 10:00:00 GMT', what: 'x' },
      { id: 'rj-micro', date: DL, createdAt: '2026-11-01T08:30:00.123456Z', what: 'x' },
    ],
    nulls: [{ ...base, id: 'rj-null', who: null, note: null }],
    extras: [mut(base, { id: 'rj-extra', score: 9 })],
    invalid: [inv(base, 'createdAt missing', { createdAt: undefined }), inv(base, 'createdAt unparseable', { createdAt: 'later' }), inv(base, 'createdAt 41', { createdAt: '2026-11-01T08:30:00.000Z' + ' '.repeat(17) }), inv(base, 'what missing', { what: undefined }), inv(base, 'what 200001', { what: rep('w', 200_001) }), inv(base, 'who 501', { who: rep('w', 501) }), inv(base, 'note 200001', { note: rep('n', 200_001) }), inv(base, 'date bad', { date: '2026-02-30' }), inv(base, 'what with NUL', { what: 'a\u0000' })],
  };
}

/* ---------------- videos ---------------- */
{
  const base: Obj = { id: 'v-dQw4w9WgXcQ', ytId: 'dQw4w9WgXcQ', title: 'A video', tag: 'learn', addedAt: '2026-11-01T08:30:00.000Z' };
  F.videos = {
    typical: [base, { id: 'v2', ytId: 'aqz-KE-bpKQ', title: 'Fun one', tag: 'fun', addedAt: '2026-11-02T08:30:00.000Z', watchedAt: '2026-11-03T21:00:00.000Z' }],
    edge: [
      { id: ID200, ytId: rep('y', 64), title: uni(500), tag: 'fun', addedAt: '2026-11-01T08:30:00+05:30', watchedAt: '2026-11-01' },
      { id: 'v-min', ytId: 'y', title: '', tag: 'learn', addedAt: '1970-01-01T00:00:00Z' },
      { id: 'v-dash', ytId: '-_-_-_-_-_-', title: '😀', tag: 'learn', addedAt: '2026-11-01T08:30:00.000Z' },
      { id: 'v:dup-ytid', ytId: 'dQw4w9WgXcQ', title: 'same ytId, different row', tag: 'fun', addedAt: '2026-11-04T08:30:00.000Z' },
    ],
    nulls: [{ ...base, id: 'v-null', watchedAt: null }],
    extras: [mut(base, { id: 'v-extra', durationSec: 212 })],
    invalid: [inv(base, 'ytId empty', { ytId: '' }), inv(base, 'ytId 65', { ytId: rep('y', 65) }), inv(base, 'ytId missing', { ytId: undefined }), inv(base, 'title 501', { title: rep('t', 501) }), inv(base, 'title missing', { title: undefined }), inv(base, 'tag unknown', { tag: 'news' }), inv(base, 'addedAt missing', { addedAt: undefined }), inv(base, 'addedAt unparseable', { addedAt: 'x' }), inv(base, 'watchedAt unparseable', { watchedAt: 'x' }), inv(base, 'watchedAt number', { watchedAt: 1 })],
  };
}

/* ---------------- channels ---------------- */
{
  const base: Obj = { id: 'liveoverflow', handle: '@LiveOverflow', topic: 'tech' };
  F.channels = {
    typical: [
      base, // legacy shape: no list/origin (list missing means 'mine')
      { id: 'hubermanlab', handle: '@hubermanlab', cid: 'UC2D2CMWXMOVWx7giW1n3LIg', topic: 'psy', list: 'mine', origin: 'pick' },
      { id: 'sugg', handle: '@Suggested', topic: 'fin', sub: 'investing', name: 'Suggested channel', about: 'One line about it', list: 'suggested', origin: 'suggest' },
      { id: 'mine-custom', handle: '@custom', topic: 'mind', list: 'hidden', origin: 'custom' },
    ],
    edge: [
      { id: ID200, handle: uni(200), cid: uni(100), topic: 'fin', sub: 'saving', name: uni(200), about: uni(500), list: 'hidden', origin: 'custom' },
      { id: 'c-min', handle: '@', topic: 'sec' }, { id: 'c-per', handle: '@p', topic: 'per', list: 'mine' }, { id: 'c-code', handle: '@c', topic: 'code', origin: 'pick' },
      ...TOPICS.map((t) => ({ id: `c-topic-${t.id}`, handle: `@${t.id}`, topic: t.id })),
      ...(['stocks', 'investing', 'saving'] as const).map((s) => ({ id: `c-sub-${s}`, handle: `@${s}`, topic: 'fin', sub: s })),
      { id: 'c-empty-strs', handle: '@e', topic: 'mind', cid: '', name: '', about: '' },
      { id: 'c:é', handle: '@日本語', topic: 'art' },
    ],
    nulls: [{ ...base, id: 'c-null', cid: null, sub: null, name: null, about: null, list: null, origin: null }],
    extras: [mut(base, { id: 'c-extra', subscribers: 10 })],
    invalid: [inv(base, 'handle empty', { handle: '' }), inv(base, 'handle 201', { handle: rep('h', 201) }), inv(base, 'handle missing', { handle: undefined }), inv(base, 'topic unknown', { topic: 'music' }), inv(base, 'topic missing', { topic: undefined }), inv(base, 'sub unknown', { sub: 'crypto' }), inv(base, 'cid 101', { cid: rep('c', 101) }), inv(base, 'name 201', { name: rep('n', 201) }), inv(base, 'about 501', { about: rep('a', 501) }), inv(base, 'list unknown', { list: 'all' }), inv(base, 'origin unknown', { origin: 'import' }), inv(base, 'handle with NUL', { handle: '@a\u0000' })],
  };
}

/* ---------------- courses ---------------- */
{
  const vid = (i: number, title = `Lecture ${i}`, dur = 600 + i): [string, string, number] => [`yt${String(i).padStart(9, '0')}`, title, dur];
  const base: Obj = { id: 'PL1', kind: 'playlist', title: 'Intro to Security', topic: 'tech', list: 'mine', origin: 'pick' };
  F.courses = {
    typical: [
      base,
      { id: 'PL2', kind: 'playlist', title: 'Linear Algebra', by: 'Gilbert Strang', topic: 'sci', list: 'suggested', origin: 'suggest', count: 3, about: 'MIT 18.06', videos: [vid(1), vid(2), vid(3)], videosAt: 1_730_000_000_000 },
      { id: 'khan-finance', kind: 'link', title: 'Finance basics', topic: 'fin', sub: 'saving', list: 'hidden', origin: 'custom', url: 'https://example.com/course' },
    ],
    edge: [
      { id: ID200, kind: 'playlist', title: uni(300), by: uni(200), topic: 'econ', sub: 'stocks', list: 'mine', origin: 'custom', url: uni(500), count: 100_000, about: uni(500),
        videos: Array.from({ length: 500 }, (_, i) => [rep('v', 64 - String(i).length) + i, uni(300, i), i % 2 ? 1e7 : 0] as [string, string, number]), videosAt: 1e15 },
      { id: 'c-min', kind: 'link', title: 'x', topic: 'mind', list: 'mine', origin: 'pick' },
      { id: 'c-novideos-vs-empty-a', kind: 'playlist', title: 'videos missing', topic: 'art', list: 'mine', origin: 'pick', count: 12 },
      { id: 'c-novideos-vs-empty-b', kind: 'playlist', title: 'videos empty array', topic: 'art', list: 'mine', origin: 'pick', videos: [], videosAt: 0 },
      { id: 'c-tuple-edge', kind: 'playlist', title: 'tuple edge cases', topic: 'tamil', list: 'suggested', origin: 'suggest', count: 0,
        videos: [['a', '', 0], ['-_', '😀 日本語', 1e7], ['dup', 'same ytId twice', 1], ['dup', 'same ytId twice', 1], ['z', 'frac duration', 123.456], ['y', rep('t', 300), 0]] },
      { id: 'c-order', kind: 'playlist', title: 'order matters', topic: 'biz', list: 'mine', origin: 'pick', videos: [vid(3), vid(1), vid(2)], videosAt: 1 },
      { id: 'c-count-mismatch', kind: 'playlist', title: 'count differs from videos.length', topic: 'comm', list: 'mine', origin: 'pick', count: 99, videos: [vid(1)] },
      { id: 'c-link-empty-strs', kind: 'link', title: 'e', by: '', topic: 'psy', list: 'mine', origin: 'pick', url: '', about: '' },
      { id: 'PLé:😀', kind: 'playlist', title: 'unicode id', topic: 'tech', list: 'mine', origin: 'pick', videosAt: 1_730_000_000_123 },
      ...TOPICS.map((t) => ({ id: `c-topic-${t.id}`, kind: 'link', title: t.id, topic: t.id, list: 'mine', origin: 'pick' })),
    ],
    nulls: [{ ...base, id: 'c-null', by: null, sub: null, url: null, count: null, about: null, videos: null, videosAt: null }],
    extras: [mut(base, { id: 'c-extra', thumbnail: 'x.jpg' })],
    invalid: [
      inv(base, 'title empty', { title: '' }), inv(base, 'title 301', { title: rep('t', 301) }), inv(base, 'kind unknown', { kind: 'video' }), inv(base, 'topic legacy sec (channels only)', { topic: 'sec' }), inv(base, 'topic unknown', { topic: 'x' }), inv(base, 'list missing (required for courses)', { list: undefined }), inv(base, 'origin missing (required for courses)', { origin: undefined }), inv(base, 'origin unknown', { origin: 'x' }),
      inv(base, 'sub unknown', { sub: 'x' }), inv(base, 'by 201', { by: rep('b', 201) }), inv(base, 'url 501', { url: rep('u', 501) }), inv(base, 'about 501', { about: rep('a', 501) }), inv(base, 'count negative', { count: -1 }), inv(base, 'count 100001', { count: 100_001 }), inv(base, 'videosAt negative', { videosAt: -1 }), inv(base, 'videosAt 1e15+1', { videosAt: 1e15 + 1 }),
      inv(base, 'videos 501 entries', { videos: Array.from({ length: 501 }, (_, i) => vid(i)) }), inv(base, 'videos not array', { videos: {} }), inv(base, 'video not tuple (2 items)', { videos: [['a', 'b']] }), inv(base, 'video tuple 4 items', { videos: [['a', 'b', 1, 2]] }), inv(base, 'video object', { videos: [{ ytId: 'a', title: 'b', dur: 1 }] }),
      inv(base, 'video ytId empty', { videos: [['', 'b', 1]] }), inv(base, 'video ytId 65', { videos: [[rep('y', 65), 'b', 1]] }), inv(base, 'video title 301', { videos: [['a', rep('t', 301), 1]] }), inv(base, 'video duration negative', { videos: [['a', 'b', -1]] }), inv(base, 'video duration 1e7+1', { videos: [['a', 'b', 1e7 + 1]] }), inv(base, 'video duration string', { videos: [['a', 'b', '1']] }), inv(base, 'video title with NUL', { videos: [['a', 'b\u0000', 1]] }),
    ],
  };
}

/* ---------------- oneLogs ---------------- */
{
  const base: Obj = { id: 'ol1', date: '2026-11-01', exercise: 'pullups', sets: 3, reps: 8 };
  F.oneLogs = {
    typical: [base, { id: 'ol2', date: '2026-11-02', exercise: 'dips', sets: 2, reps: 12, effort: 7 }],
    edge: [
      ...(['pullups', 'dips', 'pushups', 'rows', 'pikes', 'squats', 'splits', 'rdls'] as const).map((e, i) => ({ id: `ol:${e}`, date: DATES[i % DATES.length], exercise: e, sets: i, reps: i * 10 })),
      { id: ID200, date: D1, exercise: 'rdls', sets: 1000, reps: 100_000, effort: 10 },
      { id: 'ol-zero', date: D0, exercise: 'splits', sets: 0, reps: 0, effort: 0 },
      { id: 'ol-frac', date: DL, exercise: 'rows', sets: 2.5, reps: 7.5, effort: 6.5 },
      { id: 'ol:é', date: '2026-11-03', exercise: 'pikes', sets: 1, reps: 1 },
    ],
    nulls: [{ ...base, id: 'ol-null', effort: null }],
    extras: [mut(base, { id: 'ol-extra', tempo: '3-1-1' })],
    invalid: [inv(base, 'exercise unknown', { exercise: 'curls' }), inv(base, 'exercise missing', { exercise: undefined }), inv(base, 'sets negative', { sets: -1 }), inv(base, 'sets 1001', { sets: 1001 }), inv(base, 'sets missing', { sets: undefined }), inv(base, 'reps negative', { reps: -1 }), inv(base, 'reps 100001', { reps: 100_001 }), inv(base, 'reps string', { reps: '8' }), inv(base, 'effort 11', { effort: 11 }), inv(base, 'effort negative', { effort: -1 }), inv(base, 'date bad', { date: '2026-06-31' }), inv(base, 'sets NaN', { sets: NaN })],
  };
}

/* ---------------- kv ---------------- */
{
  const base: Obj = { id: 'crs:PL1', value: 'mine' };
  const json = JSON.stringify({ a: [1, 2, { b: null }], s: 'é😀', n: 1.5e-7, big: 12345678901234567890 });
  F.kv = {
    typical: [
      base, { id: 'chs:liveoverflow', value: 'hide' }, { id: 'crsx:PL9', value: '{"title":"Custom","topic":"tech"}' },
      { id: 'gym:plan', value: json }, { id: 'mobility:2026-11-01', value: '["hip","neck"]' },
    ],
    edge: [
      { id: ID200, value: uni(200_000) },
      { id: 'kv-empty', value: '' },
      { id: 'kv-ascii-max', value: ascii(200_000) },
      { id: 'kv-bad-json', value: '{not json' },
      { id: 'kv-json-spaces', value: '{ "a" :  1 ,\n "b": [ 1 , 2 ] }' }, // the value is an opaque string: its whitespace and key order must survive
      { id: 'kv-json-dupkeys', value: '{"a":1,"a":2,"b":1,"a":3}' },
      { id: 'kv-json-null', value: 'null' },
      { id: 'kv-numeric-string', value: '007' },
      { id: 'k:é:😀/with spaces and "quotes"', value: 'x' },
      { id: 'kv-id-like-pg', value: "'; DROP TABLE kv; --" },
      { id: 'kv-ws', value: ' \n\t ' },
      { id: 'kv-bigjson', value: JSON.stringify(Array.from({ length: 5000 }, (_, i) => ({ i, t: uni(20, i) }))) },
    ],
    nulls: [],
    extras: [mut(base, { id: 'kv-extra', updated: 1 })],
    invalid: [inv(base, 'value missing', { value: undefined }), inv(base, 'value null', { value: null }), inv(base, 'value object (must be a string)', { value: { a: 1 } }), inv(base, 'value number', { value: 1 }), inv(base, 'value 200001', { value: rep('v', 200_001) }), inv(base, 'id empty', { id: '' }), inv(base, 'id 201', { id: rep('k', 201) }), inv(base, 'value with NUL', { value: 'a\u0000b' }), inv(base, 'value with lone surrogate', { value: '\uD800' }), inv(base, 'id with NUL', { id: 'a\u0000' })],
  };
}

/* ---------------- wake (no id field: the sync id is `wake:<date>`) ---------------- */
{
  const base: Obj = { date: '2026-11-01', time: '07:00' };
  F.wake = {
    typical: [base, { date: '2026-11-02', time: '06:45' }, { date: '2026-11-03', time: '09:30' }],
    edge: [{ date: D0, time: '00:00' }, { date: D1, time: '23:59' }, { date: DL, time: '12:00' }, { date: '2000-02-29', time: '05:05' }],
    nulls: [],
    extras: [mut(base, { date: '2026-11-04', source: 'manual' }), { id: 'wake:2026-11-05', date: '2026-11-05', time: '07:10' }],
    invalid: [inv(base, 'date missing', { date: undefined }), inv(base, 'date bad', { date: '2026-02-30' }), inv(base, 'time missing', { time: undefined }), inv(base, 'time 24:00', { time: '24:00' }), inv(base, 'time 7:00', { time: '7:00' }), inv(base, 'time 07:60', { time: '07:60' }), inv(base, 'time with seconds', { time: '07:00:00' }), inv(base, 'time number', { time: 700 }), inv(base, 'date with time', { date: '2026-11-01T07:00' })],
  };
}

/* ---------------- meta (settings; the only valid id is 'settings') ---------------- */
{
  const base: Obj = { id: 'settings', theme: 'dark', wakeTime: '07:00', name: 'Dinesh' };
  F.meta = {
    typical: [base, { id: 'settings', theme: 'light', skin: 'canopy', wakeTime: '06:30', weekendWake: '08:00', name: 'Dinesh', settledThrough: '2026-11-18' }],
    edge: [
      { id: 'settings', theme: 'dark', skin: uni(64), wakeTime: '00:00', weekendWake: '23:59', name: uni(200), settledThrough: D1 },
      { id: 'settings', theme: 'light', wakeTime: '12:00', name: '', skin: '', settledThrough: D0 },
      { id: 'settings', theme: 'dark', wakeTime: '07:00', name: '名前 😀', settledThrough: DL },
    ],
    nulls: [{ ...base, skin: null, weekendWake: null, settledThrough: null }],
    extras: [mut(base, { language: 'en', reminders: { morning: true } })],
    invalid: [inv(base, "id 'other'", { id: 'other' }), inv(base, 'id missing', { id: undefined }), inv(base, 'theme unknown', { theme: 'blue' }), inv(base, 'theme missing', { theme: undefined }), inv(base, 'wakeTime bad', { wakeTime: '7am' }), inv(base, 'wakeTime missing', { wakeTime: undefined }), inv(base, 'weekendWake bad', { weekendWake: '25:00' }), inv(base, 'name 201', { name: rep('n', 201) }), inv(base, 'name missing', { name: undefined }), inv(base, 'skin 65', { skin: rep('s', 65) }), inv(base, 'settledThrough bad', { settledThrough: '2026-02-30' }), inv(base, 'settledThrough with time', { settledThrough: '2026-11-18T00:00:00Z' })],
  };
}

/** Values that are never items, for every collection. */
export const NON_ITEMS: Invalid[] = [
  { name: 'null', item: null }, { name: 'undefined', item: undefined }, { name: 'string', item: 'x' }, { name: 'number', item: 42 }, { name: 'array', item: [] },
  { name: 'empty object (tombstone data)', item: {} },
];
for (const c of COLLECTIONS) F[c].invalid.push(...NON_ITEMS);

export const FIXTURES: Record<Collection, CollectionFixtures> = F;

/** All valid items of a collection in the given groups (default: typical + edge). */
export const validItems = (c: Collection, groups: readonly ValidGroup[] = ['typical', 'edge']): Obj[] => groups.flatMap((g) => FIXTURES[c][g]);

/** The sync id of an item as the engine computes it (src/sync/engine.ts idOf): wake = `wake:<date>`, meta = 'settings', else item.id. */
export const syncId = (c: Collection, it: Obj): string => (c === 'wake' ? `wake:${it.date}` : c === 'meta' ? 'settings' : String(it.id));

/** Collection x group counts. */
export function coverage(): { collection: string; typical: number; edge: number; nulls: number; extras: number; invalid: number }[] {
  return COLLECTIONS.map((c) => ({ collection: c, typical: F[c].typical.length, edge: F[c].edge.length, nulls: F[c].nulls.length, extras: F[c].extras.length, invalid: F[c].invalid.length }));
}
