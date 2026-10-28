/* ============================================================================
 * demo-driver.js — offline demo driver for spider-widget.
 *
 * Simulates a DSH web-search session (tool.start / page.discovered /
 * page.status / session.done …) exactly as the host plugin would push it.
 * No network, no fetch, no external assets. Works from file://.
 *
 * URL params:
 *   ?mode=sidebar   380x700 right-sidebar simulation (screenshot target)
 *   ?mode=panel     900x600 floating-panel simulation (screenshot target)
 *   ?mode=showcase  both, side by side (default)
 *   ?once=1         stop after the first session (no loop)
 *   ?freeze=1       stop the event schedule right after the first 4 s burst
 *
 * Self-test: window.__spiderDemo.getState(), and #selftest gets a JSON snapshot
 * at t=4s / every 2s afterwards so headless Chrome --dump-dom can assert it.
 * ========================================================================= */
(function () {
  'use strict';

  var params = new URLSearchParams(location.search);
  var mode = params.get('mode') || 'showcase';
  document.body.className = 'mode-' + mode;
  document.title = 'spider-widget · ' + mode;

  var errors = [];
  var selftestEl = document.getElementById('selftest');
  var errorsEl = document.getElementById('errors');
  window.addEventListener('error', function (event) {
    errors.push(String((event && event.message) || event));
    if (errorsEl) errorsEl.textContent = errors.join('\n');
  });
  window.addEventListener('unhandledrejection', function (event) {
    errors.push('unhandledrejection: ' + String(event && event.reason));
    if (errorsEl) errorsEl.textContent = errors.join('\n');
  });

  var widgetOptions = {
    title: 'DSH WEB SPIDER',
    subtitle: 'web-search / web-fetch activity',
    modelName: 'deepseek-harness',
    locale: 'zh',
    routes: {
      code: { label: '检索' },
      model: { label: '抓取' },
      you: { label: '人工' },
    },
    showViewToggle: true,
  };

  var views = [];
  function mount(id) {
    var host = document.getElementById(id);
    if (!host) return null;
    var view = window.createSpiderView(host, widgetOptions);
    views.push(view);
    return view;
  }
  var sidebarView = mode === 'panel' ? null : mount('mount-sidebar');
  var panelView = mode === 'sidebar' ? null : mount('mount-panel');

  function broadcast(event) {
    for (var i = 0; i < views.length; i += 1) views[i].push(event);
  }

  /* ------------------------------------------------------------ scenario */
  // Five search results; p5 is the simulated failure (HTTP 403).
  var PAGES = [
    { id: 'gh-prompt-spider-ui', url: 'https://github.com/Kirito14IT/prompt-spider-ui', title: 'Kirito14IT/prompt-spider-ui · GitHub', source: 'search' },
    { id: 'gh-api-trees', url: 'https://api.github.com/repos/Kirito14IT/prompt-spider-ui/git/trees/main', title: 'GitHub REST API · git trees endpoint', source: 'search' },
    { id: 'mdn-canvas', url: 'https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API', title: 'Canvas API · MDN Web Docs', source: 'search' },
    { id: 'raw-renderer', url: 'https://raw.githubusercontent.com/Kirito14IT/prompt-spider-ui/main/app/renderer.js', title: 'renderer.js · raw source (29.9 kB)', source: 'search' },
    { id: 'blocked-page', url: 'https://example.invalid/blocked-page', title: 'blocked-page · upstream preview asset', source: 'search' },
  ];

  function pageById(id) {
    for (var i = 0; i < PAGES.length; i += 1) if (PAGES[i].id === id) return PAGES[i];
    return null;
  }
  function discovered(id, status) {
    var page = pageById(id);
    return {
      type: 'page.discovered',
      id: page.id,
      url: page.url,
      title: page.title,
      route: 'code',
      source: page.source,
      status: status || 'pending',
    };
  }
  function pageStatus(id, status, extra) {
    var page = pageById(id);
    var event = { type: 'page.status', id: page.id, url: page.url, title: page.title, status: status };
    if (extra) for (var key in extra) event[key] = extra[key];
    return event;
  }

  var SCRIPT = [
    // t=0 — session starts
    { at: 0, event: { type: 'session.start', sessionId: 'demo-session-1', title: 'DSH WEB SPIDER', subtitle: 'web-search / web-fetch activity', modelName: 'deepseek-harness' } },
    { at: 220, event: { type: 'tool.start', id: 'search-1', tool: 'web_search', query: 'prompt-spider-ui github canvas spider' } },
    // search results stream in
    { at: 480, event: discovered('gh-prompt-spider-ui') },
    { at: 640, event: discovered('gh-api-trees') },
    { at: 800, event: discovered('mdn-canvas') },
    { at: 960, event: discovered('raw-renderer') },
    { at: 1120, event: discovered('blocked-page') },
    { at: 1260, event: { type: 'tool.end', id: 'search-1', status: 'completed' } },
    // fetch #1 → completed
    { at: 1420, event: { type: 'tool.start', id: 'fetch-1', tool: 'web_fetch', url: 'https://github.com/Kirito14IT/prompt-spider-ui' } },
    { at: 1680, event: pageStatus('gh-prompt-spider-ui', 'running', { route: 'model' }) },
    { at: 2320, event: pageStatus('gh-prompt-spider-ui', 'completed', { route: 'model', score: 0.92, detail: 'README / LICENSE fetched: MIT, Copyright Kirito14IT' }) },
    { at: 2420, event: { type: 'tool.end', id: 'fetch-1', status: 'completed' } },
    // fetch #2 → completed
    { at: 2520, event: { type: 'tool.start', id: 'fetch-2', tool: 'web_fetch', url: 'https://api.github.com/repos/Kirito14IT/prompt-spider-ui/git/trees/main' } },
    { at: 2820, event: pageStatus('gh-api-trees', 'running', { route: 'model' }) },
    { at: 3080, event: pageStatus('gh-api-trees', 'completed', { route: 'model', score: 0.87 }) },
    { at: 3140, event: { type: 'tool.end', id: 'fetch-2', status: 'completed' } },
    // fetch #3 → failed
    { at: 3280, event: { type: 'tool.start', id: 'fetch-3', tool: 'web_fetch', url: 'https://example.invalid/blocked-page' } },
    { at: 3420, event: pageStatus('blocked-page', 'running', { route: 'model' }) },
    { at: 3760, event: pageStatus('blocked-page', 'failed', { route: 'model', detail: 'HTTP 403 Forbidden (simulated)' }) },
    { at: 3880, event: { type: 'tool.end', id: 'fetch-3', status: 'failed' } },
    // fetch #4 → running at the 4 s screenshot mark
    { at: 4060, event: { type: 'tool.start', id: 'fetch-4', tool: 'web_fetch', url: 'https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API' } },
    { at: 4240, event: pageStatus('mdn-canvas', 'running', { route: 'model' }) },
    { at: 4900, event: pageStatus('mdn-canvas', 'completed', { route: 'model', score: 0.79 }) },
    { at: 4980, event: { type: 'tool.end', id: 'fetch-4', status: 'completed' } },
    { at: 5100, event: { type: 'agent.thought', id: 'thought-1', text: '上游许可证为 MIT，截图已完成，可以汇总交付' } },
    { at: 5300, event: pageStatus('raw-renderer', 'completed', { route: 'model', score: 0.95 }) },
    { at: 5480, event: { type: 'session.done', status: 'completed' } },
  ];

  var timers = [];
  function later(ms, fn) {
    timers.push(setTimeout(fn, ms));
  }
  function stopTimers() {
    for (var i = 0; i < timers.length; i += 1) clearTimeout(timers[i]);
    timers.length = 0;
  }

  var running = false;
  function playScenario() {
    if (running) return;
    running = true;
    broadcast({ type: 'reset' });
    broadcast({ type: 'session.start', sessionId: 'demo-session-' + Date.now(), title: 'DSH WEB SPIDER', subtitle: 'web-search / web-fetch activity', modelName: 'deepseek-harness' });
    for (var i = 0; i < SCRIPT.length; i += 1) {
      (function (item) {
        later(item.at + 120, function () {
          broadcast(item.event);
        });
      })(SCRIPT[i]);
    }
    var once = params.get('once') === '1' || params.get('freeze') === '1';
    later(18000, function () {
      running = false;
      if (!once) playScenario();
    });
  }

  /* --------------------------------------------------------- live chrome */
  function pickState() {
    return (sidebarView || panelView || views[0] || { getState: function () { return null; } }).getState();
  }
  function renderHostChrome() {
    var state = pickState();
    if (!state) return;
    var counts = state.statusCounts || {};
    var label = (state.status === 'live' ? 'LIVE' : state.status === 'idle' ? 'IDLE' : 'DONE') +
      ' · ' + state.totalEvents + ' 页 · ' + (counts.running || 0) + ' 进行中 · ' + (counts.failed || 0) + ' 失败';
    var sidebarLive = document.getElementById('sidebar-live');
    var panelLive = document.getElementById('panel-live');
    if (sidebarLive) sidebarLive.textContent = label;
    if (panelLive) panelLive.textContent = label;
    var snapshot = {
      mode: mode,
      status: state.status,
      totalEvents: state.totalEvents,
      statusCounts: state.statusCounts,
      counts: state.counts,
      selectedId: state.selectedId,
      activity: state.activity && state.activity.text,
      pages: state.pages.map(function (page) {
        return { id: page.id, route: page.route, status: page.status, title: page.title };
      }),
      errors: errors,
      views: views.length,
    };
    if (selftestEl) selftestEl.textContent = JSON.stringify(snapshot, null, 2);
    window.__spiderDemo = window.__spiderDemo || {};
    window.__spiderDemo.state = snapshot;
    document.documentElement.setAttribute('data-demo-ready', '1');
  }

  // expose a small debug/testing surface
  window.__spiderDemo = {
    views: views,
    getState: pickState,
    play: function () { stopTimers(); running = false; playScenario(); },
    stop: function () { stopTimers(); running = false; },
    push: broadcast,
    errors: errors,
  };

  playScenario();
  renderHostChrome();
  setInterval(renderHostChrome, 400);

  // At ~4 s (screenshot moment) also freeze the event clock? No: screenshots rely
  // on --virtual-time-budget and land deterministically in the 3.8–4.3 s window.
  // Keep a snapshot from that window for verification.
  later(4000, function () {
    renderHostChrome();
    if (selftestEl) selftestEl.setAttribute('data-snapshot-at', '4000');
  });
})();
