/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '../../dist/web',
    emptyOutDir: true,
    // HEIC conversion is intentionally lazy-loaded and large on its own.
    // Raise the warning threshold so build noise tracks the eagerly-loaded app code instead.
    chunkSizeWarningLimit: 1400,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('heic2any')) return 'heic2any';
          if (id.includes('@uppy/')) return 'uppy';
          if (id.includes('qrcode.react')) return 'qr';
          if (id.includes('fflate')) return 'zip';
          if (id.includes('react-router-dom')) return 'router';
          if (id.includes('react-dom')) return 'react-dom';
          if (id.includes('react')) return 'react';
          return undefined;
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.{ts,tsx}'],
    setupFiles: ['test/setup.ts'],
  },
})
