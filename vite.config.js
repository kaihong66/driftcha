import { defineConfig } from 'vite';
import { createApi } from './server/api.js';

/** Mounts the mock server's /api routes on the Vite dev and preview servers. */
function mockServer() {
  const mount = server => {
    const api = createApi();
    server.middlewares.use(api.middleware);
    server.httpServer?.once('close', () => api.close());
  };
  return { name: 'driftcha-mock-server', configureServer: mount, configurePreviewServer: mount };
}

export default defineConfig({
  // Relative asset URLs so the built demo works from any sub-path (e.g. GitHub Pages).
  base: './',
  plugins: [mockServer()],
  build: {
    target: 'es2022',
    outDir: 'dist'
  }
});
