import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Never pick up tests inside corellia build worktrees.
    exclude: ['**/node_modules/**', '**/dist/**', '.corellia/**'],
  },
});
