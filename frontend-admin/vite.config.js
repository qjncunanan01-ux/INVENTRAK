import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// API base URL baked in at build time. Keeps the CRA-era REACT_APP_API_BASE_URL
// contract working (Render's blueprint sets it, and api.js reads it) while also
// accepting the Vite-native VITE_API_BASE_URL. Falls back to localhost:4001.
const apiBase =
  process.env.REACT_APP_API_BASE_URL ||
  process.env.VITE_API_BASE_URL ||
  'http://localhost:4001';

export default defineConfig({
  plugins: [react()],
  // api.js reads process.env.REACT_APP_API_BASE_URL — keep that working under
  // Vite by replacing the exact token at build time. NODE_ENV is defined too so
  // React / MUI / emotion pick up production mode in `vite build`.
  define: {
    'process.env.REACT_APP_API_BASE_URL': JSON.stringify(apiBase),
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
  },
  server: {
    // Preserve the historical admin port so the run doc / previews stay valid.
    port: 3000,
  },
  build: {
    // Render's staticPublishPath is `build` — keep the CRA output dir.
    outDir: 'build',
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/setupTests.js'],
    css: false,
  },
});
