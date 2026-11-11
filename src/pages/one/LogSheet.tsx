import { useState } from 'react';
import { Button, Field, Sheet } from '../../components/ui';
import { useStore } from '../../store';
import { ONE, ONE_BY_ID } from '../../lib/oneExercise';
import type { OneId } from '../../types';

/** Quick log for one of the eight exercises. */
export default function LogSheet({ open, exercise, onClose }: { open: boolean; exercise: OneId | null; onClose: () => void }) {
  return <Sheet open={open} onClose={onClose} title="Log the one">{open && exercise && <Form key={exercise} start={exercise} onClose={onClose} />}</Sheet>;
}

function Form({ start, onClose }: { start: OneId; onClose: () => void }) {
  const add = useStore((s) => s.addOneLog);
  const [ex, setEx] = useState<OneId>(start);
  const [sets, setSets] = useState(4);
  const [reps, setReps] = useState(8);
  const [effort, setEffort] = useState(6);
  const ok = sets > 0 && reps > 0;
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (!ok) return; add(ex, sets, reps, effort); onClose(); }}>
      <Field label="Exercise"><select value={ex} onChange={(e) => setEx(e.target.value as OneId)}>{ONE.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></Field>
      <p className="one-dose">Easy dose: {ONE_BY_ID[ex].dose}. Keep it around 5–6 out of 10.</p>
      <div className="row2">
        <Field label="Sets"><input type="number" min={1} value={sets} onChange={(e) => setSets(+e.target.value)} /></Field>
        <Field label="Reps per set"><input type="number" min={1} value={reps} onChange={(e) => setReps(+e.target.value)} /></Field>
      </div>
      <Field label={`Effort: ${effort} / 10`}><input type="range" min={1} max={10} value={effort} onChange={(e) => setEffort(+e.target.value)} /></Field>
      <Button type="submit" disabled={!ok}>Save</Button>
    </form>
  );
}
