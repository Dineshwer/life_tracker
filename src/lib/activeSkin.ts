import { useSyncExternalStore } from 'react';
import { DEFAULT_SKIN } from '../themes';

/** The skin actually applied to <html> (stored choice, or a ?skin= QA override). Set by App. */
let current: string = DEFAULT_SKIN;
const subs = new Set<() => void>();
export const setActiveSkin = (id: string) => { if (id !== current) { current = id; subs.forEach((f) => f()); } };
export const useActiveSkin = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => current, () => DEFAULT_SKIN);
