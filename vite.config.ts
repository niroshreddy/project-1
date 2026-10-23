import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  build: { outDir: 'dist', rollupOptions: { input: { panel: 'panel.html' } } },
  server: { host: '127.0.0.1' }
});
