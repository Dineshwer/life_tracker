import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './styles/tokens.css';
import './styles/skins/index.css';
import './styles/touch.css';
import App from './App';
import { registerSW } from 'virtual:pwa-register';
import { migrateLegacyPrefs } from './lib/synced';
import { supabase } from './lib/supabase';
import { scheduleEntertainmentMigration } from './entertainment/migrate';

// PWA: apply new versions when the app is next backgrounded/refocused; check hourly
try {
  const upd = registerSW({
    immediate: true,
    onRegisteredSW(_u, r) { if (r) setInterval(() => { r.update().catch(() => {}); }, 3600_000); },
    onNeedRefresh() {
      const apply = () => { if (document.visibilityState === 'hidden') { document.removeEventListener('visibilitychange', apply); upd(true); } };
      document.addEventListener('visibilitychange', apply);
    },
  });
} catch { /* ignore */ }
window.addEventListener('vite:preloadError', () => {
  try { if (!sessionStorage.getItem('ledger-reloaded')) { sessionStorage.setItem('ledger-reloaded', '1'); location.reload(); } } catch { /* ignore */ }
});

migrateLegacyPrefs(); // move any data kept only in this browser into the synced store
scheduleEntertainmentMigration(!!supabase); // swap the old default channels for the new picks once (after the first cloud sync when signed in)
createRoot(document.getElementById('root')!).render(
  <StrictMode><BrowserRouter><App /></BrowserRouter></StrictMode>,
);
