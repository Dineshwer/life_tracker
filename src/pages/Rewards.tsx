import { useState } from 'react';
import { useStore, uid } from '../store';
import type { Reward } from '../types';
import { Bar, Button, Field, Page, SectionHeader, Sheet } from '../components/ui';
import { IconCheck, IconPlus } from '../components/icons';
import { overallXP } from '../lib/xp';
import './rewards/rewards.css';

function Form({ reward, onClose }: { reward: Reward | null; onClose: () => void }) {
  const { upsert, remove } = useStore();
  const [title, setTitle] = useState(reward?.title ?? '');
  const [cost, setCost] = useState(reward?.cost ?? 1000);
  const valid = title.trim() && cost > 0;
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (!valid) return; upsert('rewards', { ...reward, id: reward?.id ?? uid(), title: title.trim(), cost: Math.round(cost) }); onClose(); }}>
      <Field label="Reward"><input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus placeholder="Something worth grinding for" /></Field>
      <Field label="Cost (total XP)"><input type="number" min={1} value={cost} onChange={(e) => setCost(+e.target.value)} /></Field>
      <div className="rw-actions">
        {reward ? <Button type="button" variant="ghost" onClick={() => { remove('rewards', reward.id); onClose(); }}>Remove</Button> : <span />}
        <Button type="submit" disabled={!valid}>Save</Button>
      </div>
    </form>
  );
}

export default function Rewards() {
  const rewards = useStore((s) => s.rewards);
  const xp = useStore((s) => s.xp);
  const claim = useStore((s) => s.claimReward);
  const total = overallXP(xp);
  const [editing, setEditing] = useState<Reward | null>(null);
  const [open, setOpen] = useState(false);
  const edit = (r: Reward | null) => { setEditing(r); setOpen(true); };

  const pending = rewards.filter((r) => !r.claimedAt).sort((a, b) => a.cost - b.cost);
  const claimed = rewards.filter((r) => r.claimedAt);

  const nextUp = pending.find((r) => total < r.cost);
  const R = 30, C = 2 * Math.PI * R;

  return (
    <Page title="Rewards" kicker="Earned, then enjoyed" actions={<Button variant="ghost" onClick={() => edit(null)}><IconPlus size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />Add</Button>}>
      <section className="card rw-head rise" style={{ ['--i' as string]: 0 }}>
        <div>
          <div className="label">Total XP banked</div>
          <div className="display rw-big">{total.toLocaleString()}</div>
        </div>
        <p className="display rw-sub">{nextUp ? <>{(nextUp.cost - total).toLocaleString()} XP from <em>{nextUp.title}</em>.</> : pending.length ? 'Everything on the wall is yours to claim.' : 'The wall is bare. Hang something worth chasing.'}</p>
      </section>

      <SectionHeader label="To earn" right={pending.length} />
      {pending.length ? (
        <ul className="rw-grid">
          {pending.map((r, i) => {
            const ok = total >= r.cost;
            const pct = Math.min(1, total / r.cost);
            const state = ok ? 'open' : pct >= 0.5 ? 'almost' : 'locked';
            return (
              <li className={`card rw-card rw-${state} rise`} key={r.id} style={{ ['--i' as string]: 1 + Math.min(i, 8) }}>
                <div className="rw-top">
                  <div className="rw-arc" role="img" aria-label={`${Math.floor(pct * 100)} percent`}>
                    <svg viewBox="0 0 72 72">
                      <circle cx="36" cy="36" r={R} fill="none" stroke="var(--line-strong)" strokeWidth="2" />
                      <circle className="rw-arcfill" cx="36" cy="36" r={R} fill="none" stroke="var(--accent-2)" strokeWidth="3.5" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - pct)} transform="rotate(-90 36 36)" />
                    </svg>
                    <span className="p">{ok ? <IconCheck size={18} /> : `${Math.floor(pct * 100)}%`}</span>
                  </div>
                  <span className="label rw-state">{ok ? 'Unlocked' : state === 'almost' ? 'Almost there' : 'Locked'}</span>
                </div>
                <button className="display rw-title" onClick={() => edit(r)}>{r.title}</button>
                <div className="rw-foot">
                  <div><div className="display rw-costn">{r.cost.toLocaleString()}</div><div className="label">{ok ? 'XP, covered' : `${(r.cost - total).toLocaleString()} XP to go`}</div></div>
                  {ok && <Button onClick={() => claim(r.id)}>Claim</Button>}
                </div>
                {!ok && <Bar pct={pct} color="var(--accent-2)" height={3} />}
              </li>
            );
          })}
        </ul>
      ) : <p className="rw-empty">Nothing queued. Add something worth grinding for.</p>}

      {claimed.length > 0 && (
        <>
          <SectionHeader label="Claimed" right={claimed.length} />
          <ul className="rw-grid">
            {claimed.map((r) => (
              <li className="card rw-card rw-done" key={r.id}>
                <button className="display rw-title" onClick={() => edit(r)}>{r.title}</button>
                <div className="rw-cost">{r.cost.toLocaleString()} XP &middot; {new Date(r.claimedAt!).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</div>
              </li>
            ))}
          </ul>
        </>
      )}

      <Sheet open={open} onClose={() => setOpen(false)} title={editing ? 'Edit reward' : 'New reward'}>
        {open && <Form key={editing?.id ?? 'new'} reward={editing} onClose={() => setOpen(false)} />}
      </Sheet>
    </Page>
  );
}
