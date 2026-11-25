import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';

const paquete = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(paquete.version),
  },
  build: {
    target: 'es2020',
    sourcemap: false,
  },
  plugins: [
    VitePWA({
      // Las versiones nuevas se instalan cuando la persona toca "Actualizar".
      registerType: 'prompt',
      injectRegister: false,
      // El manifiesto vive en public/manifest.webmanifest.
      manifest: false,
      workbox: {
        globPatterns: ['**/*.{html,js,css,woff2,png,svg,webmanifest}'],
        // El emisor de licencias no es parte de la app de los negocios.
        globIgnores: ['emisor/**', 'sw-avisos.js'],
        // Avisos a clientas: clic en la notificación y revisión periódica (ver public/sw-avisos.js).
        importScripts: ['sw-avisos.js'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/emisor/, /^\/legal/],
        cleanupOutdatedCaches: true,
        // Nunca guardar en caché datos de otros sitios.
        runtimeCaching: [],
      },
      devOptions: { enabled: false },
    }),
  ],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    env: { TZ: 'America/La_Paz' },
  },
});
