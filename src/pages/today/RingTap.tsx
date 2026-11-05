import { useRef } from 'react';
import { Ring } from '../../components/ui';

type Lvl = 'none' | 'min' | 'full';
/** Ring: tap cycles none/min -> full -> none; long-press logs the minimum version. */
export function RingTap({ state, label, color, onFull, onMin, onClear }: { state: Lvl; label: string; color: string; onFull: () => void; onMin: () => void; onClear: () => void }) {
  const timer = useRef<number>();
  const fired = useRef(false);
  const start = () => { fired.current = false; timer.current = window.setTimeout(() => { fired.current = true; onMin(); }, 480); };
  const stop = () => window.clearTimeout(timer.current);
  return (
    <span
      className="rt"
      onPointerDown={start} onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop}
      onClickCapture={(e) => { if (fired.current) { e.stopPropagation(); fired.current = false; } }}
    >
      <Ring state={state} label={label} color={color} onClick={() => (state === 'full' ? onClear() : onFull())} />
    </span>
  );
}
