/* ============================================================================
 * spider-scene composition — src/scene-dashboard.js
 *
 * This file is concatenated inside the build wrapper together with the verbatim
 * engine modules (see build/build-scene.mjs). It provides:
 *   - createSpiderScene(container, options): one self-contained Canvas-2D
 *     full-screen "检索大屏" dashboard, no DOM chrome, no CSS, no assets.
 *   - the DSH web-research data adapter (setData / push / getState)
 *   - full lifecycle (ResizeObserver, DPR cap 2, RAF pause when hidden,
 *     IntersectionObserver pause, destroy cleanup) mirroring spider-embed.
 *
 * Canvas drawing reuses engine primitives:
 *   SC.spider.drawSpider                          (app/spider.js)   - the creature
 *   SC.probes.probePose                           (app/probes.js)   - reach arm
 *   SC.layout.livePose / alpha                    (app/live-layout.js) - closed orbit + rgba
 *   SC.motion.cubicPoint                          (app/motion.js)   - flight particles
 * and adapts the drawing recipes of app/renderer.js (#drawHeader, #drawWeb,
 * #drawRouteCards, #drawStream, #drawStats, #drawConfidence, #drawWordGrid,
 * #drawThink, #drawStatus) to web-research data and an arbitrary aspect ratio.
 * Everything else is new; the visual vocabulary (colors, hairline panels,
 * `▪ TITLE`, route colors, mono type) is kept from engine + app/style.css.
 * ========================================================================= */

const SC_MONO = 'Consolas, "Cascadia Code", "Microsoft YaHei", "PingFang SC", monospace';
const SC_ROUTES = ['code', 'model', 'you'];
const SC_STATUS_KEYS = ['pending', 'running', 'completed', 'failed'];
const SC_TAU = Math.PI * 2;

const SC_DEFAULT_THEME = Object.freeze({
  background: '#080909', panel: '#101013', panelTop: '#19191c', border: '#29292e',
  white: '#e8e8e9', text: '#e5e6e7', muted: '#9998a0', dim: '#3a3a41',
  code: '#48d7a6', model: '#e18c78', you: '#f4cf4d', pink: '#f23c83',
});

const SC_STRINGS = Object.freeze({
  zh: {
    title: 'WEB SPIDER',
    fork: '// EVERY PAGE, ONE FORK',
    subtitle: ['每一次检索，都会结成一个分支 · 代码抓取确定的页面，', '模型读取困难的页面，你来决定有风险的。'],
    stats: ['检索', '结果', '来源', '抓取', '失败'],
    stream: '调用流', streamRight: 'web_search · web_fetch',
    streamEmpty: '等待 Agent 上报第一个检索事件',
    streamEmptyHint: '每一次真实检索，都会在这里结成一张网。',
    decision: '决策流', decisionRight: 'tool · query · status · t',
    pageReads: '页面读取', pageReadsRight: 'host · http · kb',
    coverage: '覆盖率', coverageRight: 'fetched / discovered',
    dottrace: 'dottrace', dottraceRight: 'activity / 10s',
    dotgrid: '覆盖率点阵', dotgridRight: 'one dot = one page',
    tools: '工具统计',
    cards: [
      { top: 'web_search', title: '→ 搜索', foot: (m) => `真实：${m.queries} 次检索 · ${m.results} 结果` },
      { top: 'web_fetch', title: '→ 抓取', foot: (m, avg) => `真实：${m.fetches - m.failures} 成功 · ${avg} 平均` },
      { top: 'failed', title: '→ 失败', foot: (m) => `真实：${m.failures} 次失败 · 建议重试` },
    ],
    arrivals: '累计抵达',
    coverageSub: (n) => `共发现 ${n} 个页面`,
    fetched: '已读取', discovered: '已发现',
    rows: { search: '次检索', result: '个结果', fetch: '次抓取', ok: '成功', fail: '失败', page: '页面' },
    toolsFoot: ['工具只读取页面', '判断仍由 Agent 完成'],
    statusWord: { live: 'LIVE', idle: 'IDLE', done: 'DONE' },
    emptyCenter: ['等待 Agent 上报检索事件', '每一次真实检索，都会在这里结成一张网。'],
    noData: '暂无数据',
  },
  en: {
    title: 'WEB SPIDER',
    fork: '// EVERY PAGE, ONE FORK',
    subtitle: ['every search becomes a typed fork · code fetches the sure pages,', 'the model reads the hard ones, you the risky ones.'],
    stats: ['queries', 'results', 'sources', 'fetches', 'fail'],
    stream: 'call stream', streamRight: 'web_search · web_fetch',
    streamEmpty: 'WAITING FOR THE FIRST SEARCH EVENT',
    streamEmptyHint: 'Every real search becomes a thread in this web.',
    decision: 'decision stream', decisionRight: 'tool · query · status · t',
    pageReads: 'page reads', pageReadsRight: 'host · http · kb',
    coverage: 'coverage', coverageRight: 'fetched / discovered',
    dottrace: 'dottrace', dottraceRight: 'activity / 10s',
    dotgrid: 'coverage matrix', dotgridRight: 'one dot = one page',
    tools: 'tools used',
    cards: [
      { top: 'web_search', title: '→ search', foot: (m) => `real: ${m.queries} queries · ${m.results} results` },
      { top: 'web_fetch', title: '→ fetch', foot: (m, avg) => `real: ${m.fetches - m.failures} ok · avg ${avg}` },
      { top: 'failed', title: '→ failed', foot: (m) => `real: ${m.failures} failed · retry later` },
    ],
    arrivals: 'arrivals',
    coverageSub: (n) => `of ${n} pages discovered`,
    fetched: 'fetched', discovered: 'discovered',
    rows: { search: 'searches', result: 'results', fetch: 'fetches', ok: 'ok', fail: 'fail', page: 'pages' },
    toolsFoot: ['tools only fetch pages', 'the agent still decides'],
    statusWord: { live: 'LIVE', idle: 'IDLE', done: 'DONE' },
    emptyCenter: ['WAITING FOR THE FIRST SEARCH EVENT', 'Every real search becomes a thread in this web.'],
    noData: 'no data',
  },
});

/* ------------------------------------------------------------------ utils */
function scClamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}
function scFinite(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
/** Same deterministic 0..1 noise recipe as engine renderer.js#random. */
function scRand(seed) {
  const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453123;
  return value - Math.floor(value);
}
/** Same FNV-1a variant as engine app/model.js#hash / orbit.js#hash. */
function scHash(value) {
  let h = 2166136261;
  const text = String(value);
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function scIsColor(value) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
}
function scHost(url) {
  try {
    return new URL(String(url)).hostname.replace(/^www\./, '');
  } catch (error) {
    const match = /^(?:[a-z]+:\/\/)?([^/?#]+)/i.exec(String(url || ''));
    return match ? match[1].replace(/^www\./, '') : '';
  }
}
function scPad2(value) {
  const n = Math.round(Number(value) || 0);
  return n < 10 ? '0' + n : String(n);
}
function scBytes(value) {
  const n = scFinite(value, -1);
  if (n < 0) return '—';
  if (n < 1024) return Math.round(n) + 'B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + 'KB';
  return (n / (1024 * 1024)).toFixed(2) + 'MB';
}
function scDur(ms) {
  const value = scFinite(ms, -1);
  if (value < 0) return '—';
  if (value < 1000) return Math.round(value) + 'ms';
  return (value / 1000).toFixed(1) + 's';
}
function scStatusOf(item) {
  const value = typeof item.status === 'string' ? item.status.trim().toLowerCase() : '';
  return SC_STATUS_KEYS.indexOf(value) >= 0 ? value : 'pending';
}
function scRouteOf(route) {
  const value = typeof route === 'string' ? route.trim().toLowerCase() : '';
  return SC_ROUTES.indexOf(value) >= 0 ? value : 'model';
}
/** Plain ASCII-ish status words are more legible at 9px than glyph fonts. */
const SC_STATUS_WORD = Object.freeze({ pending: 'wait', running: 'run', completed: 'ok', failed: 'fail' });

/* ------------------------------------------------------------- data model */
function scNormalizeOptions(input) {
  const src = input && typeof input === 'object' ? input : {};
  const theme = Object.assign({}, SC_DEFAULT_THEME);
  if (src.theme && typeof src.theme === 'object') {
    for (const key of Object.keys(SC_DEFAULT_THEME)) {
      if (scIsColor(src.theme[key])) theme[key] = src.theme[key];
    }
  }
  return {
    locale: src.locale === 'en' ? 'en' : 'zh',
    theme,
    maxPages: Math.round(scClamp(scFinite(src.maxPages, 240), 8, 2000)),
    reducedMotion: Boolean(src.reducedMotion),
    width: scFinite(src.width, 0),
    height: scFinite(src.height, 0),
    pixelRatio: scFinite(src.pixelRatio, 0),
    animationTime: scFinite(src.animationTime, 0),
    title: typeof src.title === 'string' && src.title.trim() ? src.title.trim().slice(0, 40) : '',
    onFrame: typeof src.onFrame === 'function' ? src.onFrame : null,
  };
}

function scNormalizeModel(input, options) {
  const src = input && typeof input === 'object' ? input : {};
  const wallNow = Date.now();
  const now = scFinite(src.now, wallNow);
  const startedAt = scFinite(src.startedAt, 0) || now;
  const status = src.status === 'live' || src.status === 'done' ? src.status : 'idle';
  const calls = [];
  const callIds = new Set();
  const rawCalls = Array.isArray(src.calls) ? src.calls : [];
  for (let i = 0; i < rawCalls.length && calls.length < 400; i++) {
    const item = rawCalls[i];
    if (!item || typeof item !== 'object') continue;
    const id = String(item.id != null ? item.id : 'call-' + i);
    if (callIds.has(id)) continue;
    callIds.add(id);
    const queries = Array.isArray(item.queries)
      ? item.queries.filter((q) => typeof q === 'string' && q.trim()).map((q) => q.trim().slice(0, 160)).slice(0, 8)
      : [];
    const url = typeof item.url === 'string' ? item.url.trim() : '';
    const rawTool = String(item.tool || '').toLowerCase();
    calls.push({
      id,
      tool: rawTool.indexOf('fetch') >= 0 ? 'web_fetch' : 'web_search',
      label: String(item.label || (queries[0] || '') || url || id).slice(0, 220),
      queries,
      url,
      status: scStatusOf(item),
      startedAt: scFinite(item.startedAt, startedAt),
      endedAt: scFinite(item.endedAt, -1),
      resultCount: Math.max(0, Math.round(scFinite(item.resultCount, 0))),
      httpStatus: scFinite(item.httpStatus, -1),
      bytes: scFinite(item.bytes, -1),
      excerpt: typeof item.excerpt === 'string' ? item.excerpt.trim().slice(0, 700) : '',
      resultTitles: Array.isArray(item.resultTitles)
        ? item.resultTitles.filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim().slice(0, 140)).slice(0, 5)
        : [],
    });
  }
  const pages = [];
  const pageIds = new Set();
  const rawPages = Array.isArray(src.pages) ? src.pages : [];
  for (let i = 0; i < rawPages.length && pages.length < 2000; i++) {
    const item = rawPages[i];
    if (!item || typeof item !== 'object') continue;
    const url = typeof item.url === 'string' ? item.url.trim() : '';
    const id = String(item.id != null ? item.id : url || 'page-' + i);
    if (pageIds.has(id)) continue;
    pageIds.add(id);
    const host = scHost(url);
    const title = typeof item.title === 'string' && item.title.trim() ? item.title.trim().slice(0, 160) : (host || url);
    pages.push({
      id,
      url,
      host,
      title,
      route: scRouteOf(item.route),
      status: scStatusOf(item),
      detail: typeof item.detail === 'string' ? item.detail.slice(0, 240) : '',
      excerpt: typeof item.excerpt === 'string' ? item.excerpt.trim().slice(0, 700) : '',
      firstAt: scFinite(item.firstAt, startedAt),
      updatedAt: scFinite(item.updatedAt, scFinite(item.firstAt, startedAt)),
    });
  }
  const activities = [];
  const rawActivities = Array.isArray(src.activities) ? src.activities : [];
  for (let i = 0; i < rawActivities.length && activities.length < 2000; i++) {
    const item = rawActivities[i];
    if (!item || typeof item !== 'object') continue;
    const kind = String(item.kind || '').toLowerCase();
    activities.push({
      at: scFinite(item.at, now),
      kind: ['search', 'fetch', 'result', 'fail', 'start', 'end'].indexOf(kind) >= 0 ? kind : 'search',
      label: String(item.label == null ? '' : item.label).slice(0, 220),
      route: SC_ROUTES.indexOf(String(item.route || '').toLowerCase()) >= 0 ? String(item.route).toLowerCase() : '',
    });
  }
  activities.sort((a, b) => a.at - b.at);

  // Derived metrics (explicit model.metrics wins when finite).
  const given = src.metrics && typeof src.metrics === 'object' ? src.metrics : {};
  const derived = { queries: 0, results: 0, sources: 0, fetches: 0, failures: 0, events: activities.length };
  const sources = new Set();
  for (const call of calls) {
    if (call.tool === 'web_search') {
      derived.queries += Math.max(1, call.queries.length);
      derived.results += call.resultCount;
    } else {
      derived.fetches += 1;
      if (call.status === 'failed') derived.failures += 1;
    }
  }
  for (const page of pages) {
    if (page.host) sources.add(page.host);
    if (page.status === 'failed') {
      derived.failures = Math.max(derived.failures, 0);
    }
  }
  derived.sources = sources.size;
  const metrics = {};
  for (const key of Object.keys(derived)) {
    const value = scFinite(given[key], -1);
    metrics[key] = value >= 0 ? Math.round(value) : derived[key];
  }
  const pageTotal = pages.length;
  const pagesCapped = pageTotal > options.maxPages ? pages.slice(pageTotal - options.maxPages) : pages;
  return {
    status,
    sessionId: typeof src.sessionId === 'string' ? src.sessionId.slice(0, 80) : '',
    startedAt,
    now,
    metrics,
    calls,
    pages,
    pageTotal,
    renderPages: pagesCapped,
    activities,
    elapsed: Math.max(0, (now - startedAt) / 1000),
  };
}

/* ================================================================== scene */
function createSpiderScene(container, options) {
  if (!container || typeof container.appendChild !== 'function') {
    throw new TypeError('createSpiderScene(container, options): container must be a DOM element.');
  }
  const opts = scNormalizeOptions(options);
  const theme = opts.theme;
  const strings = SC_STRINGS[opts.locale];
  const doc = container.ownerDocument || (typeof document !== 'undefined' ? document : null);
  const win = (doc && doc.defaultView) || (typeof window !== 'undefined' ? window : globalThis);
  if (!doc || typeof doc.createElement !== 'function') {
    throw new TypeError('createSpiderScene: no document available to create <canvas>.');
  }

  const canvas = doc.createElement('canvas');
  if (canvas.setAttribute) {
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('data-spider-scene', '');
  }
  if (canvas.style) {
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.background = theme.background;
  }
  container.appendChild(canvas);
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('createSpiderScene: 2d context unavailable.');
  if (typeof ctx.roundRect !== 'function') {
    // Tiny fallback for older Chromium; engine app/spider.js uses roundRect.
    ctx.roundRect = function roundRect(x, y, w, h, r) {
      const radius = Math.min(scFinite(r, 0), Math.abs(w) / 2, Math.abs(h) / 2);
      this.moveTo(x + radius, y);
      this.arcTo(x + w, y, x + w, y + h, radius);
      this.arcTo(x + w, y + h, x, y + h, radius);
      this.arcTo(x, y + h, x, y, radius);
      this.arcTo(x, y, x + w, y, radius);
      this.closePath();
    };
  }

  const state = {
    destroyed: false,
    cssW: 0,
    cssH: 0,
    dpr: 1,
    animTime: Math.max(0, opts.animationTime),
    lastFrame: 0,
    raf: 0,
    visible: true,
    dirty: true,
    regions: [],
    layout: null,
    pulses: { search: -99, fetch: -99, fail: -99, page: -99, result: -99 },
    model: scNormalizeModel(null, opts),
    warned: {},
  };
  const themeRef = theme;

  function warn(key, message) {
    if (state.warned[key]) return;
    state.warned[key] = true;
    if (typeof console !== 'undefined' && console.warn) console.warn('[spider-scene] ' + message);
  }

  /* ------------------------------------------------------------- drawing */
  function font(size, weight) {
    ctx.font = (weight || 400) + ' ' + size + 'px ' + SC_MONO;
  }
  function text(value, x, y, color, size, weight, align) {
    font(size, weight);
    ctx.fillStyle = color || themeRef.white;
    ctx.textAlign = align || 'left';
    ctx.fillText(String(value), x, y);
    ctx.textAlign = 'left';
  }
  function fit(value, x, y, maxWidth, color, size, weight, align) {
    font(size, weight);
    let label = String(value == null ? '' : value);
    if (ctx.measureText(label).width > maxWidth) {
      while (label.length > 1 && ctx.measureText(label + '…').width > maxWidth) label = label.slice(0, -1);
      label += '…';
    }
    ctx.fillStyle = color || themeRef.white;
    ctx.textAlign = align || 'left';
    ctx.fillText(label, x, y);
    ctx.textAlign = 'left';
    return label;
  }
  function line(x1, y1, x2, y2, color, width) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = color;
    ctx.lineWidth = scFinite(width, 1);
    ctx.stroke();
  }
  function rect(x, y, w, h, color) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
  }
  function frameRect(x, y, w, h, color, width) {
    ctx.strokeStyle = color;
    ctx.lineWidth = scFinite(width, 1);
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  }
  function chip(label, x, y, size, fill, textColor) {
    font(size, 700);
    const w = ctx.measureText(String(label)).width + 8;
    const h = size + 4;
    rect(x, y - h + 2.5, w, h, fill);
    text(label, x + 4, y, textColor, size, 700);
    return w;
  }
  function statusColor(status) {
    if (status === 'failed') return themeRef.pink;
    if (status === 'running') return themeRef.you;
    if (status === 'completed') return themeRef.code;
    return themeRef.muted;
  }
  /** Right-aligned translucent tag (engine alpha() helper reused). */
  function tagRight(label, rightX, y, size, color) {
    font(size, 700);
    const value = String(label);
    const w = ctx.measureText(value).width + 7;
    const h = size + 4;
    rect(rightX - w, y - h + 2.5, w, h, SC.layout.alpha(color, 0.16));
    text(value, rightX - w + 3.5, y, color, size, 700);
    return w;
  }
  function routeColor(route) {
    return themeRef[route] || themeRef.muted;
  }
  function pageColor(page) {
    if (page.status === 'failed') return themeRef.pink;
    if (page.status === 'running') return themeRef.model;
    if (page.status === 'pending') return '#55505a';
    if (page.status === 'completed') return routeColor(page.route);
    return routeColor(page.route);
  }
  function panelStrip(rectInfo) {
    return Math.round(scClamp(rectInfo.h * 0.115, 17, 24));
  }
  function drawPanel(p, title, right) {
    rect(p.x, p.y, p.w, p.h, themeRef.panel);
    frameRect(p.x, p.y, p.w, p.h, themeRef.border, 1);
    const strip = panelStrip(p);
    rect(p.x + 1, p.y + 1, p.w - 2, strip - 1, themeRef.panelTop);
    text('▪ ' + title, p.x + 8, p.y + strip * 0.7, themeRef.muted, fs(9.6));
    if (right) text(right, p.x + p.w - 8, p.y + strip * 0.7, themeRef.dim, fs(8.8), 400, 'right');
    return { x: p.x, y: p.y + strip, w: p.w, h: p.h - strip, strip };
  }
  function clipInner(inner) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(inner.x + 1, inner.y, inner.w - 2, inner.h - 3);
    ctx.clip();
  }

  function fs(base) {
    const S = state.layout ? state.layout.S : 1;
    return Math.max(7.5, Math.round(base * S * 10) / 10);
  }

  /* -------------------------------------------------------------- layout */
  function computeLayout(W, H) {
    const S = scClamp(Math.min(W, H) / 800, 0.8, 1.2);
    const gutter = Math.round(scClamp(Math.min(W, H) * 0.016, 8, 16));
    const headerH = Math.round(scClamp(H * 0.072, 40, 64));
    const footerH = Math.round(scClamp(H * 0.026, 18, 26));
    const gap = Math.round(scClamp(Math.min(W, H) * 0.016, 8, 14));
    const portrait = H > W * 1.06;
    const contentTop = headerH;
    const contentBottom = H - footerH;
    const contentH = Math.max(120, contentBottom - contentTop);
    const bottomH = Math.round(scClamp(contentH * (portrait ? 0.44 : 0.35), 150, portrait ? 540 : 400));
    const bottomTop = contentBottom - bottomH;
    const topH = Math.max(120, bottomTop - gap - contentTop);
    const fullW = W - gutter * 2;
    const rightW = Math.round(fullW * (portrait ? 0.165 : 0.147));
    const leftW = Math.round(fullW * (portrait ? 0.30 : 0.305));
    const left = { x: gutter, y: contentTop, w: leftW, h: topH };
    const right = { x: W - gutter - rightW, y: contentTop, w: rightW, h: topH };
    const center = { x: left.x + leftW + gap, y: contentTop, w: Math.max(80, right.x - gap - (left.x + leftW + gap)), h: topH };
    const rowA = { x: gutter, y: bottomTop, w: fullW, h: Math.round((bottomH - gap) * 0.45) };
    const rowB = { x: gutter, y: rowA.y + rowA.h + gap, w: fullW, h: Math.max(60, bottomH - rowA.h - gap) };
    const decisionW = Math.round(fullW * (portrait ? 0.60 : 0.64));
    const panelsA = {
      decision: { x: gutter, y: rowA.y, w: decisionW, h: rowA.h },
      coverage: { x: gutter + decisionW + gap, y: rowA.y, w: fullW - decisionW - gap, h: rowA.h },
    };
    const panelsB = [];
    if (portrait) {
      const cellW = (fullW - gap) / 2;
      const cellH = (rowB.h - gap) / 2;
      for (let i = 0; i < 4; i++) {
        panelsB.push({
          x: Math.round(gutter + (i % 2) * (cellW + gap)),
          y: Math.round(rowB.y + Math.floor(i / 2) * (cellH + gap)),
          w: Math.round(cellW),
          h: Math.round(cellH),
        });
      }
    } else {
      const cellW = (fullW - gap * 3) / 4;
      for (let i = 0; i < 4; i++) {
        panelsB.push({ x: Math.round(gutter + i * (cellW + gap)), y: rowB.y, w: Math.round(cellW), h: rowB.h });
      }
    }
    return { W, H, S, gutter, headerH, footerH, gap, top: contentTop, contentBottom, left, center, right, rowA, rowB, panelsA, panelsB };
  }

  /* ------------------------------------------------------------- header */
  function drawHeader(L) {
    const m = state.model;
    const titleSize = fs(20);
    font(titleSize, 700);
    const titleW = ctx.measureText(strings.title).width;
    text(strings.title, L.gutter, Math.round(L.headerH * 0.5), '#f4f4f4', titleSize, 700);
    text(strings.fork, L.gutter + titleW + Math.round(14 * L.S), Math.round(L.headerH * 0.5), themeRef.pink, titleSize, 700);
    text(strings.subtitle[0], L.gutter, Math.round(L.headerH * 0.76), '#79797f', fs(9.6));
    if (L.headerH >= 56) text(strings.subtitle[1], L.gutter, Math.round(L.headerH * 0.94), '#79797f', fs(9.6));

    const spacing = Math.round(scClamp(L.W * 0.062, 52, 94));
    const counts = progressiveCounts();
    const values = [
      [counts.queries, themeRef.white],
      [counts.results, themeRef.code],
      [counts.sources, themeRef.model],
      [counts.fetches, themeRef.you],
      [counts.failures, themeRef.pink],
    ];
    const labelY = Math.round(L.headerH * 0.28);
    const valueY = Math.round(L.headerH * 0.74);
    values.forEach(([value, color], i) => {
      const x = L.W - L.gutter - (4 - i) * spacing;
      text(strings.stats[i], x, labelY, '#79777e', fs(8.4), 400, 'right');
      text(value, x, valueY, color, fs(19), 700, 'right');
    });
    rect(0, L.headerH - 0.5, L.W, 0.5, 'rgba(41,41,46,.55)');
  }

  /* ------------------------------------------------------- left: stream */
  /** Greedy monospace wrapper: returns at most maxLines strings, last one ellipsized. */
  function wrapText(value, maxWidth, size, weight, maxLines) {
    font(size, weight);
    let rest = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    const out = [];
    while (rest && out.length < maxLines) {
      if (ctx.measureText(rest).width <= maxWidth) {
        out.push(rest);
        rest = '';
        break;
      }
      let low = 1;
      let high = rest.length;
      while (low < high) {
        const mid = (low + high + 1) >> 1;
        if (ctx.measureText(rest.slice(0, mid)).width <= maxWidth) low = mid;
        else high = mid - 1;
      }
      let cut = rest.slice(0, low);
      const space = cut.lastIndexOf(' ');
      if (space > 8) cut = cut.slice(0, space);
      out.push(cut.trimEnd());
      rest = rest.slice(cut.length).trimStart();
    }
    if (rest && out.length) {
      let last = out[out.length - 1];
      while (last.length > 2 && ctx.measureText(last + '…').width > maxWidth) last = last.slice(0, -1);
      out[out.length - 1] = last + '…';
    }
    return out;
  }

  function pageExcerptFor(call) {
    const host = scHost(call.url);
    if (!host) return '';
    const pages = state.model.pages;
    for (let i = pages.length - 1; i >= 0; i--) {
      if (pages[i].host === host && pages[i].excerpt) return pages[i].excerpt;
    }
    return '';
  }

  /* ---------------------------------------------- boxed-token primitives */
  /** Split data text on whitespace + punctuation runs (`- : / | quotes …`). */
  function tokenizeData(text) {
    const value = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
    const tokens = [];
    if (!value) return tokens;
    let last = 0;
    let match;
    const re = /([^\p{L}\p{N}_]+)/gu;
    while ((match = re.exec(value))) {
      if (match.index > last) tokens.push(value.slice(last, match.index));
      tokens.push(match[1]);
      last = match.index + match[1].length;
    }
    if (last < value.length) tokens.push(value.slice(last));
    return tokens.filter((token) => token.trim());
  }
  function isPunctToken(token) {
    return /^[^\p{L}\p{N}_]+$/u.test(token);
  }
  /** URL → boxed host + plain `/` separators + boxed path words (reference recipe). */
  function tokenizeUrl(url) {
    const raw = String(url || '').replace(/^https?:\/\//i, '');
    const slash = raw.indexOf('/');
    const host = slash >= 0 ? raw.slice(0, slash) : raw;
    const tokens = [];
    if (host) tokens.push(host);
    if (slash >= 0) {
      const parts = raw.slice(slash).split('/');
      for (let i = 0; i < parts.length; i++) {
        if (i > 0) tokens.push('/');
        if (!parts[i]) continue;
        for (const token of tokenizeData(parts[i])) tokens.push(token);
      }
    }
    return tokens;
  }
  /** Group excerpt words into 2–3-word muted boxes. */
  function groupWords(text, groupSize, maxGroups) {
    const words = String(text == null ? '' : text).replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    const groups = [];
    for (let i = 0; i < words.length && groups.length < maxGroups; i += groupSize) {
      groups.push(words.slice(i, i + groupSize).join(' '));
    }
    return groups;
  }
  /** Reference word-box style: 1px route border (~55%), route tint (~12%), radius 2.5. */
  function tokenTheme(kind, size) {
    const base = { size, gap: 3, radius: 2.5, padX: 3, borderAlpha: 0.55, fillAlpha: 0.12 };
    if (kind === 'search') return Object.assign(base, { border: themeRef.code, fill: themeRef.code, text: '#e9f7f1' });
    if (kind === 'fetch') return Object.assign(base, { border: themeRef.model, fill: themeRef.model, text: '#f6ece8' });
    if (kind === 'fail') return Object.assign(base, { border: themeRef.pink, fill: themeRef.pink, text: '#fbe7ef', borderAlpha: 0.62, fillAlpha: 0.14 });
    if (kind === 'title') return Object.assign(base, { border: themeRef.code, fill: themeRef.code, text: '#9fc9bb', borderAlpha: 0.32, fillAlpha: 0.055 });
    return Object.assign(base, { border: themeRef.white, fill: themeRef.white, text: '#8d8a93', borderAlpha: 0.14, fillAlpha: 0.03 });
  }
  /** Plain-text colour used before a tentacle touches the token (no box yet). */
  function tokenPlainColor(style) {
    return style.text;
  }
  function scSmooth(value) {
    return value * value * (3 - 2 * value);
  }
  /** Inverse of scSmooth on [0,1] (engine-style smoothstep). */
  function inverseSmooth(value) {
    const v = scClamp(value, 0, 1);
    return 0.5 - Math.sin(Math.asin(1 - 2 * v) / 3);
  }
  /**
   * Deterministic tentacle scan pulse for the Nth row above the body:
   * 0 = retracted (row plain), 1 = full contact (row fully boxed).
   * Pure function of time + rank, so a single headless paint is reproducible.
   */
  function scanExtension(rank, now) {
    const phase = (now / 2.8 + rank * 0.37) % 1;
    if (phase < 0.34) return scSmooth(phase / 0.34);
    if (phase < 0.66) return 1;
    return 1 - scSmooth((phase - 0.66) / 0.34);
  }

  /* --------------------- infinite label loop + cumulative arrival counters */
  // Each page label travels its strand inner→outer and loops forever; one wrap =
  // one arrival event. Arrivals have a closed form per page:
  //   wraps_i(now) = floor((now - START) / period_i + phase_i)
  // so a snapshot at any animationTime is deterministic and the counters are
  // strictly increasing over time (they never stop at the real totals).
  const LOOP_START = 0.35; // seconds before the label timeline starts
  let loopPlanCache = { key: '', plan: null };
  function buildLoopPlan() {
    const m = state.model;
    const key = m.calls.length + '|' + m.pages.length + '|' + (m.pages.length ? m.pages[m.pages.length - 1].id : '');
    if (loopPlanCache.key === key && loopPlanCache.plan) return loopPlanCache.plan;
    const fetchByUrl = new Map();
    const fetchByHost = new Map();
    const searchCalls = [];
    for (const call of m.calls) {
      if (call.tool === 'web_fetch') {
        const url = String(call.url || '').trim();
        if (url && !fetchByUrl.has(url)) fetchByUrl.set(url, call);
        const host = scHost(call.url);
        if (host && !fetchByHost.has(host)) fetchByHost.set(host, call);
      } else {
        searchCalls.push(call);
      }
    }
    const ordered = m.pages
      .map((page, index) => ({ page, index }))
      .sort((a, b) => (a.page.firstAt - b.page.firstAt) || (a.index - b.index));
    const seenHosts = new Set();
    let searchCursor = 0;
    const pages = ordered.map((entry, seq) => {
      const page = entry.page;
      const fetchCall = fetchByUrl.get(String(page.url || '').trim()) || fetchByHost.get(page.host) || null;
      let searchCall = null;
      if (!fetchCall && searchCalls.length) {
        searchCall = searchCalls[searchCursor % searchCalls.length];
        searchCursor += 1;
      }
      const firstHost = Boolean(page.host) && !seenHosts.has(page.host);
      if (page.host) seenHosts.add(page.host);
      return {
        page,
        index: entry.index,
        seq,
        period: 2.4 + ((entry.index * 0.37) % 1.2), // 2.4–3.6 s per loop
        phase: (entry.index * 0.6180339887498949) % 1, // golden-ratio spread
        fetchCall,
        searchCall,
        failed: page.status === 'failed',
        firstHost,
      };
    });
    const plan = { pages };
    loopPlanCache = { key, plan };
    return plan;
  }
  /** Position of a label packet along its strand (0 = inner end, 1 = arc end). */
  function loopU(entry, now, slot) {
    const raw = (now - LOOP_START) / entry.period + entry.phase + slot * 0.5;
    return raw - Math.floor(raw);
  }
  /** Completed wraps so far (primary packet only; duplicate packets do not count). */
  function loopWraps(entry, now) {
    return Math.max(0, Math.floor((now - LOOP_START) / entry.period + entry.phase));
  }
  let arrivalCache = { key: '', counts: null };
  /** Cumulative arrival counters: monotonic, never capped/stopped. */
  function progressiveCounts() {
    const plan = buildLoopPlan();
    const now = state.reducedMotion ? 8 : state.animTime;
    const key = now.toFixed(3) + '|' + plan.pages.length;
    if (arrivalCache.key === key && arrivalCache.counts) return arrivalCache.counts;
    let queries = 0;
    let results = 0;
    let sources = 0;
    let fetches = 0;
    let failures = 0;
    for (const entry of plan.pages) {
      const wraps = loopWraps(entry, now);
      if (!wraps) continue;
      results += wraps; // every delivered label counts as one result
      if (entry.searchCall) queries += wraps; // search-derived label arrival
      if (entry.fetchCall) fetches += wraps; // fetched-page label arrival
      if (entry.failed) failures += wraps; // failed-page label arrival
      if (entry.firstHost) sources += wraps; // first page of its host arrives
    }
    const counts = { queries, results, sources, fetches, failures, cumulative: true };
    arrivalCache = { key, counts };
    return counts;
  }
  function tokenAdvance(token, style) {
    font(style.size, 400);
    const plain = isPunctToken(token);
    const width = Math.round(ctx.measureText(token).width + (plain ? 0 : style.padX * 2));
    return { width, advance: width + style.gap, plain };
  }
  function measureTokenFlow(tokens, startX, rightFirst, right, style, maxLines) {
    let x = startX;
    let lines = 1;
    for (const token of tokens) {
      if (!token) continue;
      const metro = tokenAdvance(token, style);
      const limit = lines === 1 ? rightFirst : right;
      if (x + metro.width > limit && x > startX + 1) {
        lines += 1;
        if (lines > maxLines) break;
        x = startX;
      }
      x += metro.advance;
    }
    return lines;
  }
  /**
   * Draw a token flow. `contacts` = [{x, alpha}] are probe-tip contact points on
   * this row's first line: only the token whose span contains a tip is boxed
   * (smooth proximity falloff, so an immediately adjacent token can catch a faint
   * edge). Every other token stays plain — there is no row-wide boxing.
   */
  function drawTokenFlow(tokens, startX, baselineY, rightFirst, right, style, maxLines, lineH, contacts) {
    const points = contacts && contacts.length ? contacts : null;
    let x = startX;
    let baseline = baselineY;
    let lines = 1;
    for (const token of tokens) {
      if (!token) continue;
      const metro = tokenAdvance(token, style);
      const limit = lines === 1 ? rightFirst : right;
      if (x + metro.width > limit && x > startX + 1) {
        lines += 1;
        if (lines > maxLines) {
          text('…', x + 1, baseline, style.text, style.size);
          break;
        }
        x = startX;
        baseline += lineH;
      }
      let boxAlpha = 0;
      if (!metro.plain && points && lines === 1) {
        const center = x + metro.width * 0.5;
        for (const point of points) {
          const distance = Math.abs(center - point.x);
          const falloff = scClamp(1 - (distance - metro.width * 0.5) / 14, 0, 1);
          const value = falloff * point.alpha;
          if (value > boxAlpha) boxAlpha = value;
        }
      }
      if (metro.plain) {
        text(token, x, baseline, '#6f6c75', style.size);
      } else if (boxAlpha <= 0.03) {
        // Untouched token: plain monospace text, no border/fill (same advance).
        text(token, x + style.padX, baseline, tokenPlainColor(style), style.size);
      } else {
        // BOLD contact box: thicker border at high route alpha, stronger tint,
        // near-white text and a soft same-colour glow so the touched token is
        // unmistakable at 1280×800 and 1148×962.
        const boxTop = Math.round(baseline - style.size * 0.85 - 1.5);
        const boxH = style.size + 4;
        ctx.save();
        ctx.shadowColor = SC.layout.alpha(style.border, 0.55 * boxAlpha);
        ctx.shadowBlur = 3.2 * boxAlpha;
        ctx.beginPath();
        ctx.roundRect(x, boxTop, metro.width, boxH, style.radius);
        ctx.fillStyle = SC.layout.alpha(style.fill, 0.28 * boxAlpha);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = SC.layout.alpha(style.border, 0.92 * boxAlpha);
        ctx.lineWidth = 1.4;
        ctx.stroke();
        ctx.restore();
        text(token, x + style.padX, baseline, '#ffffff', style.size);
      }
      x += metro.advance;
    }
    return lines;
  }

  /* ------------------------------------ crawling path inside the anchor band */
  // The creature visibly crawls: stronger horizontal wander (±7.5% panel width,
  // 3.4 s cycle) + gentle vertical wander (±2% height, 4.2 s cycle) inside the
  // lower anchor band. Shared by the body AND the body-token contact so the
  // boxed token always sits under the feet. Pure function of animationTime.
  const CRAWL_X_AMP = 0.09;
  const CRAWL_X_PERIOD = 2.5;
  const CRAWL_Y_AMP = 0.03;
  const CRAWL_Y_PERIOD = 2.2;
  function crawlClock(now) {
    return state.reducedMotion ? 3.1 : now;
  }
  function streamBodyX(inner, now) {
    const t = crawlClock(now);
    return inner.x + inner.w * (0.5 + CRAWL_X_AMP * Math.sin((t / CRAWL_X_PERIOD) * SC_TAU));
  }
  function streamBodyY(inner, anchorY, now) {
    const t = crawlClock(now);
    const wander = inner.h * CRAWL_Y_AMP * Math.sin((t / CRAWL_Y_PERIOD) * SC_TAU + 0.8);
    const bob = state.reducedMotion ? 0 : Math.sin(t * 3.1) * 1.6;
    return scClamp(anchorY + wander + bob, inner.y + inner.h * 0.52, inner.y + inner.h * 0.84);
  }
  function streamBodyVelocity(inner, now) {
    const t = crawlClock(now);
    return {
      vx: inner.w * CRAWL_X_AMP * (SC_TAU / CRAWL_X_PERIOD) * Math.cos((t / CRAWL_X_PERIOD) * SC_TAU),
      vy: inner.h * CRAWL_Y_AMP * (SC_TAU / CRAWL_Y_PERIOD) * Math.cos((t / CRAWL_Y_PERIOD) * SC_TAU + 0.8),
    };
  }

  /* ------------------------------------------------------- left: stream */
  /**
   * The left panel is the data the creature crawls over (engine's
   * `studio.prompt` statement stream), rendered as inline BOXED TOKENS like
   * the reference: route-tinted rounded boxes, only under the tentacle tips.
   * The spider crawls along the lower anchor band while rows slide past.
   */
  function drawStreamPanel(L) {
    const m = state.model;
    const p = L.left;
    const strip = panelStrip(p);
    rect(p.x, p.y, p.w, p.h, themeRef.panel);
    rect(p.x + 1, p.y + 1, p.w - 2, strip - 1, themeRef.panelTop);
    frameRect(p.x, p.y, p.w, p.h, themeRef.border, 1);
    ['#ff685e', '#ffc54c', '#43c982'].forEach((color, i) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(p.x + 13 + i * 13, p.y + strip * 0.5, Math.max(3, 4 * L.S), 0, SC_TAU);
      ctx.fill();
    });
    text('calls.stream', p.x + Math.round(58 * L.S), p.y + strip * 0.7, '#ededed', fs(10.5));
    text('ln ' + Math.max(1, m.calls.length), p.x + p.w - 8, p.y + strip * 0.7, themeRef.dim, fs(8.8), 400, 'right');
    const inner = { x: p.x, y: p.y + strip, w: p.w, h: p.h - strip };
    clipInner(inner);

    const lineH = Math.round(Math.max(11, fs(15.2)));
    const numberX = p.x + 8;
    const tokenX = p.x + 23;
    const subIndent = p.x + 29;
    const textRight = p.x + p.w - 9;
    const numFont = fs(8.4);
    const tokenSize = scClamp(inner.w * 0.030, 8.6, 9.8);
    const titleSize = scClamp(tokenSize * 0.9, 7.6, 8.8);
    const excerptSize = scClamp(tokenSize * 0.86, 7.2, 8.6);
    const mutedSize = fs(8.8);
    const capacity = Math.max(3, Math.floor((inner.h - 10) / lineH));
    const excerptGroup = inner.w > 330 ? 3 : 2;
    const calls = m.calls.slice(-40);
    const blocks = [];
    for (let i = 0; i < calls.length; i++) {
      const call = calls[i];
      const isSearch = call.tool === 'web_search';
      const failed = call.status === 'failed';
      const styleKind = failed ? 'fail' : isSearch ? 'search' : 'fetch';
      const primaryStyle = tokenTheme(styleKind, tokenSize);
      const tagLabel = isSearch
        ? (call.status === 'running' ? 'run' : String(call.resultCount))
        : (call.httpStatus > 0 ? String(call.httpStatus) : SC_STATUS_WORD[call.status]);
      font(fs(8.2), 700);
      const tagW = ctx.measureText(tagLabel).width + 7;
      const items = [];
      const tokens = isSearch ? tokenizeData(call.label) : tokenizeUrl(call.url || call.label);
      items.push({ type: 'tokens', tokens, style: primaryStyle, maxLines: 3, firstRight: textRight - tagW - 8 });
      if (isSearch) {
        items.push({
          type: 'plain',
          text: `${call.resultCount} ${strings.rows.result} · ${scDur(call.endedAt - call.startedAt)}`,
          color: '#8d8a93',
          size: mutedSize,
          x: subIndent,
        });
        const titles = Array.isArray(call.resultTitles) ? call.resultTitles.slice(0, 3) : [];
        if (titles.length) {
          const titleStyle = tokenTheme('title', titleSize);
          const titleTokens = [];
          titles.forEach((title, index) => {
            if (index) titleTokens.push('·');
            for (const group of groupWords(title, inner.w > 300 ? 4 : 3, 3)) titleTokens.push(group);
          });
          items.push({ type: 'mixed', prefix: '', tokens: titleTokens, style: titleStyle, maxLines: 2, x: subIndent });
        }
      } else {
        items.push({
          type: 'plain',
          text: `${SC_STATUS_WORD[call.status]} · HTTP ${call.httpStatus > 0 ? call.httpStatus : '—'} · ${scBytes(call.bytes)} · ${scDur(call.endedAt - call.startedAt)}`,
          color: statusColor(call.status),
          size: mutedSize,
          x: subIndent,
        });
        const excerpt = (call.excerpt || pageExcerptFor(call) || '').trim();
        if (excerpt && capacity > 12) {
          items.push({ type: 'excerpt', tokens: groupWords(excerpt, excerptGroup, 14), maxLines: 2, x: subIndent + 9 });
        }
      }
      let lines = 0;
      for (const item of items) {
        if (item.type === 'tokens') {
          item.lines = measureTokenFlow(item.tokens, tokenX, item.firstRight, textRight, item.style, item.maxLines);
        } else if (item.type === 'mixed') {
          font(item.style.size, 400);
          item.prefixW = ctx.measureText(item.prefix).width;
          item.lines = measureTokenFlow(item.tokens, item.x + item.prefixW, textRight, textRight, item.style, item.maxLines);
        } else if (item.type === 'excerpt') {
          item.style = tokenTheme('excerpt', excerptSize);
          item.lines = measureTokenFlow(item.tokens, item.x, textRight, textRight, item.style, item.maxLines);
        } else {
          item.lines = 1;
        }
        lines += item.lines;
      }
      blocks.push({ items, lines, call, number: m.calls.length - calls.length + i + 1, live: call.status === 'running', tagLabel });
    }

    const rows = [];
    if (!blocks.length) {
      text(strings.streamEmpty, p.x + 12, inner.y + lineH * 1.6, themeRef.muted, fs(10));
      if (inner.h > lineH * 5) text(strings.streamEmptyHint, p.x + 12, inner.y + lineH * 2.5, themeRef.dim, fs(9));
    } else {
      // ---- slow upward auto-scroll of the whole statement strip -------------
      // Newest contiguous slice whose height covers the viewport, drawn twice
      // (modulo offset) so rows leaving the top re-enter from the bottom.
      const scanNow = state.reducedMotion ? 4.2 : state.animTime;
      let sliceStart = blocks.length - 1;
      let baseH = blocks[sliceStart].lines * lineH;
      for (let i = blocks.length - 2; i >= 0 && baseH < inner.h + lineH * 6; i--) {
        baseH += blocks[i].lines * lineH;
        sliceStart = i;
      }
      const scrollSpeed = scClamp(inner.h * 0.032, 9, 18); // ~14 px/s at 1280x800
      // ALWAYS scroll: tile the newest slice until the loop distance covers the
      // viewport + 2 rows, so short streams keep moving (repeating rows is fine).
      const minLoop = inner.h + lineH * 2;
      const baseStrip = blocks.slice(sliceStart);
      const repeats = Math.max(1, Math.ceil(minLoop / Math.max(1, baseH)));
      const strip = [];
      for (let r = 0; r < repeats; r++) for (const block of baseStrip) strip.push(block);
      const contentH = baseH * repeats;
      const offset = state.reducedMotion ? 0 : (scanNow * scrollSpeed) % contentH;
      const baseY = inner.y + Math.round(lineH * 0.8);
      const anchorY = inner.y + inner.h * 0.66;
      const instances = [];
      for (let copy = 0; copy < 10; copy++) {
        let y = baseY + copy * contentH - offset;
        if (y - contentH > inner.y + inner.h) break;
        for (let bi = 0; bi < strip.length; bi++) {
          const block = strip[bi];
          const height = block.lines * lineH;
          const top = y - Math.round(lineH * 0.74);
          if (top + height > inner.y - lineH * 2 && top < inner.y + inner.h + lineH * 2) {
            instances.push({ block, top, mainY: y, height });
          }
          y += height;
        }
        if (copy > 0 && instances.length > 400) break;
      }
      instances.sort((a, b) => a.mainY - b.mainY);
      // Anchor row: the row passing the lower anchor zone, preferring the live row
      // when it is passing there (that row keeps the spider/frame).
      let anchorIdx = 0;
      let best = Infinity;
      instances.forEach((inst, index) => {
        const liveBonus = inst.block.live ? Math.abs(inst.mainY - anchorY) : Math.abs(inst.mainY - anchorY) + lineH * 3;
        if (liveBonus < best) { best = liveBonus; anchorIdx = index; }
      });
      const anchor = instances[anchorIdx];
      // Per-token contact: probe arms sweep rows in the tentacle band; each arm
      // boxes ONLY the token under its actual tip (no row-wide boxing). The body
      // row highlights only the token directly under the body.
      const bodyX = streamBodyX(inner, scanNow);
      const scanRightX = textRight - 24;
      const contactsFor = (rank) => {
        if (rank === 0) return [{ x: bodyX, alpha: state.reducedMotion ? 0.6 : 0.72 }];
        if (rank < 1 || rank > 5) return null;
        const extension = scanExtension(rank - 1, scanNow);
        if (extension <= 0.04) return null;
        return [{
          x: tokenX + extension * (scanRightX - tokenX),
          alpha: scSmooth(scClamp(extension / 0.3, 0, 1)),
        }];
      };
      for (let idx = 0; idx < instances.length; idx++) {
        const inst = instances[idx];
        inst.rank = anchorIdx - idx;
        inst.contacts = contactsFor(inst.rank);
        if (inst.rank >= 0) {
          rows.push({
            y: inst.mainY,
            rank: inst.rank,
            scanRight: textRight - 24,
            live: inst.block.live,
            number: inst.block.number,
          });
        }
      }
      for (const inst of instances) {
        const block = inst.block;
        let y = inst.mainY;
        const blockTop = inst.top;
        const blockH = inst.height;
        if (y >= inner.y + inner.h + lineH || y < inner.y - blockH) continue;
        if (block.live) {
          rect(p.x + 1, blockTop, p.w - 2, blockH, 'rgba(242,60,131,.08)');
          rect(p.x + 1, blockTop, 2.5 * L.S, blockH, themeRef.pink);
        } else if (inst.rank === 0) {
          rect(p.x + 1, blockTop, p.w - 2, blockH, 'rgba(242,60,131,.03)');
        }
        if (inst.rank === 0) {
          // Near-invisible frame marks the row under the body; no row-wide boxes.
          ctx.strokeStyle = SC.layout.alpha(block.live ? themeRef.pink : themeRef.code, 0.12);
          ctx.lineWidth = 1;
          ctx.strokeRect(p.x + 2.5, blockTop + 0.5, p.w - 5, blockH - 1);
        }
        const contacts = inst.contacts;
        text(scPad2(block.number), numberX, y, '#45434a', numFont);
        let firstItem = true;
        for (const item of block.items) {
          if (item.type === 'tokens') {
            drawTokenFlow(item.tokens, tokenX, y, item.firstRight, textRight, item.style, item.maxLines, lineH, contacts);
            if (firstItem) tagRight(block.tagLabel, textRight, y, fs(8.2), statusColor(block.call.status));
            y += item.lines * lineH;
          } else if (item.type === 'mixed') {
            text(item.prefix, item.x, y, '#6f6c75', item.style.size);
            drawTokenFlow(item.tokens, item.x + item.prefixW, y, textRight, textRight, item.style, item.maxLines, lineH, null);
            y += item.lines * lineH;
          } else if (item.type === 'excerpt') {
            text('│', item.x - 9, y, themeRef.dim, excerptSize);
            drawTokenFlow(item.tokens, item.x, y, textRight, textRight, item.style, item.maxLines, lineH, null);
            y += item.lines * lineH;
          } else {
            text(item.text, item.x, y, item.color, item.size);
            y += lineH;
          }
          firstItem = false;
        }
      }
    }
    state.crawlRows = rows;
    drawCrawler(L, inner, rows, lineH, inner.y + inner.h * 0.66);
    ctx.restore();
  }

  /**
   * The spider now "sits on the flowing stream": its body stays in a stable
   * lower anchor zone while rows slide underneath. Probe arms + box fronts are a
   * pure function of the row's current visual position (no crawl history).
   */
  function drawCrawler(L, inner, rows, lineH, anchorY) {
    const now = state.reducedMotion ? 4.2 : state.animTime;
    const scale = scClamp(L.left.w / 470, 0.62, 0.92);
    const bodyX = streamBodyX(inner, now);
    const bodyY = streamBodyY(inner, anchorY, now);
    const velocity = streamBodyVelocity(inner, now);
    state.crawl = { body: { x: bodyX, y: bodyY } };
    const tokenX = inner.x + 23;
    const textRight = inner.x + inner.w - 9;
    if (!rows.length) {
      SC.spider.drawSpider(ctx, {
        x: bodyX,
        y: bodyY,
        vx: velocity.vx,
        vy: velocity.vy,
        time: now,
        reducedMotion: state.reducedMotion,
        activeProbes: 0,
        phase: 0,
      });
      return;
    }
    let activeArms = 0;
    ctx.save();
    ctx.translate(bodyX, bodyY);
    ctx.scale(scale, scale);
    ctx.translate(-bodyX, -bodyY);
    const toLocal = (point) => ({ x: bodyX + (point.x - bodyX) / scale, y: bodyY + (point.y - bodyY) / scale });
    // Arms reach the rows sliding through the tentacle band above the body.
    for (const row of rows) {
      if (row.rank < 1 || row.rank > 5) continue;
      const extension = scanExtension(row.rank - 1, now);
      if (extension <= 0.03) continue;
      const reach = extension >= 0.999 ? 1 : Math.pow(inverseSmooth(extension), 1 / 1.35);
      const right = row.scanRight || textRight;
      const event = {
        index: row.rank,
        word: String(row.number),
        target: toLocal({
          x: tokenX + extension * (right - tokenX),
          y: row.y - lineH * 0.35,
        }),
        launchTime: now + SC.probes.PROBE_TIMING.reach * (1 - reach),
        width: 40,
        score: 0.9,
      };
      const probe = SC.probes.probePose(event, now, { x: bodyX, y: bodyY }, state.reducedMotion);
      if (!probe.visible || probe.distance < 24) continue;
      activeArms += 1;
      ctx.globalAlpha = probe.opacity;
      ctx.beginPath();
      ctx.moveTo(probe.root.x, probe.root.y);
      ctx.bezierCurveTo(probe.joints[0].x, probe.joints[0].y, probe.joints[1].x, probe.joints[1].y, probe.tip.x, probe.tip.y);
      ctx.strokeStyle = 'rgba(189,221,213,.6)';
      ctx.lineWidth = 0.8 / scale;
      ctx.stroke();
      ctx.fillStyle = 'rgba(238,255,247,.92)';
      for (let along = 0.1; along < 1; along += 0.08) {
        const px2 = probe.root.x + (probe.tip.x - probe.root.x) * along;
        const py2 = probe.root.y + (probe.tip.y - probe.root.y) * along;
        ctx.fillRect(px2 - 1 / scale, py2 - 1 / scale, 2 / scale, 2 / scale);
      }
      // Scan caret marks the tip while the arm is on the row (engine scanner feel).
      if (extension > 0.5) {
        ctx.globalAlpha = probe.opacity * Math.min(1, (extension - 0.5) * 3);
        ctx.strokeStyle = 'rgba(236,255,246,.92)';
        const half = 8 / scale;
        const tick = 3 / scale;
        ctx.lineWidth = 1.4 / scale;
        ctx.beginPath();
        ctx.moveTo(probe.tip.x, probe.tip.y - half);
        ctx.lineTo(probe.tip.x, probe.tip.y + half);
        ctx.stroke();
        ctx.lineWidth = 0.8 / scale;
        ctx.beginPath();
        ctx.moveTo(probe.tip.x - tick, probe.tip.y - half);
        ctx.lineTo(probe.tip.x + tick, probe.tip.y - half);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(probe.tip.x - tick, probe.tip.y + half);
        ctx.lineTo(probe.tip.x + tick, probe.tip.y + half);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    SC.spider.drawSpider(ctx, {
      x: bodyX,
      y: bodyY,
      vx: velocity.vx,
      vy: velocity.vy,
      time: now,
      reducedMotion: state.reducedMotion,
      activeProbes: activeArms,
      phase: 0,
    });
    ctx.restore();
  }


  /* --------------------------------------------------- center: spider web */
  function drawWeb(L, geom) {
    const m = state.model;
    const web = L.center;
    const pages = m.renderPages;
    const N = Math.max(1, pages.length);
    const cx = web.x + web.w * 0.5;
    const cy = web.y + web.h * 0.5;
    const arcK = (0.19 * web.w) / Math.pow(web.h / 2, 2);
    const arcX = (y) => web.x + web.w * 0.655 + (y - cy) * (y - cy) * arcK;
    const recentAt = m.now;
    const fade = (page) => scClamp(1 - (recentAt - page.updatedAt) / 60000, 0.35, 1);

    ctx.save();
    ctx.beginPath();
    ctx.rect(web.x, web.y, web.w, web.h);
    ctx.clip();

    // 1) faint pre-existing fan: 440-ish hairline strands, low-frequency sway.
    const fanCount = Math.round(scClamp((web.w * web.h) / 900, 170, 480));
    const sway = state.reducedMotion ? 0 : 1;
    for (let i = 0; i < fanCount; i++) {
      const wave = sway * Math.sin(state.animTime * (0.75 + scRand(i + 5) * 0.6) + scRand(i + 94) * 6.28) * 10;
      const waveB = sway * Math.sin(state.animTime * (0.65 + scRand(i + 19) * 0.7) + scRand(i + 201) * 6.28) * 9;
      const sy = web.y + 10 + scRand(i + 83) * (web.h - 20) + wave * 0.24;
      const ey = web.y + 6 + scRand(i + 217) * (web.h - 12) + (scRand(i + 33) - 0.5) * 14;
      const ex = arcX(ey);
      const bend = (scRand(i + 31) - 0.5) * web.h * 0.24;
      const inset = web.w * (0.22 + scRand(i + 11) * 0.06);
      ctx.beginPath();
      ctx.moveTo(web.x, sy);
      ctx.bezierCurveTo(
        web.x + web.w * 0.24 + scRand(i + 41) * web.w * 0.05 + wave * 0.4,
        sy + bend + wave,
        ex - inset - 30 + waveB * 0.3,
        sy * 0.62 + ey * 0.38 + (ey - cy) * 0.11 + waveB,
        ex - inset,
        ey + (ey - cy) * 0.18,
      );
      ctx.strokeStyle = 'rgba(149,153,159,' + (0.0875 + scRand(i + 8) * 0.094).toFixed(4) + ')';
      ctx.lineWidth = 0.6;
      ctx.stroke();
    }

    // 2) one strand per page: colour = route/status, length/alpha = status.
    //    Result threads (one per search result) fill the band first, dimmer, so
    //    a 30-page session still reads as dense as engine's 175-word fan.
    const resultWeights = ['code', 'code', 'code', 'code', 'code', 'model', 'code', 'code', 'code', 'you', 'code', 'code', 'model', 'code', 'code', 'code'];
    const resultThreads = Math.min(160, Math.max(0, m.metrics.results));
    for (let i = 0; i < resultThreads; i++) {
      const seed = 600 + i;
      const color = routeColor(resultWeights[i % resultWeights.length]);
      const y = web.y + 12 + ((i + 0.5) / Math.max(1, resultThreads)) * (web.h - 24);
      const x = arcX(y);
      const sx = x - web.w * (0.23 + scRand(seed) * 0.045);
      const sy = y + (y - cy) * 0.18 + (scRand(seed + 7) - 0.5) * 10;
      ctx.globalAlpha = 0.24 + scRand(seed + 3) * 0.2;
      line(sx, sy, x, y, color, 0.85);
      ctx.globalAlpha = 1;
    }
    const starts = [];
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const y = web.y + 12 + ((i + 0.5) / N) * (web.h - 24);
      const x = arcX(y);
      const sx = x - web.w * (0.29 + scRand(i + 51) * 0.035);
      const sy = y + (y - cy) * 0.18 + (scRand(i + 33) - 0.5) * 7;
      starts.push({ x: sx, y: sy, page });
      const color = pageColor(page);
      const active = page.status === 'running';
      ctx.globalAlpha = page.status === 'pending' ? 0.3 : 0.88;
      line(sx, sy, x, y, color, active ? 1.5 : page.status === 'failed' ? 1.2 : 1.3);
      ctx.globalAlpha = 1;
      if (active) {
        const phase = scRand(i + 61);
        const p = (state.animTime * 0.45 + phase) % 1;
        const px = sx + (x - sx) * p;
        const py = sy + (y - sy) * p;
        rect(px - 1.6, py - 1.6, 3.2, 3.2, color);
        ctx.globalAlpha = 0.22;
        rect(px - 3.4, py - 3.4, 6.8, 6.8, color);
        ctx.globalAlpha = 1;
      }
      // label just right of the arc, rotated with the fan
      const step = Math.max(1, Math.ceil(N / Math.max(4, Math.floor(web.h / 42))));
      if (i % step === 0) {
        const label = page.status === 'failed' ? 'fail: ' + (page.host || 'page') : page.host || page.title || page.id;
        ctx.save();
        ctx.translate(x + 8, y);
        ctx.rotate(((y - cy) / cy) * 0.48);
        ctx.globalAlpha = page.status === 'pending' ? 0.4 : 0.78;
        fit(label, 0, 2, web.w * 0.26, color, fs(8.2));
        ctx.restore();
        ctx.globalAlpha = 1;
      }
    }

    // 2b) transmission-path labels are INFINITE streaming packets: each page's
    //     chip travels from the inner end (near the creature) outward to the
    //     page/arc end and loops forever (2.4–3.6 s per strand, golden-ratio
    //     phases). Every wrap is one arrival event for the cumulative counters.
    const loopPlan = buildLoopPlan();
    const flowNow = state.reducedMotion ? 8 : state.animTime;
    const pathLabelSize = fs(8);
    for (const entry of loopPlan.pages) {
      const i = entry.index;
      const page = entry.page;
      const start = starts[i];
      if (!start) continue;
      const y = web.y + 12 + ((i + 0.5) / N) * (web.h - 24);
      const x = arcX(y);
      const strandLen = Math.abs(x - start.x);
      const failed = entry.failed;
      const color = failed ? themeRef.pink : routeColor(page.route);
      const raw = failed ? 'fail ' + (page.host || 'page') : page.host || page.title || page.id;
      let label = raw.length > 20 ? raw.slice(0, 19) + '…' : raw;
      font(pathLabelSize, 700);
      const maxChip = web.w * 0.34;
      let labelW = ctx.measureText(label).width;
      while (label.length > 4 && labelW + 9 > maxChip) {
        label = label.slice(0, -2) + '…';
        labelW = ctx.measureText(label).width;
      }
      const chipW = labelW + 8;
      const chipH = pathLabelSize + 4;
      const angle = scClamp(Math.atan2(y - start.y, x - start.x), -0.32, 0.32);
      // Long strands carry a second, trailing packet (same page, does not count twice).
      const slots = strandLen > web.w * 0.3 ? 2 : 1;
      for (let slot = 0; slot < slots; slot++) {
        const u = loopU(entry, flowNow, slot);
        const alpha = Math.min(
          scSmooth(scClamp(u / 0.12, 0, 1)),
          scSmooth(scClamp((1 - u) / 0.15, 0, 1)),
        );
        if (alpha <= 0.02) continue;
        const px = start.x + (x - start.x) * u;
        const py = start.y + (y - start.y) * u;
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(angle);
        // Subtle comet trail behind the packet, along the strand.
        const trail = Math.min(18, strandLen * 0.12);
        ctx.globalAlpha = alpha * 0.16;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-trail, 0);
        ctx.lineTo(0, 0);
        ctx.stroke();
        ctx.globalAlpha = alpha * (failed ? 0.96 : 0.9);
        ctx.beginPath();
        ctx.roundRect(-chipW / 2, -chipH / 2, chipW, chipH, 2.5);
        ctx.fillStyle = SC.layout.alpha(color, failed ? 0.82 : 0.8);
        ctx.fill();
        ctx.strokeStyle = SC.layout.alpha(color, 0.95);
        ctx.lineWidth = 1;
        ctx.stroke();
        text(label, 0, pathLabelSize * 0.34, '#0b1110', pathLabelSize, 700, 'center');
        ctx.restore();
        ctx.globalAlpha = 1;
      }
    }

    // 3) measured arc + ticks (engine renderer.js#drawWeb recipe).
    for (let ring = 0; ring < 2; ring++) {
      ctx.beginPath();
      for (let y = web.y + 2; y <= web.y + web.h - 2; y += 4) {
        const x = arcX(y) + ring * web.w * 0.10;
        if (y === web.y + 2) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = ring ? '#3c3a42' : '#67616b';
      ctx.lineWidth = ring ? 1 : 0.6;
      ctx.stroke();
    }
    for (let y = web.y + 4; y < web.y + web.h - 4; y += 8) {
      const x = arcX(y);
      line(x + 1, y, x + 5, y + (y - cy) * 0.006, '#55515a', 0.5);
    }

    // 4) upward scanner sweeping around the arc.
    const scanRange = Math.max(60, web.h - 18);
    const speed = state.reducedMotion ? 0 : Math.max(10, scanRange / 14);
    const scanY = web.y + 9 + (((state.animTime * speed) % scanRange) + scanRange) % scanRange;
    const scanX = arcX(scanY) + web.w * 0.1;
    ctx.save();
    ctx.translate(scanX, scanY);
    ctx.rotate(-Math.atan(0.0015 * (scanY - cy) * (web.w / 536)));
    line(0, -web.h * 0.055, 0, web.h * 0.055, '#dadcda', 2.6);
    line(4, -web.h * 0.033, 4, web.h * 0.033, '#787980', 0.8);
    text('p', 8, -web.h * 0.045, '#b5b3b9', fs(9));
    ctx.restore();

    // 5) the creature lives on the left statement rows now (drawStreamPanel /
    //    drawCrawler); the web keeps the fan the creature is attached to.
    //    Record where each strand starts for the connector fan.
    state.bandStarts = starts;
    geom.spider = null;
    geom.strandStarts = starts;
    if (!pages.length) {
      text(strings.emptyCenter[0], web.x + 24, cy - 8, themeRef.muted, fs(12));
      if (web.h > 120) text(strings.emptyCenter[1], web.x + 24, cy + 14, themeRef.dim, fs(10));
    }
    ctx.restore();

    // 6) routing particles fly from strand ends to the right-rail cards.
    drawRoutingParticles(L, geom);
  }

  /**
   * Strand fan from the crawling spider (left stream) to the web's strand starts:
   * the dashboard keeps the reference's "creature attached to its web" read even
   * though the creature now walks the data rows instead of the centre.
   */
  function drawConnectors(L) {
    const crawl = state.crawl && state.crawl.body;
    const starts = state.bandStarts || [];
    if (!crawl || !starts.length) return;
    const count = Math.min(10, starts.length);
    ctx.save();
    for (let k = 0; k < count; k++) {
      const start = starts[Math.floor(((k + 0.5) / count) * starts.length)];
      if (!start) continue;
      const color = pageColor(start.page);
      const midX = (crawl.x + start.x) / 2;
      ctx.beginPath();
      ctx.moveTo(crawl.x, crawl.y);
      ctx.bezierCurveTo(
        midX - L.gap * 2,
        crawl.y + (start.y - crawl.y) * 0.12,
        midX + L.gap * 3,
        start.y - (start.y - crawl.y) * 0.1,
        start.x,
        start.y,
      );
      ctx.strokeStyle = SC.layout.alpha(color, 0.22 + (k % 4) * 0.03);
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }
    // A slow pulse travelling from the creature into its web (2 threads only).
    if (!state.reducedMotion && starts.length) {
      for (let k = 0; k < 2; k++) {
        const start = starts[Math.floor(((k + 0.5) / 2) * starts.length)];
        if (!start) continue;
        const p = (state.animTime * 0.35 + k * 0.5) % 1;
        const eased = p * p * (3 - 2 * p);
        const x = crawl.x + (start.x - crawl.x) * eased;
        const y = crawl.y + (start.y - crawl.y) * eased;
        ctx.globalAlpha = Math.min(1, p * 8, (1 - p) * 8) * 0.7;
        rect(x - 1.6, y - 1.6, 3.2, 3.2, pageColor(start.page));
        ctx.globalAlpha = 1;
      }
    }
    ctx.restore();
  }

  function drawRoutingParticles(L, geom) {
    const m = state.model;
    const targets = [
      { x: L.right.x, y: L.right.y + (L.right.h - L.gap * 2) / 6 },
      { x: L.right.x, y: L.right.y + (L.right.h - L.gap * 2) / 2 + L.gap },
      { x: L.right.x, y: L.right.y + (L.right.h - L.gap * 2) * 5 / 6 + L.gap * 2 },
    ];
    const starts = geom.strandStarts || [];
    ctx.save();
    ctx.beginPath();
    ctx.rect(L.center.x, L.center.y, L.center.x + L.center.w + L.gap - L.center.x, L.center.h);
    ctx.clip();
    for (let i = 0; i < starts.length; i++) {
      const start = starts[i];
      const page = start.page;
      const age = (m.now - page.updatedAt) / 1000;
      if (age < 0 || age > 2.2) continue;
      const index = page.status === 'failed' ? 2 : page.status === 'running' ? 1 : 0;
      const target = targets[index];
      for (let k = 0; k < 2; k++) {
        const p = (age - k * 0.065) / 1.35;
        if (p < 0 || p > 1 || state.reducedMotion) continue;
        const eased = 1 - Math.pow(1 - p, 3);
        // Curved flight from the strand end to the metric card (engine cubic helper).
        const controlA = { x: start.x + (target.x - start.x) * 0.35, y: start.y - (scRand(i + k + 70) - 0.5) * 40 };
        const controlB = { x: start.x + (target.x - start.x) * 0.78, y: target.y - (scRand(i + k + 90) - 0.5) * 40 };
        const point = SC.motion.cubicPoint(eased, { x: start.x, y: start.y }, controlA, controlB, target);
        ctx.globalAlpha = Math.min(1, p * 12, (1 - p) * 7);
        rect(point.x - 1.8, point.y - 1.8, 3.6, 3.6, pageColor(page));
        ctx.globalAlpha *= 0.22;
        rect(point.x - 3.7, point.y - 3.7, 7.4, 7.4, pageColor(page));
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  /* -------------------------------------------------- right: route cards */
  function drawRouteCards(L) {
    const m = state.model;
    const gap = L.gap;
    const cardH = Math.floor((L.right.h - gap * 2) / 3);
    const fetched = m.calls.filter((c) => c.tool === 'web_fetch');
    let avg = '—';
    const durations = fetched.map((c) => c.endedAt - c.startedAt).filter((d) => d > 0);
    if (durations.length) avg = scDur(durations.reduce((s, d) => s + d, 0) / durations.length);
    // Big numbers = cumulative arrival counts (unbounded); small footnotes = REAL totals.
    const counts = progressiveCounts();
    const defs = strings.cards;
    const entries = [
      { color: themeRef.code, count: counts.queries, foot: defs[0].foot(m.metrics) },
      { color: themeRef.model, count: counts.fetches, foot: defs[1].foot(m.metrics, avg) },
      { color: themeRef.pink, count: counts.failures, foot: defs[2].foot(m.metrics) },
    ];
    const recentKeys = ['search', 'fetch', 'fail'];
    entries.forEach((entry, i) => {
      const x = L.right.x;
      const y = L.right.y + i * (cardH + gap);
      const w = L.right.w;
      const recent = state.animTime - (state.pulses[recentKeys[i]] || -99) < 0.38;
      if (recent) {
        ctx.strokeStyle = entry.color;
        ctx.globalAlpha = 0.25;
        ctx.lineWidth = 2;
        ctx.strokeRect(x - 6, y - 6, w + 12, cardH + 12);
        ctx.globalAlpha = 1;
      }
      rect(x, y, w, cardH, '#09090b');
      frameRect(x, y, w, cardH, entry.color, recent ? 2 : 1);
      const capH = Math.round(scClamp(cardH * 0.17, 14, 20));
      rect(x + 1, y + 1, w - 2, capH, entry.color);
      text(defs[i].top, x + 7, y + capH * 0.72, '#0b1110', fs(8.6), 700);
      text(defs[i].title, x + 12, y + capH + Math.round(cardH * 0.24), '#f2f0f1', fs(14));
      const countSize = Math.min(fs(40), cardH * 0.35);
      text(entry.count, x + w - 10, y + capH + Math.round(cardH * 0.72), entry.color, countSize, 700, 'right');
      // Clarify that the big number is cumulative arrivals, not a real total.
      text(strings.arrivals, x + w - 10, y + capH + Math.round(cardH * 0.5), '#6f6c75', fs(7.4), 400, 'right');
      fit(entry.foot, x + 10, y + cardH - Math.round(cardH * 0.09), w - 20, '#7e7b83', fs(8.6));
    });
  }

  /* --------------------------------------------- bottom row A: tables */
  function drawDecisionStream(L) {
    const m = state.model;
    const p = L.panelsA.decision;
    const inner = drawPanel(p, strings.decision, strings.decisionRight);
    const calls = m.calls.slice().sort((a, b) => a.startedAt - b.startedAt);
    const rows = calls.slice(-Math.max(1, Math.floor((inner.h - 6) / fs(16.5))));
    clipInner(inner);
    const rowH = Math.min(fs(17.5), (inner.h - 4) / Math.max(1, rows.length));
    rows.forEach((call, i) => {
      const y = inner.y + 4 + (i + 0.78) * rowH;
      const isSearch = call.tool === 'web_search';
      const color = call.status === 'failed' ? themeRef.pink : isSearch ? themeRef.code : themeRef.model;
      const selected = i === rows.length - 1;
      if (selected) {
        rect(inner.x + 2, y - rowH * 0.72, inner.w - 4, rowH, 'rgba(242,60,131,.06)');
      }
      text(scDur(call.startedAt - m.startedAt), inner.x + 10, y, '#8e8991', fs(9.4));
      const chipW = chip(isSearch ? 'search' : 'fetch', inner.x + 56, y, fs(8.2), color, '#140a11');
      const textX = inner.x + 56 + chipW + 8;
      const statusW = fs(9.4) * 12;
      fit(call.label, textX, y, inner.w - (textX - inner.x) - statusW - 16, themeRef.text, fs(9.6));
      const detail = isSearch
        ? `${call.resultCount} ${strings.rows.result} · ${scDur(call.endedAt - call.startedAt)}`
        : `HTTP ${call.httpStatus > 0 ? call.httpStatus : '—'} · ${scBytes(call.bytes)}`;
      text(detail, inner.x + inner.w - 8, y, statusColor(call.status), fs(9.2), 400, 'right');
    });
    ctx.restore();
  }

  function drawCoverage(L) {
    const m = state.model;
    const p = L.panelsA.coverage;
    const inner = drawPanel(p, strings.coverage, strings.coverageRight);
    clipInner(inner);
    const total = Math.max(1, m.pageTotal);
    const fetched = m.pages.filter((page) => page.status === 'completed').length;
    const pct = Math.round((fetched / total) * 100);
    const counts = { code: 0, model: 0, you: 0 };
    for (const page of m.pages) counts[page.route] += 1;
    const routeLabel = (route) => route;
    const wide = inner.w > inner.h * 3;
    if (wide) {
      // Short landscape panel: number left, breakdown bars right.
      const bigSize = Math.min(fs(46), inner.h * 0.6, inner.w * 0.2);
      text(pct + '%', inner.x + 12, inner.y + inner.h * 0.52, themeRef.pink, bigSize, 700);
      text(strings.coverageSub(m.pageTotal), inner.x + 13, inner.y + inner.h * 0.82, '#85818a', fs(9.2));
      const barX = inner.x + inner.w * 0.45;
      const barW = inner.w * 0.4;
      SC_ROUTES.forEach((route, i) => {
        const y = inner.y + inner.h * (0.3 + i * 0.22);
        text(routeLabel(route), inner.x + inner.w * 0.43, y, '#e0dde3', fs(9), 400, 'right');
        rect(barX, y - fs(4.6), barW, fs(4.8), '#29282e');
        const width = Math.max(counts[route] ? fs(3) : 0, barW * counts[route] / Math.max(1, m.pages.length));
        rect(barX, y - fs(4.6), width, fs(4.8), routeColor(route));
        if (width > 4) rect(barX + width - 3, y - fs(4.6), 3, fs(4.8), 'rgba(255,255,255,.18)');
        text(counts[route], inner.x + inner.w - 10, y, routeColor(route), fs(9), 400, 'right');
      });
    } else {
      // Tall portrait panel: number, caption, then breakdown bars underneath.
      const bigSize = Math.min(fs(52), inner.h * 0.36);
      const bigBase = inner.y + bigSize * 0.98;
      text(pct + '%', inner.x + 12, bigBase, themeRef.pink, bigSize, 700);
      const subBase = bigBase + fs(9.6) * 1.05;
      text(strings.coverageSub(m.pageTotal), inner.x + 13, subBase, '#85818a', fs(9.2));
      const rowH = Math.min(fs(17), Math.max(fs(9), (inner.y + inner.h - subBase - fs(12) - 4) / 3));
      const barTop = subBase + fs(12);
      SC_ROUTES.forEach((route, i) => {
        const y = barTop + rowH * (i + 0.82);
        text(routeLabel(route), inner.x + 12, y, '#e0dde3', fs(9.6));
        const barX = inner.x + inner.w * 0.3;
        const barW = inner.w * 0.45;
        rect(barX, y - fs(5.4), barW, fs(5.6), '#29282e');
        const width = Math.max(counts[route] ? fs(3) : 0, barW * counts[route] / Math.max(1, m.pages.length));
        rect(barX, y - fs(5.4), width, fs(5.6), routeColor(route));
        if (width > 4) rect(barX + width - 3, y - fs(5.4), 3, fs(5.6), 'rgba(255,255,255,.18)');
        text(counts[route], inner.x + inner.w - 10, y, routeColor(route), fs(9.6), 400, 'right');
      });
    }
    ctx.restore();
  }

  /* ------------------------------------------- bottom row B: small panels */
  function drawPageReads(L) {
    const m = state.model;
    const p = L.panelsB[0];
    const inner = drawPanel(p, strings.pageReads, strings.pageReadsRight);
    clipInner(inner);
    const fetches = m.calls.filter((call) => call.tool === 'web_fetch').sort((a, b) => a.startedAt - b.startedAt);
    const rowH = Math.min(fs(17), (inner.h - 4) / Math.max(1, Math.min(6, fetches.length || 1)));
    const rows = fetches.slice(-Math.max(1, Math.floor((inner.h - 4) / fs(17))));
    if (!rows.length) {
      text(strings.noData, inner.x + 10, inner.y + fs(16), themeRef.dim, fs(9.4));
    }
    rows.forEach((call, i) => {
      const y = inner.y + 4 + (i + 0.8) * rowH;
      const host = scHost(call.url) || 'unknown.host';
      fit(host, inner.x + 10, y, inner.w * 0.52, '#dddddf', fs(9.4));
      const status = call.httpStatus > 0 ? String(call.httpStatus) : '—';
      text(status, inner.x + inner.w * 0.62, y, statusColor(call.status), fs(9.4), 400, 'right');
      text(scBytes(call.bytes), inner.x + inner.w - 10, y, themeRef.muted, fs(9.2), 400, 'right');
    });
    ctx.restore();
  }

  function drawDotTrace(L) {
    const m = state.model;
    const p = L.panelsB[1];
    const inner = drawPanel(p, strings.dottrace, strings.dottraceRight);
    clipInner(inner);
    const areaX = inner.x + 10;
    const areaY = inner.y + 8;
    const areaW = inner.w - 20;
    const areaH = Math.max(20, inner.h - fs(9) * 2.4 - 10);
    for (let i = 0; i <= 3; i++) line(areaX, areaY + (i * areaH) / 3, areaX + areaW, areaY + (i * areaH) / 3, '#24222a', 0.65);
    const events = m.activities.length
      ? m.activities
      : m.pages.map((page) => ({ at: page.firstAt, kind: 'page', route: page.route }));
    const span = Math.max(10, m.elapsed);
    const buckets = Math.max(14, Math.min(30, Math.round(areaW / 11)));
    const values = new Array(buckets).fill(0);
    const kinds = new Array(buckets).fill('');
    const kindOrder = { fail: 4, fetch: 3, result: 2, search: 1, start: 0, end: 0, page: 1 };
    for (const item of events) {
      const age = m.now - item.at;
      if (age < 0 || age > span * 1000) continue;
      const index = Math.min(buckets - 1, Math.floor((1 - age / (span * 1000)) * buckets));
      values[index] += 1;
      if ((kindOrder[item.kind] || 0) >= (kindOrder[kinds[index]] || -1)) kinds[index] = item.kind;
    }
    const maxValue = Math.max(1, ...values);
    const points = values.map((value, i) => ({
      x: areaX + (i / Math.max(1, buckets - 1)) * areaW,
      y: areaY + areaH - (value / maxValue) * areaH * 0.92,
      value,
      kind: kinds[i],
    }));
    ctx.beginPath();
    ctx.moveTo(points[0].x, areaY + areaH);
    points.forEach((point) => ctx.lineTo(point.x, point.y));
    ctx.lineTo(points[points.length - 1].x, areaY + areaH);
    ctx.closePath();
    const gradient = ctx.createLinearGradient(0, areaY, 0, areaY + areaH);
    gradient.addColorStop(0, 'rgba(242,60,131,.06)');
    gradient.addColorStop(1, 'rgba(242,60,131,.17)');
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.beginPath();
    points.forEach((point, i) => (i ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y)));
    ctx.strokeStyle = themeRef.pink;
    ctx.lineWidth = 1.35;
    ctx.stroke();
    const kindColor = { search: themeRef.code, fetch: themeRef.model, fail: themeRef.pink, result: themeRef.you, page: themeRef.muted };
    points.forEach((point) => {
      if (!point.value) return;
      rect(point.x - 1.7, point.y - 1.7, 3.4, 3.4, kindColor[point.kind] || themeRef.you);
    });
    const total = events.length;
    text(`avg ${(total / Math.max(1, span / 60)).toFixed(1)}/min · peak ${maxValue}`, areaX, inner.y + inner.h - fs(7), '#f2f0f2', fs(9.4), 700);
    ctx.restore();
  }

  function drawDotGrid(L) {
    const m = state.model;
    const p = L.panelsB[2];
    const inner = drawPanel(p, strings.dotgrid, strings.dotgridRight);
    clipInner(inner);
    const pages = m.renderPages;
    const total = m.pageTotal;
    if (!pages.length) {
      text(strings.noData, inner.x + 10, inner.y + fs(16), themeRef.dim, fs(9.4));
    } else {
      // Size the matrix to fill the panel both ways (aspect-aware, 1 dot = 1 page).
      const columns = Math.round(scClamp(Math.sqrt(pages.length * (inner.w / Math.max(1, inner.h))), 6, 26));
      const rows = Math.ceil(pages.length / columns);
      const usableW = inner.w - 24;
      const usableH = inner.h - fs(11) * 2.5 - 8;
      const spacingX = usableW / Math.max(1, columns - 1);
      const spacingY = Math.min(spacingX, usableH / Math.max(1, rows - 1));
      const radius = scClamp(Math.min(spacingX, spacingY) * 0.3, 1.8, 3.9);
      const startX = inner.x + 12;
      const startY = inner.y + 8 + Math.max(0, (usableH - (rows - 1) * spacingY) / 2);
      pages.forEach((page, i) => {
        const x = startX + (i % columns) * spacingX;
        const y = startY + Math.floor(i / columns) * spacingY;
        ctx.fillStyle = pageColor(page);
        ctx.globalAlpha = page.status === 'pending' ? 0.35 : 1;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, SC_TAU);
        ctx.fill();
        ctx.globalAlpha = 1;
      });
    }
    text(`${m.pages.filter((page) => page.status === 'completed').length} / ${total}`, inner.x + 12, inner.y + inner.h - fs(3), '#f2f0f2', fs(9.6), 700);
    ctx.restore();
  }

  function drawTools(L) {
    const m = state.model;
    const p = L.panelsB[3];
    const inner = drawPanel(p, strings.tools, '');
    clipInner(inner);
    const fetches = m.metrics.fetches;
    const failures = m.metrics.failures;
    const rows = [
      { color: themeRef.code, label: 'web_search', desc: `${m.metrics.queries} ${strings.rows.search} · ${m.metrics.results} ${strings.rows.result}` },
      { color: themeRef.model, label: 'web_fetch', desc: `${fetches} ${strings.rows.fetch} · ${Math.max(0, fetches - failures)} ${strings.rows.ok}` },
      { color: themeRef.pink, label: 'failed', desc: `${failures} ${strings.rows.fail}` },
    ];
    const descSize = fs(9.2);
    const minRow = descSize * 1.6;
    const footH = descSize * 2 + 10;
    const showFoot = inner.h - 8 - 3 * minRow >= footH + 2;
    const rowH = Math.max(minRow, Math.min(fs(30), showFoot ? (inner.h - 8 - footH - 6) / 3 : (inner.h - 8 - descSize * 0.95) / 3));
    rows.forEach((row, i) => {
      const y = inner.y + 8 + rowH * 0.55 + i * rowH;
      rect(inner.x + 10, y - fs(4), fs(2.6), rowH * 0.72, row.color);
      text(row.label, inner.x + 20, y, row.color, fs(10.2), 700);
      fit(row.desc, inner.x + 20, y + descSize * 1.02, inner.w - 30, '#e7e2e7', descSize);
    });
    if (showFoot) {
      const footY = inner.y + inner.h - fs(4) - 1;
      text(strings.toolsFoot[0], inner.x + 10, footY - descSize - 3, '#f4eff4', descSize, 700);
      text(strings.toolsFoot[1], inner.x + 10, footY, themeRef.pink, descSize, 700);
    }
    ctx.restore();
  }

  /* ------------------------------------------------------------- footer */
  function drawFooter(L) {
    const m = state.model;
    rect(0, L.H - L.footerH, L.W, L.footerH, '#161619');
    line(0, L.H - L.footerH + 0.5, L.W, L.H - L.footerH + 0.5, '#25252a', 1);
    const y = L.H - L.footerH * 0.34;
    const left = `web-spider · ${m.pageTotal} pages · ${m.metrics.sources} sources · ${m.calls.length} calls · ${m.metrics.events} events`;
    fit(left, L.gutter, y, L.W * 0.62, '#7b7880', fs(9.4));
    const statusColorValue = m.status === 'live' ? themeRef.pink : m.status === 'done' ? themeRef.code : themeRef.muted;
    const session = m.sessionId ? ' · ' + m.sessionId : '';
    text(`${strings.statusWord[m.status] || 'IDLE'} · ${m.elapsed.toFixed(1)}s${session}`, L.W - L.gutter, y, statusColorValue, fs(9.4), 400, 'right');
  }

  /* -------------------------------------------------------------- paint */
  function draw() {
    const L = state.layout;
    const m = state.model;
    if (!L) return;
    ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    rect(0, 0, L.W, L.H, themeRef.background);
    state.regions.length = 0;
    drawHeader(L);
    drawStreamPanel(L);
    const geom = { spider: null, strandStarts: [] };
    drawWeb(L, geom);
    drawConnectors(L);
    drawRouteCards(L);
    drawDecisionStream(L);
    drawCoverage(L);
    drawPageReads(L);
    drawDotTrace(L);
    drawDotGrid(L);
    drawTools(L);
    drawFooter(L);
    state.dirty = false;
    emitFrame();
  }

  function emitFrame() {
    if (!opts.onFrame) return;
    try {
      opts.onFrame({ width: state.cssW, height: state.cssH, status: state.model.status });
    } catch (error) {
      /* never let a listener break the paint */
    }
  }

  /* ------------------------------------------------------------- resize */
  function measureSize() {
    let w = 0;
    let h = 0;
    if (typeof container.getBoundingClientRect === 'function') {
      const box = container.getBoundingClientRect();
      if (box) {
        w = scFinite(box.width, 0);
        h = scFinite(box.height, 0);
      }
    }
    if (!w || !h) {
      w = scFinite(container.clientWidth, 0);
      h = scFinite(container.clientHeight, 0);
    }
    if (!w || !h) {
      w = opts.width || state.cssW;
      h = opts.height || state.cssH;
    }
    if (!w || !h) {
      w = 960;
      h = 600;
    }
    state.cssW = Math.max(240, Math.round(w));
    state.cssH = Math.max(200, Math.round(h));
  }

  function applyCanvasSize() {
    const ratio = opts.pixelRatio > 0 ? scClamp(opts.pixelRatio, 1, 2) : scClamp(scFinite(win.devicePixelRatio, 1), 1, 2);
    state.dpr = ratio;
    const width = Math.round(state.cssW * ratio);
    const height = Math.round(state.cssH * ratio);
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    if (canvas.style) canvas.style.aspectRatio = state.cssW + ' / ' + state.cssH;
  }

  function rebuildLayout() {
    measureSize();
    applyCanvasSize();
    state.layout = computeLayout(state.cssW, state.cssH);
  }

  function resize() {
    if (state.destroyed) return;
    rebuildLayout();
    state.dirty = true;
    draw();
  }

  /* ------------------------------------------------------------- model IO */
  function refreshPulses() {
    const m = state.model;
    const elapsed = m.elapsed;
    for (const activity of m.activities.slice(-24)) {
      const age = elapsed - (activity.at - m.startedAt) / 1000;
      if (age < -0.05 || age > 0.6) continue;
      const key = activity.kind === 'fail' ? 'fail' : activity.kind === 'fetch' ? 'fetch' : activity.kind === 'search' ? 'search' : activity.kind === 'result' ? 'result' : 'page';
      const at = state.animTime - Math.max(0, age);
      if (at > (state.pulses[key] || -99)) state.pulses[key] = at;
    }
    for (const call of m.calls.slice(-6)) {
      if (call.endedAt <= 0) continue;
      const age = elapsed - (call.endedAt - m.startedAt) / 1000;
      if (age < -0.05 || age > 0.6) continue;
      const key = call.status === 'failed' ? 'fail' : call.tool === 'web_fetch' ? 'fetch' : 'search';
      const at = state.animTime - Math.max(0, age);
      if (at > (state.pulses[key] || -99)) state.pulses[key] = at;
    }
  }

  function setData(model) {
    if (state.destroyed) return false;
    state.model = scNormalizeModel(model, opts);
    if (opts.animationTime > state.animTime) state.animTime = opts.animationTime;
    refreshPulses();
    state.dirty = true;
    if (!rafLoop) draw();
    return true;
  }

  function push(input) {
    if (state.destroyed || !input || typeof input !== 'object') return false;
    const m = state.model;
    const type = typeof input.type === 'string' ? input.type : 'activity';
    const at = scFinite(input.at, Date.now());
    if (type === 'data') {
      return setData(input.model || input.data || input);
    }
    if (type === 'status') {
      if (input.status === 'live' || input.status === 'idle' || input.status === 'done') m.status = input.status;
      m.now = Math.max(m.now, at);
      state.dirty = true;
      if (!rafLoop) draw();
      return true;
    }
    if (type === 'call') {
      const call = input.call && typeof input.call === 'object' ? input.call : input;
      const normalized = scNormalizeModel({ calls: [call], startedAt: m.startedAt, now: m.now }, opts).calls[0];
      if (!normalized) return false;
      const existing = m.calls.findIndex((item) => item.id === normalized.id);
      if (existing >= 0) m.calls[existing] = normalized;
      else m.calls.push(normalized);
      m.metrics.events += 1;
      m.now = Math.max(m.now, at);
      if (normalized.tool === 'web_fetch') {
        if (existing < 0) m.metrics.fetches += 1;
        if (normalized.status === 'failed' && existing < 0) m.metrics.failures += 1;
      } else if (existing < 0) {
        m.metrics.queries += Math.max(1, normalized.queries.length);
        m.metrics.results += normalized.resultCount;
      }
      state.pulses[normalized.tool === 'web_fetch' ? 'fetch' : 'search'] = state.animTime;
      state.dirty = true;
      if (!rafLoop) draw();
      return true;
    }
    if (type === 'page') {
      const page = input.page && typeof input.page === 'object' ? input.page : input;
      const url = typeof page.url === 'string' ? page.url : '';
      const id = String(page.id != null ? page.id : url || 'page-' + m.pages.length);
      const normalized = scNormalizeModel({ pages: [Object.assign({}, page, { id })], startedAt: m.startedAt, now: m.now }, opts).pages[0];
      if (!normalized) return false;
      const existing = m.pages.findIndex((item) => item.id === normalized.id);
      if (existing >= 0) m.pages[existing] = normalized;
      else {
        m.pages.push(normalized);
        m.pageTotal += 1;
        m.activities.push({ at, kind: 'result', label: normalized.title, route: normalized.route });
        if (normalized.host) m.metrics.sources = new Set(m.pages.map((item) => item.host).filter(Boolean)).size;
      }
      if (m.pageTotal > opts.maxPages) m.renderPages = m.pages.slice(m.pageTotal - opts.maxPages);
      else m.renderPages = m.pages;
      state.pulses.page = state.animTime;
      state.dirty = true;
      if (!rafLoop) draw();
      return true;
    }
    if (type === 'metrics') {
      const patch = input.metrics && typeof input.metrics === 'object' ? input.metrics : input;
      for (const key of Object.keys(m.metrics)) if (scFinite(patch[key], -1) >= 0) m.metrics[key] = Math.round(patch[key]);
      state.dirty = true;
      if (!rafLoop) draw();
      return true;
    }
    // generic activity event
    const kind = String(input.kind || '').toLowerCase();
    const activity = {
      at,
      kind: ['search', 'fetch', 'result', 'fail', 'start', 'end'].indexOf(kind) >= 0 ? kind : 'search',
      label: String(input.label == null ? '' : input.label).slice(0, 220),
      route: SC_ROUTES.indexOf(String(input.route || '').toLowerCase()) >= 0 ? String(input.route).toLowerCase() : '',
    };
    m.activities.push(activity);
    m.metrics.events += 1;
    if (activity.kind === 'search') m.metrics.queries += Array.isArray(input.queries) ? Math.max(1, input.queries.length) : Math.max(1, scFinite(input.queries, 1));
    if (activity.kind === 'fetch') m.metrics.fetches += 1;
    if (activity.kind === 'fail') m.metrics.failures += 1;
    if (activity.kind === 'result') m.metrics.results += Math.max(1, scFinite(input.resultCount, 1));
    m.now = Math.max(m.now, at);
    state.pulses[activity.kind === 'fail' ? 'fail' : activity.kind === 'fetch' ? 'fetch' : activity.kind === 'search' ? 'search' : 'result'] = state.animTime;
    state.dirty = true;
    if (!rafLoop) draw();
    return true;
  }

  /* ------------------------------------------------------------ emitter */
  const listeners = [];
  function addListener(fn) {
    if (typeof fn === 'function') listeners.push(fn);
    return function remove() {
      const index = listeners.indexOf(fn);
      if (index >= 0) listeners.splice(index, 1);
    };
  }
  function resizeHandler() {
    rebuildLayout();
    state.dirty = true;
    if (!rafLoop) draw();
  }
  let ro = null;
  let io = null;
  if (typeof win.ResizeObserver === 'function') {
    try {
      ro = new win.ResizeObserver(resizeHandler);
      ro.observe(container);
    } catch (error) {
      ro = null;
    }
  }
  if (typeof win.IntersectionObserver === 'function') {
    try {
      io = new win.IntersectionObserver(function (entries) {
        state.visible = entries.some((entry) => entry.isIntersecting);
      });
      io.observe(container);
    } catch (error) {
      io = null;
    }
  }
  function onVisibility() {
    state.dirty = true;
    if (!rafLoop) draw();
  }
  function onWindowResize() {
    resizeHandler();
  }
  if (typeof win.addEventListener === 'function') {
    win.addEventListener('resize', onWindowResize);
    if (doc && typeof doc.addEventListener === 'function') doc.addEventListener('visibilitychange', onVisibility);
  }

  const rafLoop = typeof win.requestAnimationFrame === 'function';
  const raf = rafLoop ? win.requestAnimationFrame.bind(win) : null;
  const caf = rafLoop && typeof win.cancelAnimationFrame === 'function' ? win.cancelAnimationFrame.bind(win) : null;
  let frameTick = 0;
  /** Cheap safety net for host layout changes ResizeObserver may miss (e.g. fullscreen toggle). */
  function syncSizeIfNeeded() {
    const w = scFinite(container.clientWidth, 0);
    const h = scFinite(container.clientHeight, 0);
    if (w >= 2 && h >= 2 && (Math.round(w) !== state.cssW || Math.round(h) !== state.cssH)) resizeHandler();
  }
  function frame(timestamp) {
    if (state.destroyed) return;
    state.raf = raf(frame);
    if (!state.visible) return;
    if (doc && doc.hidden) return;
    const now = (typeof timestamp === 'number' ? timestamp : (typeof performance !== 'undefined' ? performance.now() : Date.now())) / 1000;
    const last = state.lastFrame || now;
    const dt = scClamp(now - last, 0, 0.1);
    state.lastFrame = now;
    if (!state.reducedMotion) state.animTime += dt;
    if (++frameTick % 15 === 0) syncSizeIfNeeded();
    draw();
  }

  function destroy() {
    if (state.destroyed) return;
    state.destroyed = true;
    if (rafLoop && caf && state.raf) caf(state.raf);
    if (ro) ro.disconnect();
    if (io) io.disconnect();
    if (typeof win.removeEventListener === 'function') {
      win.removeEventListener('resize', onWindowResize);
      if (doc && typeof doc.removeEventListener === 'function') doc.removeEventListener('visibilitychange', onVisibility);
    }
    listeners.length = 0;
    state.model = scNormalizeModel(null, opts);
    state.regions.length = 0;
    if (canvas.parentNode && typeof canvas.parentNode.removeChild === 'function') {
      try {
        canvas.parentNode.removeChild(canvas);
      } catch (error) {
        /* ignore */
      }
    }
  }

  function snapshot(mime, quality) {
    if (state.destroyed) return null;
    draw();
    if (typeof canvas.toDataURL !== 'function') return null;
    const type = typeof mime === 'string' && mime ? mime : 'image/png';
    return typeof quality === 'number' ? canvas.toDataURL(type, quality) : canvas.toDataURL(type);
  }

  function getState() {
    const m = state.model;
    const scan = progressiveCounts();
    return {
      ready: true,
      destroyed: state.destroyed,
      status: m.status,
      elapsed: Number(m.elapsed.toFixed(2)),
      animationTime: Number(state.animTime.toFixed(2)),
      metrics: Object.assign({}, m.metrics),
      arrivals: {
        // Cumulative label-arrival counters (unbounded, monotonic) for header/cards.
        counts: {
          queries: scan.queries,
          results: scan.results,
          sources: scan.sources,
          fetches: scan.fetches,
          failures: scan.failures,
        },
        real: Object.assign({}, m.metrics),
      },
      counts: {
        calls: m.calls.length,
        pages: m.pageTotal,
        pagesRendered: m.renderPages.length,
        activities: m.activities.length,
      },
      size: { width: state.cssW, height: state.cssH, dpr: state.dpr },
      layout: state.layout ? { portrait: state.layout.H > state.layout.W * 1.06, gutter: state.layout.gutter } : null,
      reducedMotion: state.reducedMotion,
    };
  }

  /* ------------------------------------------------------------- public */
  state.reducedMotion = opts.reducedMotion;
  if (typeof win.matchMedia === 'function') {
    try {
      const motionQuery = win.matchMedia('(prefers-reduced-motion: reduce)');
      if (motionQuery && motionQuery.matches) state.reducedMotion = true;
    } catch (error) {
      /* ignore */
    }
  }
  rebuildLayout();
  draw();
  if (rafLoop) state.raf = raf(frame);

  return {
    el: canvas,
    canvas: canvas,
    setData: setData,
    push: push,
    resize: resize,
    destroy: destroy,
    snapshot: snapshot,
    getState: getState,
    onFrame: addListener,
    meta: SC.meta,
  };
}
