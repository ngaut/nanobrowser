/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    // Environment setup
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],

    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/**',
        'dist/**',
        'public/**',
        'scripts/**',
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/test-setup.ts',
        '**/types.ts',
        '**/schemas/**',
        'src/shared/types/**',
      ],
      include: ['src/**/*.ts', 'src/**/*.js'],
      thresholds: {
        global: {
          branches: 70,
          functions: 70,
          lines: 70,
          statements: 70,
        },
      },
    },

    // Test file patterns
    include: ['src/**/*.{test,spec}.{js,ts}', 'tests/**/*.{test,spec}.{js,ts}'],

    // Test timeout
    testTimeout: 10000,

    // Global test configuration
    globals: true,

    // Reporter configuration
    reporter: ['verbose', 'json'],

    // Parallel execution
    threads: true,
    maxThreads: 4,

    // Watch mode configuration
    watchExclude: ['node_modules/**', 'dist/**', '**/*.log'],
  },

  // Path resolution
  resolve: {
    alias: {
      '@src': resolve(__dirname, './src'),
      '@test': resolve(__dirname, './tests'),
      '@extension/storage': resolve(__dirname, '../packages/storage'),
      '@extension/shared': resolve(__dirname, '../packages/shared'),
    },
  },

  // Define global variables for testing
  define: {
    'import.meta.env.DEV': true,
    'import.meta.env.PROD': false,
    'import.meta.env.MODE': '"test"',
  },
});
