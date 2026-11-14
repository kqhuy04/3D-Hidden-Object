import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './',
  server: { host: '127.0.0.1', port: 5180, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2020' },
});
