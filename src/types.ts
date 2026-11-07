export type Stat = 'body' | 'mind' | 'skill' | 'discipline';
export type ISODate = string; // YYYY-MM-DD, local time

export interface Habit {
  id: string;
  name: string;
  stat: Stat;
  /** daily, or N times per week, or fixed weekdays (0=Sun) */
  cadence: { type: 'daily' } | { type: 'weekly'; perWeek: number } | { type: 'days'; days: number[] };
  /** description of the minimum version that still counts */
  minimum?: string;
  xp: number; // XP for a full completion; minimum gives 50%
  archived?: boolean;
  /** optional numeric target, e.g. 20 minutes */
  unit?: { label: string; target: number };
}

export interface HabitLog {
  id: string;
  habitId: string;
  date: ISODate;
  level: 'full' | 'min';
  amount?: number;
  note?: string;
}

export type TaskContext = 'job' | 'agency' | 'personal' | 'learning';

export interface Task {
  id: string;
  title: string;
  done: boolean;
  doneAt?: string;
  date?: ISODate;
  context: TaskContext;
  tags: string[];
  parentId?: string; // subtask
  recurrence?: { every: 'day' | 'week' | 'month'; interval: number };
  horizon?: 'today' | 'short' | 'long'; // short-term / long-term goal
  effort: 1 | 2 | 3; // drives XP: 10 / 20 / 40
  stat: Stat;
}

export interface TimeBlock {
  id: string;
  title: string;
  start: string; // HH:MM
  end: string;
  day: 'weekday' | 'weekend' | 'all';
  fixed?: boolean; // job, agency minimum
  kind: 'fixed' | 'agency' | 'habit' | 'focus' | 'free';
  habitId?: string;
}

export interface WorkoutSet { id: string; exercise: string; reps: number; weight: number; unit: 'kg' | 'bw' | 'sec'; note?: string }
export interface Workout { id: string; date: ISODate; name: string; sets: WorkoutSet[]; notes?: string }
export interface BodyEntry { id: string; date: ISODate; weightKg?: number; measurements?: Record<string, number>; photo?: string }

export interface JournalEntry { id: string; date: ISODate; body: string; mood?: 1 | 2 | 3 | 4 | 5; energy?: 1 | 2 | 3 | 4 | 5; kind: 'daily' | 'weekly' }

export interface Reward { id: string; title: string; cost: number; /** total XP needed */ claimedAt?: string }

export interface XPEvent { id: string; date: ISODate; stat: Stat; amount: number; reason: string; ref?: string }

export interface Settings {
  theme: 'dark' | 'light';
  /** visual skin id, see src/themes.ts (undefined = canopy) */
  skin?: string;
  wakeTime: string; // HH:MM target
  weekendWake?: string;
  name: string;
}

export interface WakeLog { date: ISODate; time: string }

export interface Book {
  id: string; title: string; author?: string; status: 'reading' | 'done' | 'queued';
  /** which shelf: self-growth books or stories (undefined = self-growth) */
  kind?: 'self' | 'story';
  pages?: number; page?: number; startedAt?: string; finishedAt?: string; /** 1-5 */ rating?: number;
}
export interface Conversation { id: string; date: ISODate; who: string; note?: string }

/** One logged rejection in the 1,000-rejections challenge. */
export interface Rejection { id: string; date: ISODate; createdAt: string; /** what I did to get it */ what: string; /** who / where (optional) */ who?: string; /** what I learned (optional) */ note?: string }

/** A video saved to the Entertainment watch queue (played in-app via YouTube's privacy-friendly embed). */
export interface Video { id: string; ytId: string; title: string; tag: 'learn' | 'fun'; addedAt: string; watchedAt?: string }

/** A YouTube channel followed in the Entertainment feed. */
export interface Channel { id: string; handle: string; topic: 'sec' | 'sci' | 'code' }
