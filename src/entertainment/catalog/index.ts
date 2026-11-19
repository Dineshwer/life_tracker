import type { CatalogChannel, CatalogCourse } from '../contract';
import { CHANNEL_PICKS } from './channels.picks';
import { CHANNEL_SUGGESTED } from './channels.suggest';
import { COURSE_PICKS } from './courses.picks';
import { COURSE_SUGGESTED_A } from './courses.suggest.a';
import { COURSE_SUGGESTED_B } from './courses.suggest.b';

/** lowercase handle without @: the channel id used everywhere */
export const handleId = (handle: string): string => handle.trim().replace(/^@/, '').toLowerCase();

function dedupe<T>(list: T[], key: (x: T) => string): T[] {
  const seen = new Set<string>(); const out: T[] = [];
  for (const x of list) { const k = key(x); if (seen.has(k)) continue; seen.add(k); out.push(x); }
  return out;
}

/** Picks first, so a pick wins over a suggestion with the same handle / id. */
export const CHANNELS_ALL: CatalogChannel[] = dedupe([...CHANNEL_PICKS, ...CHANNEL_SUGGESTED], (c) => handleId(c.handle));
export const COURSES_ALL: CatalogCourse[] = dedupe([...COURSE_PICKS, ...COURSE_SUGGESTED_A, ...COURSE_SUGGESTED_B], (c) => c.id);
export { CHANNEL_PICKS };

/** Bump when entries are ADDED to the catalog: seedCatalog() then inserts the entries that have no row yet (never overwrites rows). */
export const CATALOG_VERSION = 1;
