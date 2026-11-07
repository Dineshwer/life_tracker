import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { useStore } from './store';
import { supabase } from './lib/supabase';
import { startSync, stopSync } from './sync';
import Auth from './Auth';
import { DEFAULT_SKIN, loadSkinFonts } from './themes';
import { setActiveSkin } from './lib/activeSkin';
import { applyDemo } from './demo';

/** URL overrides for QA: ?skin=paper&mode=light&demo=1 (demo only when cloud sync is off). Never persisted. */
const QS = new URLSearchParams(typeof location === 'undefined' ? '' : location.search);
if (!supabase && QS.get('demo')) applyDemo();
import { IconBook, IconCharacter, IconGym, IconHabits, IconJournal, IconMore, IconMoon, IconPlay, IconRejection, IconRewards, IconSettings, IconSun, IconTasks, IconToday } from './components/icons';
import { Sheet } from './components/ui';
import Today from './pages/Today';
import Habits from './pages/Habits';
import Tasks from './pages/Tasks';
import Gym from './pages/Gym';
import Journal from './pages/Journal';
import Character from './pages/Character';
import Rewards from './pages/Rewards';
import Settings from './pages/Settings';
import Rejections from './pages/Rejections';
import Entertainment from './pages/Entertainment';
import Books from './pages/Books';
import SyncBanner from './components/SyncBanner';
import './styles/shell.css';

const NAV = [
  { to: '/today', label: 'Today', Icon: IconToday },
  { to: '/habits', label: 'Habits', Icon: IconHabits },
  { to: '/tasks', label: 'Tasks', Icon: IconTasks },
  { to: '/rejections', label: 'Rejections', Icon: IconRejection },
  { to: '/gym', label: 'Gym', Icon: IconGym },
  { to: '/journal', label: 'Journal', Icon: IconJournal },
  { to: '/books', label: 'Books', Icon: IconBook },
  { to: '/entertainment', label: 'Entertainment', Icon: IconPlay },
  { to: '/character', label: 'Character', Icon: IconCharacter },
  { to: '/rewards', label: 'Rewards', Icon: IconRewards },
  { to: '/settings', label: 'Settings', Icon: IconSettings },
];
const MOBILE = ['/today', '/habits', '/tasks', '/gym'];

export default function App() {
  const storedTheme = useStore((s) => s.settings.theme);
  const storedSkin = useStore((s) => s.settings.skin ?? DEFAULT_SKIN);
  const theme = (QS.get('mode') === 'light' || QS.get('mode') === 'dark' ? QS.get('mode') : storedTheme) as 'dark' | 'light';
  const skin = QS.get('skin') ?? storedSkin;
  const setTheme = useStore((s) => s.setTheme);
  const settle = useStore((s) => s.settle);
  // undefined = still checking, null = signed out
  const [moreOpen, setMoreOpen] = useState(false);
  const location = useLocation();
  useEffect(() => { setMoreOpen(false); }, [location.pathname]);
  const onMore = !MOBILE.includes(location.pathname);
  const [session, setSession] = useState<Session | null | undefined>(supabase ? undefined : null);

  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => { document.documentElement.dataset.skin = skin; setActiveSkin(skin); loadSkinFonts(skin); }, [skin]);
  useEffect(() => { settle(); }, [settle]);

  useEffect(() => {
    if (!supabase) return;
    // Offline-first: if Supabase can't answer within 2s (no network), open with the saved login so local data still shows.
    let settled = false;
    const stored = () => {
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith('sb-') && k.endsWith('-auth-token')) { const v = JSON.parse(localStorage.getItem(k) || 'null'); if (v?.user?.id) return v as Session; }
        }
      } catch { /* ignore */ }
      return null;
    };
    const timer = window.setTimeout(() => { if (!settled) { settled = true; setSession(stored()); } }, 2000);
    supabase.auth.getSession().then(({ data }) => { settled = true; window.clearTimeout(timer); setSession(data.session); }).catch(() => { if (!settled) { settled = true; window.clearTimeout(timer); setSession(stored()); } });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => { window.clearTimeout(timer); data.subscription.unsubscribe(); };
  }, []);

  const uid = session?.user.id;
  useEffect(() => {
    if (!uid) return;
    startSync(uid);
    return () => stopSync();
  }, [uid]);

  if (supabase && session === undefined) return null;
  if (supabase && !session) return <Auth />;

  return (
    <div className="shell">
      <aside className="rail">
        <div className="brand display">Ledger<span>.</span></div>
        <nav>
          {NAV.map(({ to, label, Icon }) => (
            <NavLink key={to} to={to} className={({ isActive }) => `rail-link${isActive ? ' on' : ''}`}><Icon size={18} />{label}</NavLink>
          ))}
        </nav>
        <button className="theme-toggle" onClick={() => setTheme(storedTheme === 'dark' ? 'light' : 'dark')} aria-label="Toggle theme">
          {theme === 'dark' ? <IconSun size={16} /> : <IconMoon size={16} />}<span>{theme === 'dark' ? 'Light' : 'Dark'}</span>
        </button>
      </aside>
      <main className="main">
          <SyncBanner />
        <Routes>
          <Route path="/" element={<Navigate to="/today" replace />} />
          <Route path="/today" element={<Today />} />
          <Route path="/habits" element={<Habits />} />
          <Route path="/tasks" element={<Tasks />} />
          <Route path="/rejections" element={<Rejections />} />
          <Route path="/books" element={<Books />} />
          <Route path="/entertainment" element={<Entertainment />} />
          <Route path="/gym" element={<Gym />} />
          <Route path="/journal" element={<Journal />} />
          <Route path="/character" element={<Character />} />
          <Route path="/rewards" element={<Rewards />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
      <nav className="tabbar">
        {NAV.filter((n) => MOBILE.includes(n.to)).map(({ to, label, Icon }) => (
          <NavLink key={to} to={to} className={({ isActive }) => `tab${isActive ? ' on' : ''}`}><Icon size={20} /><span>{label}</span></NavLink>
        ))}
        <button className={`tab${onMore || moreOpen ? ' on' : ''}`} onClick={() => setMoreOpen(true)} aria-haspopup="dialog"><IconMore size={20} /><span>More</span></button>
      </nav>
      <Sheet open={moreOpen} onClose={() => setMoreOpen(false)} title="More">
        <nav className="more-list">
          {NAV.filter((n) => !MOBILE.includes(n.to)).map(({ to, label, Icon }) => (
            <NavLink key={to} to={to} className={({ isActive }) => `more-link${isActive ? ' on' : ''}`}><Icon size={20} /><span>{label}</span></NavLink>
          ))}
          <button className="more-link" onClick={() => setTheme(storedTheme === 'dark' ? 'light' : 'dark')}>{storedTheme === 'dark' ? <IconSun size={20} /> : <IconMoon size={20} />}<span>{storedTheme === 'dark' ? 'Light mode' : 'Dark mode'}</span></button>
        </nav>
      </Sheet>
    </div>
  );
}
