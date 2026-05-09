import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    base: '/OfflineGame/',
    plugins: [
      react(), 
      tailwindcss(),
      VitePWA({ 
        registerType: 'autoUpdate',
        manifest: {
          name: 'Offline Multiplayer Game',
          short_name: 'P2PGame',
          description: 'A WebRTC game over local network',
          theme_color: '#000000',
          background_color: '#ffffff',
          display: 'standalone',
        }
      })
    ],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
