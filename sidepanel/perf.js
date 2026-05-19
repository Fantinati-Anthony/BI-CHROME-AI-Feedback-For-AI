/**
 * MyFb Perf — local-only performance breadcrumbs.
 *
 * Tracks a few high-signal metrics in memory (and emits them to the
 * console only when STATE.showConsoleBtn is enabled). NO telemetry,
 * NO network calls — this is purely a debugging aid for power users
 * and contributors.
 *
 *   MyFbPerf.mark(label)         → records a timestamp
 *   MyFbPerf.measure(start, end) → reads delta in ms
 *   MyFbPerf.snapshot()          → { hydrate_ms, render_ms, ... }
 *   MyFbPerf.observeWebVitals()  → INP / CLS via PerformanceObserver
 */
(function (window) {
  'use strict';

  var marks   = Object.create(null);
  var metrics = Object.create(null);

  function mark(label) {
    if (!label) return;
    marks[label] = performance.now();
  }

  function measure(startLabel, endLabel) {
    var start = marks[startLabel];
    var end   = endLabel ? marks[endLabel] : performance.now();
    if (start == null || end == null) return null;
    var delta = Math.round(end - start);
    metrics[startLabel + '→' + (endLabel || 'now')] = delta;
    return delta;
  }

  function snapshot() {
    return Object.assign({}, metrics);
  }

  // Web Vitals — Interaction-to-Next-Paint (INP) is the modern signal
  // for responsiveness. CLS is mostly irrelevant for an extension panel
  // but cheap to expose. Layout shifts > 0.1 are warning-worthy.
  function observeWebVitals() {
    if (!('PerformanceObserver' in window)) return;
    try {
      var obs = new PerformanceObserver(function (list) {
        list.getEntries().forEach(function (entry) {
          if (entry.entryType === 'event' && entry.duration > 16) {
            metrics['inp_max'] = Math.max(metrics['inp_max'] || 0, Math.round(entry.duration));
          }
          if (entry.entryType === 'layout-shift' && !entry.hadRecentInput) {
            metrics['cls'] = (metrics['cls'] || 0) + entry.value;
          }
        });
      });
      // 'event' requires { durationThreshold }, supported Chrome 96+
      try { obs.observe({ type: 'event', durationThreshold: 16, buffered: true }); } catch (_) {}
      try { obs.observe({ type: 'layout-shift', buffered: true }); } catch (_) {}
    } catch (_) {}
  }

  window.MyFbPerf = {
    mark: mark, measure: measure, snapshot: snapshot, observeWebVitals: observeWebVitals,
  };
})(window);
