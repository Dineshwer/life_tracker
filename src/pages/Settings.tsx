import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { supabase } from '../lib/supabase';
import { useSyncInfo } from '../sync/api';
import { Field, Page } from '../components/ui';
import ThemePicker from '../components/ThemePicker';
import { DataSyncSections } from '../components/sync/DataSyncSections';
import { liveActions, useOnline } from '../components/sync/actions';
import './settings.css';

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export default function Settings() {
  const settings = useStore((s) => s.settings);
  const info = useSyncInfo();
  const online = useOnline();
  const [email, setEmail] = useState<string>();
  useEffect(() => { supabase?.auth.getSession().then(({ data }) => setEmail(data.session?.user.email ?? undefined)).catch(() => {}); }, []);

  const patch = (p: Partial<typeof settings>) => useStore.setState((s) => ({ settings: { ...s.settings, ...p } }));

  return (
    <Page title="Settings" kicker="Preferences">
      <div className="set-stack">
        <section className="card set-card">
          <div className="set-head"><h2 className="display set-h">Theme</h2></div>
          <p className="set-note" style={{ marginTop: 0 }}>Pick a look. It applies everywhere and syncs to your phone. Every theme has a dark and a light version.</p>
          <ThemePicker />
        </section>

        <section className="card set-card" style={{ ['--d' as string]: '60ms' }}>
          <div className="set-head"><h2 className="display set-h">Rhythm</h2></div>
          <div className="set-grid">
            <div className="wide"><Field label="Your name"><input maxLength={200} value={settings.name} onChange={(e) => patch({ name: e.target.value })} /></Field></div>
            <Field label="Wake time, weekdays"><input type="time" value={settings.wakeTime} onChange={(e) => { if (TIME.test(e.target.value)) patch({ wakeTime: e.target.value }); }} /></Field>
            <Field label="Weekends (optional)"><input type="time" value={settings.weekendWake ?? ''} onChange={(e) => patch({ weekendWake: e.target.value || undefined })} /></Field>
          </div>
          <p className="set-note">Tapping "I'm up" within 15 minutes of this time earns full Discipline XP.</p>
        </section>

        <DataSyncSections info={info} online={online} email={email} actions={liveActions} local={!supabase} />
      </div>
    </Page>
  );
}
