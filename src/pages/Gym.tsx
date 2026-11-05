import { useEffect, useState } from 'react';
import { Page } from '../components/ui';
import { useStore, uid } from '../store';
import { today } from '../lib/dates';
import LogTab from './gym/LogTab';
import PlanTab from './gym/PlanTab';
import ProgressTab from './gym/ProgressTab';
import BodyTab from './gym/BodyTab';
import { loadPlan, savePlan, type Plan, type PlanSession } from './gym/lib';
import './gym/gym.css';

const TABS = ['Log', 'Plan', 'Progress', 'Body'] as const;
type Tab = (typeof TABS)[number];

export default function Gym() {
  const [tab, setTab] = useState<Tab>('Log');
  const [plan, setPlan] = useState<Plan>(loadPlan);
  const [planned, setPlanned] = useState<PlanSession | null>(null);
  const upsert = useStore((s) => s.upsert);

  useEffect(() => { savePlan(plan); }, [plan]);

  const startFromPlan = (s: PlanSession) => {
    const d = today();
    const existing = useStore.getState().workouts.find((w) => w.date === d);
    if (!existing) upsert('workouts', { id: uid(), date: d, name: s.name, sets: [] });
    setPlanned(s); setTab('Log');
  };

  return (
    <Page title="Gym" kicker="Body · strength">
      <nav className="gym-tabs" role="tablist" style={{ ['--i' as string]: TABS.indexOf(tab) }}>
        <span className="gym-tabs-thumb" aria-hidden="true" />
        {TABS.map((t) => <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t}</button>)}
      </nav>
      <div className="gym-body" key={tab}>
        {tab === 'Log' && <LogTab planned={planned} plan={plan} onClearPlanned={() => setPlanned(null)} />}
        {tab === 'Plan' && <PlanTab plan={plan} setPlan={setPlan} onStart={startFromPlan} />}
        {tab === 'Progress' && <ProgressTab />}
        {tab === 'Body' && <BodyTab />}
      </div>
    </Page>
  );
}
