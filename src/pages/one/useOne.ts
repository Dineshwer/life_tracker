import { useMemo } from 'react';
import { useStore } from '../../store';
import { today } from '../../lib/dates';
import { entriesOf, statsFor, suggest } from '../../lib/oneExercise';

/** Entries, per-exercise stats and the ranked suggestion, all derived from the store. */
export function useOne() {
  const oneLogs = useStore((s) => s.oneLogs);
  const workouts = useStore((s) => s.workouts);
  const t = today();
  return useMemo(() => {
    const entries = entriesOf(oneLogs, workouts);
    const stats = statsFor(entries, t);
    const ranked = suggest(entries, t);
    const doneToday = [...new Set(entries.filter((e) => e.date === t).map((e) => e.ex))];
    return { t, entries, stats, ranked, top: ranked[0], doneToday };
  }, [oneLogs, workouts, t]);
}
