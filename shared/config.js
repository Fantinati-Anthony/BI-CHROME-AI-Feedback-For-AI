// @ts-check
/**
 * BIAIF Config — every magic number, debounce, and limit in one place.
 *
 * Grouped semantically (storage / UI / capture / mic / bridge / watcher).
 * Anything tweakable for tuning lives here so contributors don't have to
 * grep through implementation files.
 */
(function (root) {
  'use strict';
  root.BIAIF = root.BIAIF || {};

  root.BIAIF.config = Object.freeze({
    // ── Storage ────────────────────────────────────────────────────────
    storage: Object.freeze({
      QUOTA_WARN_BYTES:        8 * 1024 * 1024, // warn at 8 MB (Chrome limit ~10 MB)
      MAX_DEMANDE_LEN:         50000,           // max chars per demande text
    }),

    // ── UI ─────────────────────────────────────────────────────────────
    ui: Object.freeze({
      SEARCH_DEBOUNCE_MS:      150,             // history search filter
      MAX_TOASTS:              4,
      MAX_UNDO:                50,
      ARCHIVE_REFRESH_MS:      30000,           // relative-time refresh
      MIN_SEG_FONT_PX:         8,
      MAX_SEG_FONT_PX:         16,
      DEFAULT_SEG_FONT_PX:     13,
    }),

    // ── Capture / screenshots ──────────────────────────────────────────
    capture: Object.freeze({
      MIN_INTERVAL_MS:         1500,            // chrome.tabs.captureVisibleTab rate-limit
      MAX_RETRY:               3,
      RETRY_BASE_DELAY_MS:     2000,
      SCROLL_SETTLE_MS:        220,
      HIDE_LOADER_FOR_SHOT_MS: 80,
    }),

    // ── Mic / speech ──────────────────────────────────────────────────
    mic: Object.freeze({
      WATCHDOG_INTERVAL_MS:    3000,
      IDLE_WARN_MS:            12000,
    }),

    // ── VS Code bridge ────────────────────────────────────────────────
    bridge: Object.freeze({
      PING_TIMEOUT_MS:         3000,
    }),

    // ── AI watcher ────────────────────────────────────────────────────
    aiWatcher: Object.freeze({
      POLL_ACTIVE_MS:          700,
      POLL_IDLE_MS:            2000,
      DONE_DELAY_MS:           2500,
      STREAM_BURST_THRESHOLD:  4,
      STREAM_BURST_WINDOW_MS:  800,
    }),

    // ── Inject (text + images into AI editors) ─────────────────────────
    inject: Object.freeze({
      SUBMIT_RETRY_COUNT:      8,
      SUBMIT_RETRY_DELAY_MS:   200,
      SUBMIT_INITIAL_WAIT_MS:  300,
    }),
  });

})(typeof window !== 'undefined' ? window : self);
