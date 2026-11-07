import { useStore, uid } from './store';
import { addDays, today } from './lib/dates';
import type { Task } from './types';

/** Dev/QA only: fill the local store with realistic sample data so every screen can be judged. */
export function applyDemo() {
  const st = useStore.getState();
  if (st.habitLogs.length > 0) return;
  let seed = 7;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const t = today();

  for (let back = 21; back >= 0; back--) {
    const d = addDays(t, -back);
    const dow = new Date(d + 'T00:00:00').getDay();
    for (const h of st.habits) {
      if (h.cadence.type === 'weekly') { if ([1, 2, 4, 6].includes(dow) && rnd() > 0.15) useStore.getState().logHabit(h.id, d, 'full'); continue; }
      const r = rnd();
      if (back === 0 && ['agency', 'cyber', 'voice', 'talk', 'posture'].includes(h.id)) continue; // leave today partly open
      if (r > 0.3) useStore.getState().logHabit(h.id, d, 'full');
      else if (r > 0.18) useStore.getState().logHabit(h.id, d, 'min');
    }
  }
  useStore.setState({ settledThrough: addDays(t, -1) });

  // 1,000 rejections challenge: 137 logged over ~3 weeks (1 full block + 3 cells + 7 dots)
  const asks = ['Asked a cafe owner for a free coffee', 'Pitched my web design agency to a salon owner', 'Asked a stranger to take my photo for a portfolio', 'Requested a discount at a bookshop', 'Cold-messaged a founder for a 15 minute call', 'Asked to join a table of strangers at lunch', 'Offered a free website audit to a local clinic', 'Asked a gym owner for a trial week', 'Asked my landlord for a lower rent', 'Pitched a retainer to a past client'];
  const whos = ['Corner cafe', 'Salon on 5th', 'Stranger at the park', 'Bookshop', 'LinkedIn DM', 'Lunch table', 'Clinic', 'Gym owner', 'Landlord', 'Past client'];
  const rej = Array.from({ length: 137 }, (_, i) => {
    const day = Math.floor((i / 137) * 21);
    const when = new Date(Date.now() - (21 - day) * 86400000 + i * 60000);
    return { id: uid(), date: addDays(t, day - 21 + 1 > 0 ? 0 : day - 21 + 1), createdAt: when.toISOString(), what: asks[i % asks.length] + (i % 3 === 0 ? ', they said not right now' : ''), who: whos[i % whos.length], note: i % 4 === 0 ? 'Ask earlier in the day next time' : undefined };
  });
  useStore.setState({ rejections: rej });
  useStore.setState({ videos: [
    { id: uid(), ytId: 'aircAruvnKk', title: 'But what is a neural network?', tag: 'learn', addedAt: new Date(Date.now() - 3e6).toISOString() },
    { id: uid(), ytId: 'kCc8FmEb1nY', title: "Let's build GPT: from scratch, in code, spelled out", tag: 'learn', addedAt: new Date(Date.now() - 2e6).toISOString() },
    { id: uid(), ytId: 'dQw4w9WgXcQ', title: 'A fun one for the weekend', tag: 'fun', addedAt: new Date(Date.now() - 1e6).toISOString() },
    { id: uid(), ytId: 'FtutLA63Cp8', title: 'Bad Apple, the classic', tag: 'fun', addedAt: new Date(Date.now() - 9e6).toISOString(), watchedAt: new Date().toISOString() },
  ] });

  const mk = (p: Partial<Task> & { title: string }): Task => ({ id: uid(), done: false, context: 'personal', tags: [], effort: 2, stat: 'discipline', ...p });
  const parent = mk({ title: 'Ship the client landing page', context: 'agency', date: t, tags: ['client', 'web'], effort: 3, stat: 'skill' });
  useStore.setState({
    tasks: [
      parent,
      mk({ title: 'Wireframes approved', context: 'agency', parentId: parent.id, done: true, effort: 1 }),
      mk({ title: 'Write the pricing section', context: 'agency', parentId: parent.id, effort: 2 }),
      mk({ title: 'Reply to vendor emails', context: 'job', date: t, effort: 1 }),
      mk({ title: 'Renew gym membership', context: 'personal', date: addDays(t, 2), effort: 1, tags: ['errands'] }),
      mk({ title: 'Finish TryHackMe web fundamentals', context: 'learning', date: addDays(t, 3), effort: 3, stat: 'skill', tags: ['cyber'] }),
      mk({ title: 'Write daily', context: 'personal', date: t, effort: 1, stat: 'mind', recurrence: { every: 'day', interval: 1 } }),
      mk({ title: 'Overdue: call the electrician', context: 'personal', date: addDays(t, -2), effort: 1, tags: ['errands'] }),
      mk({ title: 'Get to a 10 minute handstand hold', context: 'personal', horizon: 'long', effort: 3, stat: 'body' }),
      mk({ title: 'Land the first retainer client', context: 'agency', horizon: 'short', effort: 3, stat: 'skill' }),
      mk({ title: 'Buy a standing desk mat', context: 'personal', done: true, effort: 1 }),
    ],
    workouts: [
      { id: uid(), date: addDays(t, -6), name: 'Pull A', sets: [
        { id: uid(), exercise: 'Pull-up', reps: 6, weight: 0, unit: 'bw' }, { id: uid(), exercise: 'Pull-up', reps: 5, weight: 0, unit: 'bw' },
        { id: uid(), exercise: 'Tuck front lever hold', reps: 12, weight: 0, unit: 'sec' }, { id: uid(), exercise: 'Ring row', reps: 10, weight: 0, unit: 'bw' }] },
      { id: uid(), date: addDays(t, -3), name: 'Push A', sets: [
        { id: uid(), exercise: 'Dip', reps: 8, weight: 0, unit: 'bw' }, { id: uid(), exercise: 'Dip', reps: 7, weight: 0, unit: 'bw' },
        { id: uid(), exercise: 'Planche lean hold', reps: 20, weight: 0, unit: 'sec' }, { id: uid(), exercise: 'Pike push-up', reps: 9, weight: 0, unit: 'bw' }] },
      { id: uid(), date: addDays(t, -1), name: 'Pull A', sets: [
        { id: uid(), exercise: 'Pull-up', reps: 7, weight: 0, unit: 'bw' }, { id: uid(), exercise: 'Pull-up', reps: 6, weight: 0, unit: 'bw' },
        { id: uid(), exercise: 'Tuck front lever hold', reps: 15, weight: 0, unit: 'sec' }] },
    ],
    body: [
      { id: uid(), date: addDays(t, -20), weightKg: 71.4 }, { id: uid(), date: addDays(t, -13), weightKg: 71.0 },
      { id: uid(), date: addDays(t, -6), weightKg: 70.6 }, { id: uid(), date: addDays(t, -1), weightKg: 70.3 },
    ],
    journal: [
      { id: uid(), date: addDays(t, -1), kind: 'daily', body: 'Slow start but I protected the agency hour. Meditation first thing made the rest easier.', mood: 4, energy: 3 },
      { id: uid(), date: addDays(t, -2), kind: 'daily', body: 'Skipped the gym. Not proud, but I did the minimum stretch and read a chapter.', mood: 3, energy: 2 },
      { id: uid(), date: addDays(t, -4), kind: 'daily', body: 'Good conversation with a stranger at the cafe. Voice practice felt steadier.', mood: 5, energy: 4 },
    ],
    books: [
      { id: uid(), title: 'Atomic Habits', author: 'James Clear', status: 'reading', kind: 'self', pages: 320, page: 140, startedAt: addDays(t, -9) },
      { id: uid(), title: "The Web Application Hacker's Handbook", status: 'queued', kind: 'self', pages: 912 },
      { id: uid(), title: 'Deep Work', author: 'Cal Newport', status: 'done', kind: 'self', finishedAt: addDays(t, -30), rating: 5 },
      { id: uid(), title: 'The Alchemist', author: 'Paulo Coelho', status: 'reading', kind: 'story', pages: 208, page: 36, startedAt: addDays(t, -3) },
      { id: uid(), title: 'Norwegian Wood', author: 'Haruki Murakami', status: 'queued', kind: 'story' },
    ],
    conversations: [
      { id: uid(), date: addDays(t, -1), who: 'Barista at the corner cafe', note: 'Asked about the roast' },
      { id: uid(), date: addDays(t, -2), who: 'Neighbour on the stairs' },
      { id: uid(), date: addDays(t, -3), who: 'Delivery driver' },
    ],
    wake: [{ date: addDays(t, -1), time: '07:08' }, { date: addDays(t, -2), time: '07:20' }],
  });
}
