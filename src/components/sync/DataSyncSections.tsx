import type { SyncInfo } from '../../sync/types';
import type { SyncActions } from './actions';
import { StatusCard } from './StatusCard';
import { ResetCard } from './ResetCard';
import { ConflictList } from './ConflictList';
import { BackupsCard } from './BackupsCard';
import { FileBackup } from './FileBackup';

const Card = ({ title, delay, children, id }: { title: string; delay: number; children: React.ReactNode; id?: string }) => (
  <section className="card set-card" id={id} style={{ ['--d' as string]: `${delay}ms` }} aria-label={title}>
    <div className="set-head"><h2 className="display set-h">{title}</h2></div>
    {children}
  </section>
);

/** Every data-related card in Settings. Pure of globals: data and actions come in as props. `local` = no account (sync off). */
export function DataSyncSections({ info, online, email, actions, local }: { info: SyncInfo; online: boolean; email?: string; actions: SyncActions; local: boolean }) {
  if (local) {
    return (
      <Card title="Your data" delay={120} id="data-sync">
        <p className="ds-local" role="status"><strong>Your data is stored only on this device.</strong> There is no account, so nothing is uploaded and nothing is backed up for you. If you clear this browser's data or lose this device, your data is gone.</p>
        <p className="set-note">Download a backup file now and then, and keep it somewhere safe.</p>
        <FileBackup emphasis />
      </Card>
    );
  }
  return (
    <>
      <Card title="Data & sync" delay={120} id="data-sync"><StatusCard info={info} online={online} email={email} actions={actions} /></Card>
      <Card title="Where your data lives" delay={150}><ResetCard info={info} online={online} actions={actions} /></Card>
      <Card title="Recent changes merged from other devices" delay={180}><ConflictList conflicts={info.conflicts} onRestore={actions.restoreConflict} /></Card>
      <Card title="Backups" delay={210}><BackupsCard actions={actions} online={online} /></Card>
      <Card title="Backup file" delay={240}>
        <p className="set-note" style={{ marginTop: 0 }}>A copy you keep yourself, separate from your account. Restoring from a file shows what will change before it does.</p>
        <FileBackup />
      </Card>
    </>
  );
}
