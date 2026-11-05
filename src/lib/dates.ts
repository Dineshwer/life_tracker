import type { ISODate } from '../types';

export const pad = (n: number) => String(n).padStart(2, '0');
export const toISO = (d: Date): ISODate => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = (): ISODate => toISO(new Date());
export const fromISO = (s: ISODate) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (s: ISODate, n: number): ISODate => { const d = fromISO(s); d.setDate(d.getDate() + n); return toISO(d); };
export const isWeekend = (s: ISODate) => [0, 6].includes(fromISO(s).getDay());
/** Monday-start week containing s */
export const weekStart = (s: ISODate): ISODate => { const d = fromISO(s); const k = (d.getDay() + 6) % 7; return addDays(s, -k); };
export const weekDays = (s: ISODate): ISODate[] => Array.from({ length: 7 }, (_, i) => addDays(weekStart(s), i));
export const minutes = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
export const fmtTime = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); const ap = h >= 12 ? 'pm' : 'am'; return `${((h + 11) % 12) + 1}:${pad(m)} ${ap}`; };
export const nowHHMM = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export const fmtLong = (s: ISODate) => fromISO(s).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
