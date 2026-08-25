import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';
export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
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
      // Do not modify — file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
    build: {
      // FIX: em builds Linux (Render), o Rollup às vezes tenta resolver estaticamente
      // o import opcional "fsevents" (binário nativo só de macOS, usado internamente
      // pelo watcher do Chokidar) e quebra o build com "Rollup failed to resolve
      // import fsevents". Ele nunca é de fato executado fora do macOS — o próprio
      // Chokidar já protege essa chamada com checagem de plataforma — então é seguro
      // marcar como external: o Rollup simplesmente ignora e não tenta empacotar.
      rollupOptions: {
        external: ['fsevents'],
      },
    },
    optimizeDeps: {
      exclude: ['fsevents'],
    },
  };
});
