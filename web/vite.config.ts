import { defineConfig } from 'vite';

// `npm run ui` serves web/ (root) with web/public/session.json; `npm run ui:build` writes dist/web (relative paths, opens from any folder).
export default defineConfig({
  base: './',
  build: { outDir: '../dist/web', emptyOutDir: true },
  server: { port: 5173 },
});
