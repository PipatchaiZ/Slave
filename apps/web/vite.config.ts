import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // @slave/engine is a workspace package whose entry is raw .ts — let Vite
  // transpile it directly rather than pre-bundling.
  optimizeDeps: { exclude: ['@slave/engine'] },
  server: {
    port: 5173,
    fs: { allow: ['../..'] },
  },
});
