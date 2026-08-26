import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(process.cwd(), '.'),
      },
    },
    // server.hmr só é usado pelo `vite dev` (modo serve). Deixamos ele fora do
    // objeto de config quando estamos rodando `vite build` (command === 'build'),
    // já que sua mera presença pode acionar inicialização de watcher do Rollup
    // mesmo num build de produção único, o que não é necessário e pode causar
    // problemas de resolução de módulo em certos ambientes Linux.
    ...(command === 'serve' ? {
      server: {
        hmr: process.env.DISABLE_HMR !== 'true',
      },
    } : {}),
    build: {
      rollupOptions: {
        external: ['fsevents'],
      },
    },
    optimizeDeps: {
      exclude: ['fsevents'],
    },
  };
});
