/**
 * Sidebar Spider — browser half of the DSH client plugin.
 *
 * Registered by build.mjs inside the shipped lazy-CJS bundle wrapper:
 *
 *   window.__ModuleLoader__.load({ id, factory: (require) => {
 *     var module = { exports: {} }; var exports = module.exports;
 *     <this file, with `require` available>
 *     exports.apply = apply; exports.inject = inject; return module.exports;
 *   }})
 *
 * Two presentations share one live feed:
 *   - compact widget  (SPIDER.createSpiderView)  when the panel is narrow
 *   - dashboard scene (SPIDER_SCENE.createSpiderScene) when the panel is wide
 *     (the right sidebar's fullscreen mode → the upstream prompt-spider-ui
 *     style "检索大屏")
 *
 * Live data: ctx.sessions.binding(sessionId).eventSource is the same event
 * window the built-in conversation UI folds. We translate
 *   tool/call   {name:"web_search", arguments:'{"queries":[...]}'}
 *   tool/call   {name:"web_fetch",  arguments:'{"url":"..."}'}
 *   tool/result {message:{source:{callId}}, meta:{sources:[...] | url+statusCode}}
 * into a structured research model plus the compact widget's event protocol.
 */
const react = require("react");

/** Package identity: also the tab type id, guide id namespace and bundle id. */
const PLUGIN_ID = "dsh-client-ui-sidebar-spider";
/** Tab kind: the page address is `sidebar://spider`. */
const KIND = "spider";
/** Locale namespace. */
const NS = "sidebarSpider";
/** Local verification collector (see collector.mjs). Absent in normal use. */
const DIAG_ORIGIN = "http://127.0.0.1:4780";
/** Maximum widget events kept per session feed (oldest dropped, epoch bumps). */
const FEED_CAPACITY = 1200;
/** Widest compact layout; beyond this the dashboard scene is used. */
const SCENE_MIN_WIDTH = 720;

const zh = {
  "tab.title": "蛛网",
  "tab.description": "实时展示智能体的网页检索轨迹（可全屏看大屏版）",
  "guide.title": "蛛网",
  "empty.title": "还没有网页检索",
  "empty.hint": "让智能体搜索或抓取网页，这里会实时画出检索网络。",
  "fallback.error": "蛛网渲染失败，已回退到列表视图",
  "expand": "展开大屏",
  "expand.title": "全屏查看检索大屏",
  "label.search": "搜索",
  "label.fetch": "抓取"
};

const en = {
  "tab.title": "Spider",
  "tab.description": "Live view of the agent's web research (fullscreen dashboard)",
  "guide.title": "Spider",
  "empty.title": "No web research yet",
  "empty.hint": "Ask the agent to search or fetch pages; its web is drawn here live.",
  "fallback.error": "Spider render failed; fell back to the list view",
  "expand": "Dashboard",
  "expand.title": "Open the research dashboard fullscreen",
  "label.search": "search",
  "label.fetch": "fetch"
};

/* ------------------------------------------------------------------ utils */

function safeParseJson(text) {
  if (typeof text !== "string" || text.length === 0) return undefined;
  try {
    return JSON.parse(text);
  } catch (error) {
    return undefined;
  }
}

function contentText(content) {
  if (!Array.isArray(content)) return "";
  const parts = [];
  for (const block of content) {
    if (block !== null && typeof block === "object" && block.type === "text" && typeof block.text === "string") {
      parts.push(block.text);
    }
  }
  return parts.join("\n");
}

function excerptOf(text, limit) {
  const flat = String(text || "").replace(/\s+/g, " ").trim();
  if (flat.length === 0) return "";
  return flat.length > limit ? flat.slice(0, limit) + "…" : flat;
}

/** Strip DSH's web_fetch wrapper text so the excerpt is the page itself. */
function fetchExcerpt(text) {
  const flat = String(text || "").replace(/^Fetched\s+\S+.*?Treat it as[^.]*\.\s*/s, "").replace(/\s+/g, " ").trim();
  return excerptOf(flat, 360);
}

function detectLocale() {
  try {
    return typeof navigator !== "undefined" && /^en/i.test(navigator.language || "") ? "en" : "zh";
  } catch (error) {
    return "zh";
  }
}

function hostOf(url) {
  try {
    const parsed = new URL(url);
    return parsed.host;
  } catch (error) {
    return String(url || "").replace(/^https?:\/\//, "").split("/")[0];
  }
}

/* ------------------------------------------------------- verification diag */

let diagAlive = false;
let diagResolve;
const diagReady = new Promise((resolve) => {
  diagResolve = resolve;
});

function diagInit(payload) {
  try {
    fetch(DIAG_ORIGIN + "/health", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : undefined))
      .then((body) => {
        if (body !== undefined && body !== null && body.ok === true) {
          diagAlive = true;
          diagSend(payload);
        }
        diagResolve(diagAlive);
      })
      .catch(() => diagResolve(false));
  } catch (error) {
    diagResolve(false);
  }
}

function diagSend(payload) {
  if (!diagAlive) return;
  try {
    fetch(DIAG_ORIGIN + "/report", {
      method: "POST",
      mode: "cors",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    }).catch(() => {});
  } catch (error) {
    /* diagnostics only */
  }
}

/* ------------------------------------------------------------- live feed */

/**
 * Fold one Session's event window into the research model consumed by both
 * presentations. Same source the built-in conversation/tool UI folds.
 */
function createFeed(ctx, sessionId) {
  const listeners = new Set();
  const seenSeqs = new Set();
  const calls = new Map();
  const pages = new Map();
  const activities = [];
  let history = [];
  let epoch = 0;
  let version = 0;
  let running = false;
  let started = false;
  let disposed = false;
  let startedAt = Date.now();
  const metrics = { queries: 0, results: 0, fetches: 0, failures: 0, events: 0 };
  let snapshot;

  const publish = () => {
    version += 1;
    metrics.sources = 0;
    for (const page of pages.values()) if (page.route === "code") metrics.sources += 1;
    metrics.events = history.length;
    snapshot = Object.freeze({
      version,
      epoch,
      sessionId,
      running,
      status: running ? "live" : "done",
      startedAt,
      history,
      pages: Array.from(pages.values()),
      calls: Array.from(calls.values()),
      activities: activities.slice(),
      metrics: Object.assign({}, metrics)
    });
    for (const listener of Array.from(listeners)) {
      try {
        listener();
      } catch (error) {
        console.error("[sidebar-spider] feed listener failed:", error);
      }
    }
  };

  const ensureSnapshot = () => {
    if (snapshot === undefined) publish();
    return snapshot;
  };

  const record = (event) => {
    history.push(event);
    if (history.length > FEED_CAPACITY) {
      history = history.slice(history.length - Math.floor(FEED_CAPACITY * 0.75));
      epoch += 1;
    }
  };

  const activity = (kind, label, route) => {
    activities.push({ at: Date.now(), kind, label: String(label || "").slice(0, 160), route: route || "" });
    if (activities.length > 200) activities.splice(0, activities.length - 200);
  };

  const upsertPage = (page) => {
    const previous = pages.get(page.id);
    pages.set(page.id, Object.assign({}, previous, page, {
      title: page.title !== undefined && page.title !== "" ? page.title : previous !== undefined ? previous.title : page.url,
      detail: page.detail !== undefined ? page.detail : previous !== undefined ? previous.detail : "",
      firstAt: previous !== undefined ? previous.firstAt : Date.now(),
      updatedAt: Date.now()
    }));
  };

  const take = (event) => {
    if (event === null || typeof event !== "object") return;
    if (typeof event.seq === "number") {
      if (seenSeqs.has(event.seq)) return;
      seenSeqs.add(event.seq);
    }
    const data = event.data !== null && typeof event.data === "object" ? event.data : {};

    if (event.type === "tool/call") {
      const name = typeof data.name === "string" ? data.name : "";
      if (name !== "web_search" && name !== "web_fetch") return;
      const callId = data.callId !== undefined && data.callId !== null ? String(data.callId) : "";
      const args = safeParseJson(data.arguments);
      const queries =
        args !== undefined && Array.isArray(args.queries) ? args.queries.filter((query) => typeof query === "string") : [];
      const url = args !== undefined && typeof args.url === "string" ? args.url : "";
      const call = {
        id: callId,
        tool: name,
        label: name === "web_search" ? queries.join(" / ") : hostOf(url),
        queries,
        url,
        status: "running",
        startedAt: Date.now(),
        endedAt: null,
        resultCount: 0,
        httpStatus: null,
        resultTitles: [],
        excerpt: ""
      };
      calls.set(callId, call);
      if (name === "web_search") {
        metrics.queries += 1;
        record({ type: "tool.start", id: callId, tool: "web_search", query: queries.join(" | ") });
        activity("search", queries.join(" / ") || "web_search", "code");
      } else {
        metrics.fetches += 1;
        record({ type: "tool.start", id: callId, tool: "web_fetch", url });
        activity("fetch", hostOf(url), "model");
        if (url !== "") {
          upsertPage({ id: url, url, route: "model", status: "running" });
          record({ type: "page.add", id: url, url, route: "model", status: "running" });
        }
      }
      return;
    }

    if (event.type === "tool/result") {
      const message = data.message !== null && typeof data.message === "object" ? data.message : {};
      const source = message.source !== null && typeof message.source === "object" ? message.source : {};
      const callId =
        source.callId !== undefined && source.callId !== null
          ? String(source.callId)
          : message.toolCallId !== undefined && message.toolCallId !== null
            ? String(message.toolCallId)
            : "";
      const call = calls.get(callId);
      const meta = data.meta !== null && typeof data.meta === "object" ? data.meta : undefined;
      const failed = message.isError === true || (data.error !== undefined && data.error !== null);
      const metaIsSearch =
        meta !== undefined && Array.isArray(meta.sources) && meta.sources.some((entry) => entry !== null && typeof entry === "object" && typeof entry.url === "string");
      const metaIsFetch = meta !== undefined && typeof meta.statusCode === "number" && typeof meta.url === "string";
      // Ignore every non-web tool result (the event window carries all tools).
      if (call === undefined && !metaIsSearch && !metaIsFetch) return;
      let sources = [];

      if (metaIsSearch) {
        sources = meta.sources.filter((entry) => entry !== null && typeof entry === "object" && typeof entry.url === "string");
        metrics.results += sources.length;
        const titles = [];
        for (const entry of sources) {
          const title = typeof entry.title === "string" && entry.title.trim() !== "" ? entry.title.trim() : entry.url;
          const detail = typeof entry.snippet === "string" ? entry.snippet : "";
          titles.push(title);
          upsertPage({ id: entry.url, url: entry.url, title, route: "code", status: "completed", detail, excerpt: detail });
          record({ type: "page.add", id: entry.url, url: entry.url, title, route: "code", status: "completed", detail });
        }
        if (call !== undefined) call.resultTitles = titles.slice(0, 5);
        activity("result", sources.length + " results", "code");
      }

      let httpStatus = null;
      let pageExcerpt = "";
      if (metaIsFetch) {
        httpStatus = meta.statusCode;
        const ok = meta.statusCode >= 200 && meta.statusCode < 400;
        const status = ok ? "completed" : "failed";
        pageExcerpt = fetchExcerpt(contentText(message.content));
        upsertPage({ id: meta.url, url: meta.url, route: "model", status, detail: "HTTP " + meta.statusCode, excerpt: pageExcerpt });
        record({ type: "page." + status, id: meta.url, url: meta.url, route: "model", status, detail: "HTTP " + meta.statusCode });
        if (!ok) metrics.failures += 1;
        if (call !== undefined) call.excerpt = pageExcerpt;
        activity(ok ? "result" : "fail", hostOf(meta.url) + " · HTTP " + meta.statusCode, ok ? "model" : "you");
      }

      if (failed) metrics.failures += 1;

      if (call !== undefined) {
        call.status = failed ? "failed" : "completed";
        call.endedAt = Date.now();
        if (sources.length > 0) call.resultCount = sources.length;
        if (httpStatus !== null) call.httpStatus = httpStatus;
      } else if (metaIsSearch || metaIsFetch) {
        calls.set(callId !== "" ? callId : "res-" + String(event.seq), {
          id: callId !== "" ? callId : "res-" + String(event.seq),
          tool: metaIsSearch ? "web_search" : "web_fetch",
          label: metaIsSearch ? sources.length + " results" : hostOf(meta.url || ""),
          queries: [],
          url: typeof meta.url === "string" ? meta.url : "",
          status: failed ? "failed" : "completed",
          startedAt: Date.now(),
          endedAt: Date.now(),
          resultCount: sources.length,
          httpStatus,
          resultTitles: metaIsSearch ? sources.map((entry) => (typeof entry.title === "string" && entry.title.trim() !== "" ? entry.title.trim() : entry.url)).slice(0, 5) : [],
          excerpt: metaIsSearch ? "" : fetchExcerpt(contentText(message.content))
        });
      }

      if (call !== undefined || metaIsSearch || metaIsFetch) {
        record({ type: "tool.end", id: callId !== "" ? callId : "res-" + String(event.seq), status: failed ? "failed" : "completed" });
      }
      return;
    }

    if (event.type === "turn/start") {
      record({ type: "agent.step", text: "turn " + String(data.turn !== undefined ? data.turn : "") });
      activity("start", "turn " + String(data.turn !== undefined ? data.turn : ""), "you");
    }
  };

  const ingestWindow = () => {
    const binding = ctx.sessions.binding(sessionId);
    if (binding === undefined) return false;
    let changed = false;
    try {
      const window_ = binding.eventSource.getSnapshot();
      const entries = window_ !== undefined && Array.isArray(window_.entries) ? window_.entries : [];
      for (const entry of entries) {
        if (entry === null || typeof entry !== "object" || entry.type === "transient") continue;
        take(entry.event);
      }
      changed = true;
      const nextRunning = binding.session.getSnapshot().running === true;
      if (nextRunning !== running) {
        running = nextRunning;
        changed = true;
      }
    } catch (error) {
      console.warn("[sidebar-spider] could not read session window:", error);
    }
    return changed;
  };

  const bind = () => {
    const binding = ctx.sessions.binding(sessionId);
    if (binding === undefined) return false;
    if (!started) {
      started = true;
      startedAt = Date.now();
      record({ type: "session.start", sessionId, title: "DSH web research" });
      activity("start", "session", "you");
    }
    try {
      running = binding.session.getSnapshot().running === true;
    } catch (error) {
      running = false;
    }
    const unsubscribeRun = binding.session.subscribe(() => {
      if (disposed) return;
      let next = false;
      try {
        next = binding.session.getSnapshot().running === true;
      } catch (error) {
        next = false;
      }
      if (next === running) return;
      running = next;
      if (!next) record({ type: "session.done" });
      publish();
    });
    const unsubscribeEvents = binding.eventSource.subscribe(() => {
      if (disposed) return;
      if (ingestWindow()) publish();
    });
    ingestWindow();
    return () => {
      try {
        unsubscribeRun();
      } catch (error) {
        /* ignore */
      }
      try {
        unsubscribeEvents();
      } catch (error) {
        /* ignore */
      }
    };
  };

  let unbind = () => {};

  const source = {
    getSnapshot: ensureSnapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      if (started === false) {
        const result = bind();
        if (typeof result === "function") unbind = result;
        publish();
      }
      return () => {
        listeners.delete(listener);
      };
    }
  };

  const result = bind();
  if (typeof result === "function") unbind = result;
  publish();

  return {
    source,
    dispose() {
      disposed = true;
      listeners.clear();
      try {
        unbind();
      } catch (error) {
        /* ignore */
      }
    }
  };
}

/** Scene model consumed by `SPIDER_SCENE.createSpiderScene`. */
function buildSceneModel(snapshot) {
  if (snapshot === undefined || snapshot === null) {
    return { status: "idle", startedAt: Date.now(), now: Date.now(), metrics: { queries: 0, results: 0, fetches: 0, failures: 0, events: 0, sources: 0 }, calls: [], pages: [], activities: [] };
  }
  return {
    status: snapshot.running === true ? "live" : snapshot.calls.length === 0 ? "idle" : "done",
    sessionId: snapshot.sessionId,
    startedAt: snapshot.startedAt,
    now: Date.now(),
    metrics: snapshot.metrics,
    calls: snapshot.calls.map((call) => ({
      id: call.id,
      tool: call.tool,
      label: call.label,
      queries: call.queries,
      url: call.url,
      status: call.status,
      startedAt: call.startedAt,
      endedAt: call.endedAt,
      resultCount: call.resultCount,
      httpStatus: call.httpStatus,
      resultTitles: call.resultTitles || [],
      excerpt: call.excerpt || ""
    })),
    pages: snapshot.pages.map((page) => ({
      id: page.id,
      url: page.url,
      title: page.title,
      route: page.route,
      status: page.status,
      detail: page.detail,
      excerpt: page.excerpt || page.detail || "",
      firstAt: page.firstAt,
      updatedAt: page.updatedAt
    })),
    activities: snapshot.activities
  };
}

/* ----------------------------------------------------------- tab body UI */

function statusDot(color) {
  return react.createElement("span", {
    style: {
      display: "inline-block",
      width: "6px",
      height: "6px",
      borderRadius: "50%",
      background: color,
      flex: "0 0 auto"
    }
  });
}

/** Minimal fallback list, used only when the canvas views cannot start. */
function FallbackList(props) {
  const { snap, t } = props;
  if (snap === undefined || snap.pages.length === 0) {
    return react.createElement(
      "div",
      { style: { padding: "18px 12px", opacity: 0.7 } },
      react.createElement("div", null, t("empty.title")),
      react.createElement("div", { style: { marginTop: "6px" } }, t("empty.hint"))
    );
  }
  return react.createElement(
    "div",
    { style: { display: "flex", flexDirection: "column", gap: "8px", padding: "12px" } },
    snap.pages
      .slice()
      .reverse()
      .map((page) =>
        react.createElement(
          "div",
          {
            key: page.id,
            style: {
              border: "0.5px solid rgba(255,255,255,.16)",
              borderRadius: "8px",
              padding: "8px 10px",
              display: "flex",
              flexDirection: "column",
              gap: "4px",
              minWidth: 0
            }
          },
          react.createElement(
            "div",
            { style: { display: "flex", alignItems: "center", gap: "6px", minWidth: 0 } },
            statusDot(page.status === "failed" ? "#f23c83" : page.status === "running" ? "#f4cf4d" : "#48d7a6"),
            react.createElement(
              "span",
              { style: { fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } },
              page.title
            )
          ),
          react.createElement(
            "div",
            { style: { opacity: 0.72, overflowWrap: "anywhere" } },
            page.detail !== "" ? page.detail : page.url
          )
        )
      )
  );
}

const expandButtonStyle = {
  position: "absolute",
  bottom: "8px",
  left: "8px",
  zIndex: 3,
  cursor: "pointer",
  border: "0.5px solid rgba(255,255,255,.18)",
  borderRadius: "6px",
  background: "rgba(16,16,19,.72)",
  color: "#e8e8e9",
  font: "10px/1.2 Consolas, 'Microsoft YaHei UI', monospace",
  padding: "3px 7px",
  letterSpacing: ".4px"
};

function SpiderBody(props) {
  const { sessionId, useTabInfo, useSpiderFeed, t, openUrl, expand, bestModel } = props;
  try {
    useTabInfo();
  } catch (error) {
    /* the hook is optional for our rendering */
  }
  const snap = useSpiderFeed((value) => value);
  const snapRef = react.useRef(snap);
  snapRef.current = snap;
  const hostRef = react.useRef(null);
  const viewRef = react.useRef(null);
  const modeRef = react.useRef("compact");
  const cursorRef = react.useRef({ epoch: -1, index: 0 });
  const [mode, setMode] = react.useState("compact");
  const [failure, setFailure] = react.useState(null);
  const [mounted, setMounted] = react.useState(false);

  // Track the panel width: narrow → compact widget, wide → dashboard scene.
  react.useEffect(() => {
    const host = hostRef.current;
    if (host === null) return undefined;
    const measure = () => {
      const width = host.clientWidth || 0;
      const next = width >= SCENE_MIN_WIDTH && SPIDER_SCENE !== null && SPIDER_SCENE !== undefined ? "scene" : "compact";
      if (next !== modeRef.current) {
        modeRef.current = next;
        setMode(next);
      }
    };
    measure();
    let observer = null;
    try {
      if (typeof ResizeObserver !== "undefined") {
        observer = new ResizeObserver(measure);
        observer.observe(host);
      }
    } catch (error) {
      observer = null;
    }
    try {
      window.addEventListener("resize", measure);
    } catch (error) {
      /* ignore */
    }
    return () => {
      if (observer !== null) observer.disconnect();
      try {
        window.removeEventListener("resize", measure);
      } catch (error) {
        /* ignore */
      }
    };
  }, []);

  // Create the active canvas view; destroy it on mode change / unmount.
  react.useEffect(() => {
    const host = hostRef.current;
    if (host === null) return undefined;
    cursorRef.current = { epoch: -1, index: 0 };
    setFailure(null);
    let view = null;
    try {
      if (mode === "scene" && SPIDER_SCENE !== null && SPIDER_SCENE !== undefined) {
        view = SPIDER_SCENE.createSpiderScene(host, {
          locale: detectLocale(),
          maxPages: 120
        });
      } else {
        view = SPIDER.createSpiderView(host, {
          title: "WEB SPIDER",
          locale: detectLocale(),
          showViewToggle: true,
          maxPages: 80,
          onSelect: (page) => {
            if (page !== null && typeof page.url === "string" && page.url !== "" && typeof openUrl === "function") openUrl(page.url);
          }
        });
      }
      viewRef.current = view;
      setMounted(true);
    } catch (error) {
      console.error("[sidebar-spider] canvas view failed:", error);
      setFailure(String((error !== null && error !== undefined && error.message) || error));
    }
    let resizeObserver = null;
    try {
      if (typeof ResizeObserver !== "undefined") {
        resizeObserver = new ResizeObserver(() => {
          try {
            if (viewRef.current !== null) viewRef.current.resize();
          } catch (error) {
            /* ignore */
          }
        });
        resizeObserver.observe(host);
      }
    } catch (error) {
      resizeObserver = null;
    }
    return () => {
      if (resizeObserver !== null) resizeObserver.disconnect();
      if (view !== null) {
        try {
          view.destroy();
        } catch (error) {
          /* ignore */
        }
      }
      viewRef.current = null;
      setMounted(false);
    };
  }, [mode]);

  // Push state into the active view: scene gets the whole model, the compact
  // widget gets incremental event replay.
  react.useEffect(() => {
    const view = viewRef.current;
    if (view === null || snap === undefined || snap === null) return;
    try {
      if (mode === "scene" && typeof view.setData === "function") {
        view.setData(buildSceneModel(snap));
        return;
      }
      const cursor = cursorRef.current;
      if (snap.epoch !== cursor.epoch) {
        cursor.epoch = snap.epoch;
        cursor.index = 0;
        view.push({ type: "session.reset" });
      }
      if (cursor.index < snap.history.length) {
        view.push(snap.history.slice(cursor.index));
        cursor.index = snap.history.length;
      }
    } catch (error) {
      console.warn("[sidebar-spider] pushing live state failed:", error);
    }
  }, [snap, mode]);

  // Verification captures (real browser pixels). Only active while a local
  // collector answers /health; invisible otherwise.
  react.useEffect(() => {
    if (!mounted) return undefined;
    const timers = new Set();
    let attempts = 0;
    let pngCount = 0;

    const capture = (label) => {
      try {
        const view = viewRef.current;
        if (view === null) return;
        attempts += 1;
        try {
          view.resize();
        } catch (error) {
          /* ignore */
        }
        const canvas = view.canvas;
        let ink = 0;
        let sample = null;
        try {
          const context = canvas.getContext("2d");
          const width = canvas.width;
          const height = canvas.height;
          const data = context.getImageData(0, 0, width, height).data;
          let painted = 0;
          let total = 0;
          for (let index = 0; index < data.length; index += 4 * 32) {
            total += 1;
            if (data[index + 3] !== 0 && (data[index] !== 255 || data[index + 1] !== 255 || data[index + 2] !== 255)) painted += 1;
          }
          ink = total === 0 ? 0 : painted / total;
          const middle = (Math.floor(height / 2) * width + Math.floor(width / 2)) * 4;
          sample = [data[middle], data[middle + 1], data[middle + 2], data[middle + 3]];
        } catch (error) {
          sample = "err:" + String((error !== null && error !== undefined && error.message) || error);
        }
        let state;
        try {
          state = view.getState();
        } catch (error) {
          state = undefined;
        }
        const doc = typeof document !== "undefined" ? document : undefined;
        diagSend({
          kind: "panel." + mode + "." + label,
          attempt: attempts,
          sessionId,
          mode,
          pages: snapRef.current === undefined ? 0 : snapRef.current.pages.length,
          calls: snapRef.current === undefined ? 0 : snapRef.current.calls.length,
          widgetStatus: state === undefined ? undefined : state.status,
          statusCounts: state === undefined ? undefined : state.statusCounts,
          canvas: { width: canvas.width, height: canvas.height },
          ink,
          sample,
          visibility: doc === undefined ? "?" : doc.visibilityState,
          png: pngCount < 3 && ink > 0.002 ? canvas.toDataURL("image/png") : undefined
        });
        if (pngCount < 3 && ink > 0.002) pngCount += 1;
      } catch (error) {
        diagSend({ kind: "panel." + label, error: String((error !== null && error !== undefined && error.message) || error) });
      }
    };

    const schedule = (delay, label) => {
      const timer = setTimeout(() => {
        timers.delete(timer);
        capture(label);
      }, delay);
      timers.add(timer);
    };
    diagReady.then((alive) => {
      if (!alive) return;
      schedule(1200, "mounted");
      schedule(4000, "check2");
      schedule(9000, "check3");
      schedule(16000, "check4");
      previewScene();
    });

    // Offscreen dashboard render at 1280x800 with the live model — proves the
    // full-screen scene draws real pixels inside the running app.
    const previewScene = () => {
      if (SPIDER_SCENE === null || SPIDER_SCENE === undefined) return;
      const timer = setTimeout(() => {
        timers.delete(timer);
        const model = typeof bestModel === "function" ? bestModel() : buildSceneModel(snapRef.current);
        const frames = [
          { label: "t0", animationTime: 1.2 },
          { label: "t1", animationTime: 2.9 },
          { label: "t2", animationTime: 6.0 },
          { label: "scrollA", animationTime: 6.0 },
          { label: "scrollB", animationTime: 6.6 },
          { label: "late", animationTime: 9.0 }
        ];
        for (const frame of frames) {
          let offscreen = null;
          let preview = null;
          try {
            offscreen = document.createElement("div");
            offscreen.style.cssText = "position:fixed;left:-12000px;top:0;width:1280px;height:800px;overflow:hidden;";
            document.body.appendChild(offscreen);
            preview = SPIDER_SCENE.createSpiderScene(offscreen, {
              locale: detectLocale(),
              maxPages: 120,
              animationTime: frame.animationTime
            });
            preview.setData(model);
            const png = preview.snapshot();
            diagSend({
              kind: "scene.preview." + frame.label,
              animationTime: frame.animationTime,
              pages: snapRef.current === undefined ? 0 : snapRef.current.pages.length,
              calls: snapRef.current === undefined ? 0 : snapRef.current.calls.length,
              canvas: { width: preview.canvas.width, height: preview.canvas.height },
              png
            });
          } catch (error) {
            diagSend({ kind: "scene.preview.error", animationTime: frame.animationTime, error: String((error && error.message) || error) });
          } finally {
            try {
              if (preview !== null) preview.destroy();
            } catch (error) {
              /* ignore */
            }
            try {
              if (offscreen !== null) offscreen.remove();
            } catch (error) {
              /* ignore */
            }
          }
        }
      }, 2400);
      timers.add(timer);
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") capture("visible");
    };
    try {
      if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
        document.addEventListener("visibilitychange", onVisibility);
      }
    } catch (error) {
      /* ignore */
    }

    return () => {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      try {
        if (typeof document !== "undefined" && typeof document.removeEventListener === "function") {
          document.removeEventListener("visibilitychange", onVisibility);
        }
      } catch (error) {
        /* ignore */
      }
    };
  }, [mounted, mode]);

  const hostStyle = {
    position: "relative",
    flex: "1 1 auto",
    width: "100%",
    height: "100%",
    minHeight: "220px",
    minWidth: 0,
    display: "flex"
  };

  const showExpand = mode === "compact" && typeof expand === "function";

  return react.createElement(
    "div",
    { style: hostStyle },
    react.createElement("div", { ref: hostRef, style: { position: "absolute", inset: 0, display: "flex" } }),
    showExpand
      ? react.createElement(
          "button",
          {
            type: "button",
            title: t("expand.title"),
            style: expandButtonStyle,
            onClick: () => {
              try {
                expand();
              } catch (error) {
                console.warn("[sidebar-spider] expand failed:", error);
              }
            }
          },
          "⤢ " + t("expand")
        )
      : null,
    failure === null
      ? null
      : react.createElement(
          "div",
          { style: { position: "absolute", inset: 0, overflow: "auto" } },
          react.createElement("div", { style: { padding: "8px 12px", opacity: 0.7 } }, t("fallback.error") + ": " + failure),
          react.createElement(FallbackList, { snap, t })
        )
  );
}

/* --------------------------------------------------------------- plugin */

/** Cordis service names this plugin requires before `apply` runs. */
const inject = ["slots", "locale", "sidebarRight", "sidebarRightTabs", "sessions"];

function apply(ctx) {
  const t = ctx.locale.bind(NS);
  const feeds = new Map();

  const feedFor = (sessionId) => {
    let feed = feeds.get(sessionId);
    if (feed === undefined) {
      feed = createFeed(ctx, sessionId);
      feeds.set(sessionId, feed);
    }
    return feed;
  };

  /** Create feeds for a few recent/running sessions so the verification preview
   *  can show real research data even when the on-screen session has none. */
  const ensurePreviewFeeds = () => {
    if (!diagAlive) return false;
    try {
      const list = ctx.sessions.list.getSnapshot();
      const rows = [];
      for (const id of list.ids || []) {
        const row = list.byId === undefined ? undefined : list.byId[id];
        if (row !== undefined && row !== null) rows.push(row);
      }
      rows.sort((a, b) => (b.running === true ? 1 : 0) - (a.running === true ? 1 : 0) || (b.updatedAt || 0) - (a.updatedAt || 0));
      let created = false;
      for (const row of rows.slice(0, 3)) {
        if (!feeds.has(row.id)) {
          feedFor(row.id);
          created = true;
        }
      }
      return created;
    } catch (error) {
      return false;
    }
  };

  /** Best model across sessions (used by the dashboard verification preview). */
  const bestModel = () => {
    ensurePreviewFeeds();
    let best;
    for (const feed of feeds.values()) {
      const candidate = feed.source.getSnapshot();
      if (candidate === undefined || candidate === null) continue;
      if (best === undefined || candidate.pages.length > best.pages.length) best = candidate;
    }
    return buildSceneModel(best);
  };

  const openUrl = (url) => {
    if (typeof url !== "string" || url === "") return;
    try {
      if (ctx.sidebarRightTabs.get("browser") !== undefined) {
        ctx.sidebarRight.openTab("browser", { params: { url }, revealIfOpened: false });
        return;
      }
    } catch (error) {
      console.warn("[sidebar-spider] sidebar browser unavailable:", error);
    }
    try {
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (error) {
      /* popup blocked: ignore */
    }
  };

  /** Expand the sidebar panel to its fullscreen presentation (dashboard). */
  const expand = () => {
    try {
      const target = ctx.sidebarRight.commandTarget(null);
      if (target === undefined) {
        console.warn("[sidebar-spider] no sidebar pane to expand");
        return;
      }
      ctx.sidebarRight.toggleFullscreen(target);
    } catch (error) {
      console.warn("[sidebar-spider] fullscreen toggle failed:", error);
    }
  };

  ctx.effect(() => () => {
    for (const feed of feeds.values()) feed.dispose();
    feeds.clear();
  }, "sidebar-spider: feeds");

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), "sidebar-spider: copy");

  // Phase 1: declare the tab type + its guide entry.
  ctx.effect(
    () =>
      ctx.sidebarRightTabs.register({
        id: PLUGIN_ID,
        kind: KIND,
        title: () => t("tab.title"),
        guide: [
          {
            id: "spider",
            order: 41,
            title: () => t("guide.title"),
            description: () => t("tab.description")
          }
        ]
      }),
    "sidebar-spider: tab type"
  );

  // Phase 2: body for the keyed `sidebar.right.pane.tab` seat.
  ctx.effect(
    () =>
      ctx.slots.inject("sidebar.right.pane.tab", () =>
        ctx.slots.register(
          {
            name: "sidebar.right.pane.tab",
            key: PLUGIN_ID,
            locale: NS,
            inject: (sessionId) => ({
              hooks: { spiderFeed: feedFor(sessionId).source },
              bestModel,
              openUrl,
              expand
            })
          },
          SpiderBody
        )
      ),
    "sidebar-spider: body"
  );

  // Auto-open once per session as soon as that session performs web research,
  // so the sidebar reflects the search live without the user hunting for it.
  ctx.effect(() => {
    const opened = new Set();
    let timer = null;
    let disposed = false;

    const tick = () => {
      if (disposed) return;
      let sessionId;
      try {
        sessionId = ctx.sidebarRight.mounted.getSnapshot();
      } catch (error) {
        return;
      }
      if (sessionId === undefined || sessionId === null || opened.has(sessionId)) return;
      let snapshot;
      try {
        snapshot = feedFor(sessionId).source.getSnapshot();
      } catch (error) {
        return;
      }
      if (snapshot === undefined || snapshot.calls.length === 0) return;
      let isOpen = false;
      try {
        const rows = ctx.sidebarRight.openTabs.getSnapshot();
        isOpen = rows.some((row) => row.sessionId === sessionId && row.kind === KIND);
      } catch (error) {
        isOpen = false;
      }
      if (isOpen) {
        opened.add(sessionId);
        return;
      }
      try {
        ctx.sidebarRight.openTab(KIND, { params: { auto: true }, revealIfOpened: false });
        opened.add(sessionId);
        console.log("[sidebar-spider] auto-opened for session", sessionId);
      } catch (error) {
        /* session surface not ready yet; retry on the next tick */
      }
    };

    let unsubscribeMounted = () => {};
    try {
      unsubscribeMounted = ctx.sidebarRight.mounted.subscribe(() => tick());
    } catch (error) {
      unsubscribeMounted = () => {};
    }
    timer = setInterval(tick, 1000);
    tick();

    return () => {
      disposed = true;
      if (timer !== null) clearInterval(timer);
      try {
        unsubscribeMounted();
      } catch (error) {
        /* ignore */
      }
    };
  }, "sidebar-spider: auto open");

  // Verification hook: only reports when the local collector is running.
  diagInit({
    kind: "plugin.loaded",
    plugin: PLUGIN_ID,
    kindRegistered: (() => {
      try {
        return ctx.sidebarRightTabs.get(KIND) !== undefined;
      } catch (error) {
        return false;
      }
    })(),
    sceneAvailable: SPIDER_SCENE !== null && SPIDER_SCENE !== undefined,
    location: (() => {
      try {
        return String(window.location.href).slice(0, 160);
      } catch (error) {
        return "";
      }
    })()
  });
}

exports.apply = apply;
exports.inject = inject;
