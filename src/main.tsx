import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './styles/tokens.css';
import './styles/skins/index.css';
import './styles/touch.css';
import App from './App';
import { migrateLegacyPrefs } from './lib/synced';

migrateLegacyPrefs(); // move any data kept only in this browser into the synced store
createRoot(document.getElementById('root')!).render(
  <StrictMode><BrowserRouter><App /></BrowserRouter></StrictMode>,
);
