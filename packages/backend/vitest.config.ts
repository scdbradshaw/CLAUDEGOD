import { defineConfig } from 'vitest/config';

// Vitest discovers tests from cwd. The build (tsc) emits compiled test files
// to `dist/backend/test/**/*.test.js` (cjs), which vitest re-discovers and
// chokes on because compiled cjs can't `require('vitest')`. Explicit exclude
// avoids running the same suites twice and silences the cjs error.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});
