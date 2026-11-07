import type { Habit, TimeBlock, Settings, Reward } from './types';
import { addDays, today } from './lib/dates';

const h = (id: string, name: string, stat: Habit['stat'], cadence: Habit['cadence'], xp: number, minimum?: string): Habit => ({ id, name, stat, cadence, xp, minimum });

export function seed() {
  const habits: Habit[] = [
    h('meditate', 'Meditation', 'mind', { type: 'daily' }, 20, '2 minutes of breathing'),
    h('read', 'Reading', 'mind', { type: 'daily' }, 15, '1 page'),
    h('journal', 'Journal', 'mind', { type: 'daily' }, 10, 'One sentence'),
    h('stretch', 'Stretching', 'body', { type: 'daily' }, 10, '3 minutes'),
    h('posture', 'Posture work', 'body', { type: 'daily' }, 10, 'One drill'),
    h('gym', 'Gym', 'body', { type: 'weekly', perWeek: 4 }, 30, '15 min mobility or one lift'),
    h('voice', 'Voice & accent', 'skill', { type: 'daily' }, 15, '5 minutes reading aloud'),
    h('talk', 'Talk to someone new', 'discipline', { type: 'daily' }, 25, 'A greeting and one question'),
    h('cyber', 'Cybersecurity study', 'skill', { type: 'daily' }, 20, '20 minutes'),
    h('agency', 'Agency block (1.5h)', 'discipline', { type: 'daily' }, 25, '45 minutes'),
  ];
  const blocks: TimeBlock[] = [
    { id: 'b-wake', title: 'Wake', start: '07:00', end: '07:15', day: 'all', kind: 'fixed', fixed: true },
    { id: 'b-med', title: 'Meditation + stretch', start: '07:15', end: '07:45', day: 'all', kind: 'habit', habitId: 'meditate' },
    { id: 'b-job', title: 'Job', start: '09:30', end: '18:00', day: 'weekday', kind: 'fixed', fixed: true },
    { id: 'b-agency', title: 'Agency (min 1.5h)', start: '19:00', end: '20:30', day: 'weekday', kind: 'agency', habitId: 'agency' },
    { id: 'b-focus', title: 'Focus: skill of the day', start: '20:45', end: '21:45', day: 'weekday', kind: 'focus' },
    { id: 'b-wind', title: 'Read + journal', start: '22:00', end: '22:45', day: 'weekday', kind: 'habit', habitId: 'read' },
  ];
  const rewards: Reward[] = [
    { id: 'r1', title: 'A good meal out', cost: 500 },
    { id: 'r2', title: 'New book', cost: 1200 },
    { id: 'r3', title: 'Something for the desk', cost: 3000 },
  ];
  const settings: Settings = { theme: 'dark', skin: 'canopy', wakeTime: '07:00', name: 'Dinesh' };
  return {
    habits, habitLogs: [], tasks: [], blocks, workouts: [], body: [], journal: [], rewards, xp: [], wake: [], books: [], conversations: [], rejections: [], videos: [], channels: DEFAULT_CHANNELS,
    settings, settledThrough: addDays(today(), -1),
  };
}

/** Starter channels for the Entertainment feed: long-form, informative, no noise. Edit them in the app. */
const mk = (handle: string, topic: 'sec' | 'sci' | 'code') => ({ id: handle.replace(/^@/, '').toLowerCase(), handle, topic });
export const DEFAULT_CHANNELS = [
  mk('@LiveOverflow', 'sec'), mk('@_JohnHammond', 'sec'), mk('@ippsec', 'sec'), mk('@DavidBombal', 'sec'), mk('@HackerSploit', 'sec'),
  mk('@OALabs', 'sec'), mk('@MalwareAnalysisForHedgehogs', 'sec'),
  mk('@Computerphile', 'code'), mk('@LowLevelTV', 'code'), mk('@CodeAesthetic', 'code'),
  mk('@3blue1brown', 'sci'), mk('@veritasium', 'sci'), mk('@Kurzgesagt', 'sci'), mk('@Numberphile', 'sci'), mk('@Mathologer', 'sci'),
  mk('@SabineHossenfelder', 'sci'), mk('@minutephysics', 'sci'), mk('@SmarterEveryDay', 'sci'), mk('@RealEngineering', 'sci'),
];
