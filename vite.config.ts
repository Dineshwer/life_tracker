import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

/** Serves api/feed.js at /api/feed while developing, the same way Vercel will in production. */
function apiDev(env: Record<string, string>): Plugin {
  return {
    name: 'ledger-api-dev',
    configureServer(server) {
      server.middlewares.use('/api/feed', async (req, res) => {
        try {
          const mod = await server.ssrLoadModule('/api/feed.js');
          const q = Object.fromEntries(new URL(req.url ?? '', 'http://localhost').searchParams);
          const out = await mod.run(q, env);
          res.statusCode = out.status; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(out.body));
        } catch (e) { res.statusCode = 500; res.end(JSON.stringify({ error: String(e) })); }
      });
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [
    apiDev(loadEnv(mode, process.cwd(), '')),
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'Ledger',
        short_name: 'Ledger',
        description: 'A personal tracker for tasks, habits, gym and routine.',
        start_url: '/today',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0b0f0d',
        theme_color: '#0b0f0d',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: { navigateFallback: '/index.html' },
    }),
  ],
}));
