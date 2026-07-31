import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  server: {
    port: 3000,
    host: '0.0.0.0',
    // Note: browser LibreOffice WASM fallback needs COOP/COEP + SharedArrayBuffer.
    // Primary PPTX path uses Express createWorkerConverter (no COEP), so we omit those
    // headers here to keep Google Fonts working under require-corp.
    proxy: {
      '/api': {
        target: 'http://localhost:3011',
        changeOrigin: true,
      },
      '/wasm': {
        target: 'http://localhost:3011',
        changeOrigin: true,
      },
      '/libreoffice': {
        target: 'http://localhost:3011',
        changeOrigin: true,
      },
    },
  },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  optimizeDeps: {
    include: ['pdfjs-dist'],
    exclude: ['@matbee/libreoffice-converter'],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('pdfjs-dist')) return 'pdfjs';
          if (id.includes('jspdf') || id.includes('html2canvas')) return 'pdf-export';
          if (id.includes('jszip') || id.includes('mammoth') || id.includes('docx-preview') || id.includes('turndown')) {
            return 'doc-convert';
          }
          if (id.includes('@matbee/libreoffice-converter')) return 'libreoffice-wasm';
        },
      },
    },
  },
});
