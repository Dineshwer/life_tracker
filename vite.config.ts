import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
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
      workbox: {
        navigateFallback: '/index.html',
        // glb models are NOT precached (keeps the install light); they are cached on first use instead
        globIgnores: ['**/avatar/**', '**/*.glb'],
        runtimeCaching: [
          { urlPattern: ({ url }) => url.pathname.startsWith('/avatar/'), handler: 'CacheFirst', options: { cacheName: 'avatar-models', expiration: { maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 * 365 }, cacheableResponse: { statuses: [0, 200] }, rangeRequests: true } },
          { urlPattern: ({ url }) => url.pathname === '/hackertube.json', handler: 'StaleWhileRevalidate', options: { cacheName: 'hackertube-data', expiration: { maxEntries: 4 } } },
        ],
      },
    }),
  ],
});
