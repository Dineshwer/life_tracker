import { handleId } from '../catalog';
import { synced } from '../../lib/synced';

export const HIDE_KEY = 'ledger-feed-hidden';
export const MIN_LEN = 4 * 60; // nothing under 4 minutes

export const ago = (ms: number): string => { const d = Math.floor((Date.now() - ms) / 86400000); return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d < 60 ? `${d} days ago` : `${Math.round(d / 30)} months ago`; };
export const mins = (s: number): string => (!s ? '' : s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min` : `${Math.max(1, Math.round(s / 60))} min`);
export const readHidden = (): string[] => { try { return JSON.parse(synced.getItem(HIDE_KEY) || '[]'); } catch { return []; } };
export const writeHidden = (ids: string[]) => { try { synced.setItem(HIDE_KEY, JSON.stringify(ids.slice(-800))); } catch { /* */ } };
export const ytChannelUrl = (handle: string): string => `https://www.youtube.com/${handle.startsWith('@') ? handle : `@${handle}`}`;

/** Accepts "@name", "name", "youtube.com/@name", "https://www.youtube.com/@name/videos". Returns "@name" or an error message. */
export function parseHandle(input: string): { handle: string } | { error: string } {
  let s = input.trim();
  if (!s) return { error: 'Enter a channel handle or link.' };
  if (/youtube\.com|youtu\.be/i.test(s)) {
    const m = s.match(/youtube\.com\/(@[^/?#\s]+)/i);
    if (!m) return { error: 'Use the channel link that contains @name (youtube.com/@name).' };
    s = m[1];
  }
  s = s.replace(/^@/, '');
  if (!/^[\w.-]{3,40}$/.test(s)) return { error: 'That does not look like a handle. Letters, numbers, dots and dashes only.' };
  return { handle: `@${s}` };
}
export { handleId };
