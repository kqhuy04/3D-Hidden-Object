import { defineConfig } from 'vite';

export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  // NOTE: do not add '**/*.mjs' here. It matches Vite's own client
  // (node_modules/vite/dist/client/client.mjs), which then gets loaded as a
  // static asset and loses its exports -> "does not provide an export named
  // 'createHotContext'" and a dead app. Public .mjs kit files are served
  // statically from /public and never need this.
  assetsInclude: ['**/*.glb', '**/*.gltf'],
  build: {
    target: 'safari13',
    minify: 'esbuild',
  },
});
