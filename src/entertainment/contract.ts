/* Entertainment redesign: FROZEN CONTRACT. Types shared by catalog, data, loader and UI work. Do not change without telling the lead. */

/** Topics. Labels live in TOPICS. 'sci' only appears in Suggested (the owner removed Science from My picks). */
export type TopicId = 'mind' | 'comm' | 'biz' | 'tech' | 'psy' | 'art' | 'tamil' | 'econ' | 'fin' | 'sci';
/** Sub-topics, used only by Finance. */
export type FinSub = 'stocks' | 'investing' | 'saving';
export const TOPICS: { id: TopicId; label: string }[] = [
  { id: 'mind', label: 'Mindset' }, { id: 'comm', label: 'Communication' }, { id: 'biz', label: 'Business' },
  { id: 'tech', label: 'Tech & security' }, { id: 'psy', label: 'Psychology' }, { id: 'econ', label: 'Economics' },
  { id: 'fin', label: 'Finance' }, { id: 'art', label: 'Art' }, { id: 'sci', label: 'Science & engineering' }, { id: 'tamil', label: 'Tamil' },
];
export const FIN_SUBS: { id: FinSub; label: string }[] = [{ id: 'stocks', label: 'Stocks' }, { id: 'investing', label: 'Investing' }, { id: 'saving', label: 'Money saving' }];

/** Where an entry comes from. 'pick' = chosen by the owner (default list Mine). 'suggest' = Claude's suggestion (default list Suggested). */
export type Origin = 'pick' | 'suggest';

/** Static catalog entry for a channel. `handle` includes the @. `cid` = YouTube channel id (UC...) when verified. */
export interface CatalogChannel {
  handle: string; cid?: string; name: string; topic: TopicId; sub?: FinSub; origin: Origin;
  /** one short line on what the channel is (shown on the Suggested card) */
  about?: string;
}

/** Static catalog entry for a course. kind 'playlist': `id` is the YouTube playlist id (PL...). kind 'link': a website course; `id` is a slug and `url` is required. */
export interface CatalogCourse {
  id: string; kind: 'playlist' | 'link'; title: string; by?: string; topic: TopicId; sub?: FinSub; origin: Origin;
  url?: string;               // required for kind 'link'; optional for playlists (defaults to youtube.com/playlist?list=id)
  count?: number;             // number of lectures when known (verified)
  about?: string;             // one short line
  verified?: boolean;         // true when the playlist id / handle was confirmed to exist
}

/* ---- User state (all stored in the synced store; NO new database collections) ----
   Channels you own: the existing `channels` collection ({id, handle, cid?, topic, sub?}).
   Course/channel list membership + dismissals: kv rows (synced):
     'crs:<courseId>'   = 'mine' | 'out' | 'hide'   ('out' = a pick the owner removed; 'hide' = a suggestion dismissed; 'mine' = a suggestion the owner added)
     'chs:<handleLower>'= 'hide'                    (a suggested channel dismissed)
     'crsx:<playlistId>'= JSON {title, topic, sub?}  (a course the owner added by pasting a playlist link)
   Course progress: the existing `videos` collection (watchedAt); lecture ytIds of the playlist that are in it are "watched".
   Mine courses  = picks not 'out'  +  suggestions marked 'mine'  +  custom crsx.
   Suggested     = suggestions not marked 'mine' or 'hide'.  Mine channels = the `channels` collection. */

export interface CourseView extends CatalogCourse { list: 'mine' | 'suggested'; custom?: boolean; /** lecture list stored in the DB row: [ytId, title, durSeconds][] */ videos?: [string, string, number][]; videosAt?: number }
export interface ChannelView extends CatalogChannel { list: 'mine' | 'suggested'; custom?: boolean; id: string /* lowercase handle without @ */ }

/** Implemented in src/entertainment/state.ts (data agent). UI imports these hooks only. */
export interface CoursesApi {
  mine: CourseView[]; suggested: CourseView[];
  addToMine(id: string): void; removeFromMine(id: string): void; dismiss(id: string): void; restoreDismissed(): void; dismissedCount: number;
  addCustom(urlOrId: string, title: string, topic: TopicId, sub?: FinSub): string | null; // returns playlist id or null if the link is invalid
}
export interface ChannelsApi {
  mine: ChannelView[]; suggested: ChannelView[];
  addToMine(handle: string): void; removeFromMine(id: string): void; dismiss(handle: string): void; restoreDismissed(): void; dismissedCount: number;
  addCustom(handle: string, topic: TopicId, sub?: FinSub): void;
}

/* ---- Loader (src/lib/yt.ts, loader agent) ---- */
export interface PlVideo { ytId: string; title: string; dur: number; author?: string; index: number }
export interface PlaylistData { id: string; title: string; author: string; videos: PlVideo[]; fetchedAt: number; partial?: boolean }
export interface ChannelPlaylist { id: string; title: string; count: number }
