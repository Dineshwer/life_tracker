import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { IconCheck } from '../icons';
import './ui.css';

export function Button({ variant = 'solid', className = '', ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'solid' | 'ghost' | 'text' }) {
  return <button {...p} className={`btn btn-${variant} ${className}`} />;
}

/** Circular check: empty ring, half = minimum version, full = done. */
export function Ring({ state, onClick, label, color = 'var(--accent)' }: { state: 'none' | 'min' | 'full'; onClick?: () => void; label: string; color?: string }) {
  return (
    <button className={`ring ring-${state}`} style={{ ['--c' as string]: color }} onClick={onClick} aria-label={label} aria-pressed={state !== 'none'}>
      {state === 'full' && <IconCheck size={14} />}
      {state === 'min' && <span className="ring-half" />}
    </button>
  );
}

export function Bar({ pct, color = 'var(--accent)', height = 2 }: { pct: number; color?: string; height?: number }) {
  return (
    <div className="bar" style={{ height }} role="progressbar" aria-valuenow={Math.round(pct * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div className="bar-fill" style={{ width: `${Math.min(1, Math.max(0, pct)) * 100}%`, background: color }} />
    </div>
  );
}

export function SectionHeader({ label, right }: { label: string; right?: ReactNode }) {
  return (
    <div className="section-header">
      <span className="label">{label}</span>
      <span className="section-rule" />
      {right && <span className="label">{right}</span>}
    </div>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className="display stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  if (!open) return null;
  return (
    <div className="sheet-scrim" onClick={onClose}>
      <div className="sheet" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head"><h2 className="display">{title}</h2><Button variant="text" onClick={onClose}>Close</Button></div>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="field"><span className="label">{label}</span>{children}</label>;
}

export function Page({ title, kicker, actions, children }: { title: string; kicker?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="page">
      <header className="page-head">
        <div>{kicker && <div className="label">{kicker}</div>}<h1 className="display page-title">{title}</h1></div>
        {actions}
      </header>
      {children}
    </div>
  );
}
