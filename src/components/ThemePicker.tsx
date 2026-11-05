import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { DEFAULT_SKIN, SKINS, loadAllSkinFonts, type Mode, type Skin, type SkinGroup } from '../themes';
import './theme-picker.css';

const GROUPS: { id: SkinGroup; label: string; note: string }[] = [
  { id: 'calm', label: 'Calm', note: 'Quiet, readable, easy every day' },
  { id: 'bold', label: 'Bold', note: 'Game-like, high energy' },
  { id: 'artistic', label: 'Artistic', note: 'Distinct visual personalities' },
];

type Preview = 'native' | Mode;

/** A live miniature of a skin, rendered from the skin's real tokens. */
function Mini({ skin, mode }: { skin: Skin; mode: Mode }) {
  return (
    <div className="tp-mini" data-skin={skin.id} data-theme={mode} aria-hidden="true">
      <div className="tp-top">
        <span className="tp-date display">Friday <em>6</em></span>
        <span className="tp-chip">12d</span>
      </div>
      <div className="tp-card card">
        <span className="tp-ring" />
        <span className="tp-lines"><i /><i /></span>
      </div>
      <div className="tp-bars"><b style={{ ['--w' as string]: '72%', ['--c' as string]: 'var(--accent)' }} /><b style={{ ['--w' as string]: '48%', ['--c' as string]: 'var(--accent-2)' }} /></div>
      <div className="tp-dots"><i style={{ background: 'var(--body)' }} /><i style={{ background: 'var(--mind)' }} /><i style={{ background: 'var(--skill)' }} /><i style={{ background: 'var(--discipline)' }} /></div>
      <span className="tp-btn">I'm up</span>
    </div>
  );
}

export default function ThemePicker() {
  const skinId = useStore((s) => s.settings.skin ?? DEFAULT_SKIN);
  const mode = useStore((s) => s.settings.theme);
  const setSkin = useStore((s) => s.setSkin);
  const setTheme = useStore((s) => s.setTheme);
  const [preview, setPreview] = useState<Preview>('native');

  useEffect(() => { loadAllSkinFonts(); }, []);

  const modeFor = (s: Skin): Mode => (preview === 'native' ? s.nativeMode : preview);

  return (
    <div className="tpk">
      <div className="tpk-bar">
        <div className="tpk-seg" role="group" aria-label="Show previews as">
          {(['native', 'dark', 'light'] as const).map((p) => (
            <button key={p} className={preview === p ? 'on' : ''} aria-pressed={preview === p} onClick={() => setPreview(p)}>
              {p === 'native' ? 'As designed' : p === 'dark' ? 'Dark' : 'Light'}
            </button>
          ))}
        </div>
        <div className="tpk-mode">
          <span className="label">Current mode</span>
          <div className="tpk-seg" role="group" aria-label="Mode">
            {(['dark', 'light'] as const).map((m) => (
              <button key={m} className={mode === m ? 'on' : ''} aria-pressed={mode === m} onClick={() => setTheme(m)}>{m === 'dark' ? 'Dark' : 'Light'}</button>
            ))}
          </div>
        </div>
      </div>

      {GROUPS.map((g) => (
        <section key={g.id} className="tpk-group">
          <header><span className="display tpk-gname">{g.label}</span><span className="tpk-gnote">{g.note}</span></header>
          <div className="tpk-grid">
            {SKINS.filter((s) => s.group === g.id).map((s) => {
              const active = s.id === skinId;
              return (
                <button key={s.id} className={`tpk-tile${active ? ' on' : ''}`} aria-pressed={active} onClick={() => setSkin(s.id, modeFor(s))}>
                  <Mini skin={s} mode={modeFor(s)} />
                  <span className="tpk-meta"><span className="tpk-name">{s.name}</span><span className="tpk-tag">{s.tagline}</span></span>
                  {active && <span className="tpk-check" aria-label="Selected">Active</span>}
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
