import { useState } from 'react';
import type { ConflictEntry } from '../../sync/types';
import { Button } from '../ui';
import { describeConflict, relTime } from './format';
import { useNow } from './actions';

const key = (c: ConflictEntry) => `${c.at}|${c.collection}|${c.id}`;
const SHOWN = 8;

export function ConflictList({ conflicts, onRestore }: { conflicts: ConflictEntry[]; onRestore: (c: ConflictEntry) => void }) {
  const now = useNow();
  const [done, setDone] = useState<Set<string>>(new Set());
  const [all, setAll] = useState(false);
  const sorted = [...conflicts].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  if (!sorted.length) return <p className="ds-empty">No conflicts. Changes from your devices merge cleanly.</p>;
  const list = all ? sorted : sorted.slice(0, SHOWN);
  return (
    <>
      <ul className="ds-list">
        {list.map((c) => {
          const d = describeConflict(c); const k = key(c);
          return (
            <li key={k} className="ds-item">
              <div className="ds-item-main">
                <div className="ds-item-what">{d.what}</div>
                <p className="ds-item-text">{d.sentence}</p>
                <div className="ds-item-when">{relTime(c.at, now)}</div>
              </div>
              {c.local !== undefined && c.local !== null && (done.has(k)
                ? <span className="ds-chip ok">Restored</span>
                : <Button variant="ghost" className="ds-btn" aria-label={`Restore my version. ${d.what}`} onClick={() => { onRestore(c); setDone(new Set(done).add(k)); }}>Restore my version</Button>)}
            </li>
          );
        })}
      </ul>
      {sorted.length > SHOWN && <div className="set-actions"><Button variant="ghost" className="ds-btn" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${sorted.length}`}</Button></div>}
    </>
  );
}
