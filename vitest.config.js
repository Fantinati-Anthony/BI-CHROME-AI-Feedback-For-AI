import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.js'],
    include: ['tests/**/*.test.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['sidepanel/**/*.js', 'shared/**/*.js'],
      exclude: [
        '**/node_modules/**',
        'tests/**',
        // Render layer is hand-rolled DOM and would require deep DOM
        // mocks; not gated yet — will be lifted incrementally.
        'sidepanel/render/segments.js',
        'sidepanel/render/segment-card.js',
        'sidepanel/render/conversation-group.js',
        'sidepanel/render/archive-zone.js',
        'sidepanel/render/chips.js',
        'sidepanel/render/editor.js',
        'sidepanel/render/text-blocks.js',
        'sidepanel/render/filter-chips.js',
        // Bindings — DOM-heavy, planned for later coverage waves.
        'sidepanel/bindings/**',
        // Speech / wizard / palette / console — DOM-heavy, low logic.
        'sidepanel/speech.js',
        'sidepanel/wizard.js',
        'sidepanel/palette.js',
        'sidepanel/console.js',
        'sidepanel/perf.js',
        'sidepanel/export.js',
        'sidepanel/renderer.js',
      ],
      thresholds: {
        // Lines in the gated modules must stay above these floors.
        // Tighten incrementally as new tests land.
        lines:      55,
        statements: 55,
        functions:  50,
        branches:   45,
      },
    },
  },
});
