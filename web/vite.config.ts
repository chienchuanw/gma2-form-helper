/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // The gma2 tools hub serves this app at gma2.chienchuanw.com/form/ and strips the prefix
  // when proxying, so asset URLs carry /form/ while the files stay at the dist/ root.
  base: '/form/',
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
  },
})
