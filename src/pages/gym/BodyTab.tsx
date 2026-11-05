import { useRef, useState } from 'react';
import { useStore, uid } from '../../store';
import { today } from '../../lib/dates';
import { SectionHeader } from '../../components/ui';
import { IconClose } from '../../components/icons';
import type { BodyEntry } from '../../types';
import LineChart from './LineChart';
import { bodyWeightSeries, downscale, shortDate, num } from './lib';

export default function BodyTab() {
  const body = useStore((s) => s.body);
  const upsert = useStore((s) => s.upsert);
  const remove = useStore((s) => s.remove);
  const [date, setDate] = useState(today());
  const [wt, setWt] = useState('');
  const [mName, setMName] = useState(''); const [mVal, setMVal] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const entry = body.find((b) => b.date === date);
  const save = (p: Partial<BodyEntry>) => upsert('body', { ...(entry ?? { id: uid(), date }), ...p } as BodyEntry);

  const saveWeight = () => { const v = Number(wt); if (v > 0) { save({ weightKg: v }); setWt(''); } };
  const addM = () => { const v = Number(mVal); if (mName.trim() && Number.isFinite(v) && mVal !== '') { save({ measurements: { ...(entry?.measurements ?? {}), [mName.trim()]: v } }); setMName(''); setMVal(''); } };
  const delM = (k: string) => { const m = { ...(entry?.measurements ?? {}) }; delete m[k]; save({ measurements: m }); };
  const onFile = async (f?: File) => {
    if (!f) return; setBusy(true);
    try { save({ photo: await downscale(f, 800) }); } catch { /* ignore bad image */ }
    setBusy(false); if (fileRef.current) fileRef.current.value = '';
  };

  const sorted = [...body].sort((a, b) => (a.date < b.date ? 1 : -1));
  const photos = sorted.filter((b) => b.photo);
  const delta = (name: string) => {
    const withM = sorted.filter((b) => b.measurements && name in b.measurements);
    return withM.length > 1 ? (withM[0].measurements![name] - withM[1].measurements![name]) : null;
  };
  const latestM = new Map<string, number>();
  for (const b of [...sorted].reverse()) for (const [k, v] of Object.entries(b.measurements ?? {})) latestM.set(k, v);

  return (
    <div>
      <label className="gym-date"><span className="label">Date</span><input type="date" value={date} max={today()} onChange={(e) => e.target.value && setDate(e.target.value)} /></label>

      <SectionHeader label="Weight" right={entry?.weightKg != null ? `${num(entry.weightKg)} kg` : undefined} />
      <div className="card gym-chart-card"><LineChart id="bw2" data={bodyWeightSeries(body)} unit="kg" decimals={1} /></div>
      <div className="gym-inline gym-weight-in">
        <input className="gym-input gym-big" inputMode="decimal" placeholder={entry?.weightKg != null ? num(entry.weightKg) : 'kg'} value={wt} onChange={(e) => setWt(e.target.value.replace(/[^0-9.]/g, ''))} aria-label="Body weight in kg" />
        <button className="gym-btn gym-btn-lg" disabled={!(Number(wt) > 0)} onClick={saveWeight}>Save</button>
      </div>

      <SectionHeader label="Measurements" />
      {latestM.size > 0 && (
        <ul className="gym-meas card">
          {[...latestM.entries()].map(([k, v]) => {
            const d = delta(k);
            const here = entry?.measurements && k in entry.measurements;
            return (
              <li key={k}>
                <span>{k}</span>
                <span className="mono">{num(v)}{d != null && d !== 0 && <span className="gym-delta"> {d > 0 ? '+' : '−'}{num(Math.abs(d))}</span>}</span>
                {here ? <button className="gym-x" onClick={() => delM(k)} aria-label={`Remove ${k}`}><IconClose size={16} /></button> : <span className="gym-x-sp" />}
              </li>
            );
          })}
        </ul>
      )}
      <div className="gym-inline">
        <input className="gym-input" placeholder="Name (e.g. Waist)" value={mName} onChange={(e) => setMName(e.target.value)} />
        <input className="gym-input gym-short" inputMode="decimal" placeholder="Value" value={mVal} onChange={(e) => setMVal(e.target.value.replace(/[^0-9.]/g, ''))} />
        <button className="gym-btn gym-btn-ghost" onClick={addM} disabled={!mName.trim() || mVal === ''}>Add</button>
      </div>

      <SectionHeader label="Progress photos" />
      <div className="gym-inline">
        <input ref={fileRef} type="file" accept="image/*" className="gym-file" onChange={(e) => onFile(e.target.files?.[0])} id="gym-photo" />
        <label htmlFor="gym-photo" className="gym-btn gym-btn-ghost gym-filebtn">{busy ? 'Processing…' : entry?.photo ? 'Replace photo for this date' : 'Add photo for this date'}</label>
      </div>
      {photos.length === 0 ? <div className="gym-empty">No photos yet. One a month is plenty.</div> : (
        <div className="gym-photos">
          {photos.map((b, i) => (
            <figure key={b.id} className="gym-polaroid" style={{ ['--rot' as string]: `${((i * 37) % 7 - 3) * 0.6}deg` }}>
              <img src={b.photo} alt={`Progress ${b.date}`} loading="lazy" />
              <figcaption><span className="label">{shortDate(b.date)}</span>
                <button className="gym-x" aria-label="Delete photo" onClick={() => upsert('body', { ...b, photo: undefined })}><IconClose size={14} /></button></figcaption>
            </figure>
          ))}
        </div>
      )}

      {sorted.some((b) => b.weightKg != null) && (
        <>
          <SectionHeader label="Weight history" />
          <ul className="gym-meas card">
            {sorted.filter((b) => b.weightKg != null).slice(0, 10).map((b) => (
              <li key={b.id}><span className="label">{shortDate(b.date)}</span><span className="mono">{num(b.weightKg as number)} kg</span>
                <button className="gym-x" aria-label="Delete entry" onClick={() => (b.photo || b.measurements ? upsert('body', { ...b, weightKg: undefined }) : remove('body', b.id))}><IconClose size={16} /></button></li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
