/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Tauri dev server config kept for the `tauri dev` workflow.
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    target: 'es2021',
    minify: !process.env.TAURI_DEBUG ? 'esbuild' : false,
    sourcemap: !!process.env.TAURI_DEBUG,
  },
  // Component tests need a DOM (jsdom) and @testing-library/jest-dom
  // matchers. The setup file imports jest-dom and runs once per test
  // file so we don't have to repeat `import '@testing-library/jest-dom'`
  // at the top of every test.
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    css: false,
  },
});
