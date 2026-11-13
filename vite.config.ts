import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
    rollupOptions: { input: { main: 'web/index.html', preview: 'web/preview.html' } },
  },
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://127.0.0.1:3000', changeOrigin: false } },
  },
});
