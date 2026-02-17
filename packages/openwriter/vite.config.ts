import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  root: '.',
  build: {
    outDir: 'dist/client',
    emptyDirOnly: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/ws': {
        target: 'http://localhost:5050',
        ws: true,
      },
      '/api': {
        target: 'http://localhost:5050',
      },
      '/_images': {
        target: 'http://localhost:5050',
      },
    },
  },
});
