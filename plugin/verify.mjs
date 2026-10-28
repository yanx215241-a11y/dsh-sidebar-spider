#!/usr/bin/env node
/**
 * Offline verification for the Sidebar Spider client plugin.
 *
 * Loads the generated lazy-CJS bundle in a Node VM with a stubbed DSH shell
 * (`window.__ModuleLoader__`, React from the installed app's shared tree) and a
 * stubbed Cordis context that records the seats the plugin takes. Then it feeds
 * realistic `tool/call` / `tool/result` events through the same event window
 * shape the real client uses and asserts the widget-event history, the tab
 * registration, auto-open behaviour and a server-side body render.
 *
 * Run:  node verify.mjs
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUNDLE = path.resolve(__dirname, "lib/client.js");
// react + react-dom/server are only needed by this offline verifier (the plugin
// itself takes React from the DSH shell at runtime). Install matching versions at
// the repo root (npm install), or point DSH_REACT_ROOT at a directory whose
// node_modules provides them (e.g. the DSH desktop app's bundled tree).
const localRequire = createRequire(path.join(__dirname, "package.json"));

function loadShared(name) {
  try {
    return localRequire(name);
  } catch (error) {
    /* fall through to DSH_REACT_ROOT */
  }
  const root = process.env.DSH_REACT_ROOT;
  if (root) {
    try {
      return createRequire(path.join(root, "noop.js"))(name);
    } catch (error) {
      /* fall through to the helpful error */
    }
  }
  throw new Error(
    "verify.mjs needs '" + name + "'. Run 'npm install' at the repo root or set DSH_REACT_ROOT to a directory that provides react + react-dom/server."
  );
}
const React = loadShared("react");
const { renderToStaticMarkup } = loadShared("react-dom/server");

const failures = [];
const notes = [];
function check(name, condition, detail) {
  if (condition) {
    notes.push(`  ok   ${name}`);
  } else {
    failures.push(`  FAIL ${name}${detail === undefined ? "" : " — " + detail}`);
  }
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function observable(initial) {
  const listeners = new Set();
  let value = initial;
  return {
    getSnapshot: () => value,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(next) {
      value = next;
      for (const listener of Array.from(listeners)) listener();
    }
  };
}

/* ------------------------------------------------------------------ shell */

const bundleSource = fs.readFileSync(BUNDLE, "utf8");
let syntaxError = null;
try {
  new vm.Script(bundleSource, { filename: "client.js" });
} catch (error) {
  syntaxError = error;
}
check("bundle parses as a classic script", syntaxError === null, syntaxError && syntaxError.message);

const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, "package.json"), "utf8"));
let loaded = null;
const windowStub = {
  __ModuleLoader__: {
    load(entry) {
      loaded = entry;
    }
  },
  location: { href: "http://127.0.0.1:4846/" },
  open() {}
};

const sandbox = {
  window: windowStub,
  console: { log: () => {}, warn: () => {}, error: () => {} },
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  fetch: () => Promise.reject(new Error("collector not running in offline verification")),
  performance: { now: () => Date.now() },
  navigator: { language: "zh-CN" },
  ResizeObserver: undefined
};
sandbox.globalThis = sandbox;
sandbox.self = sandbox;
vm.createContext(sandbox);
vm.runInContext(bundleSource, sandbox, { filename: "client.js" });

check("bundle registered exactly one module", loaded !== null);
check("bundle id equals package name", loaded !== null && loaded.id === pkg.name, loaded && loaded.id);

/* ------------------------------------------------------------- fake host */

const SESSION = "session-verify-1";
const events = [];
const eventSource = observable({ entries: [], hasMore: false, revision: 0 });
const session = observable({ sessionId: SESSION, running: true });

const binding = { sessionId: SESSION, session, eventSource, ctx: undefined };

const tabs = new Map();
const bodies = new Map();
const disposers = [];
const openCalls = [];
const mounted = observable(undefined);
const openTabs = observable([]);

const ctx = {
  effect(factory) {
    const dispose = factory();
    if (typeof dispose === "function") disposers.push(dispose);
    return dispose;
  },
  locale: {
    bind: (ns) => (key) => key,
    register: () => () => {}
  },
  sidebarRightTabs: {
    register(definition) {
      if (definition === null || typeof definition !== "object" || typeof definition.id !== "string") {
        throw new Error("bad tab definition");
      }
      if (tabs.has(definition.kind)) throw new Error("duplicate kind " + definition.kind);
      tabs.set(definition.kind, definition);
      return () => tabs.delete(definition.kind);
    },
    get(kind) {
      return tabs.get(kind);
    }
  },
  slots: {
    inject(name, callback) {
      return callback();
    },
    register(definition, Body) {
      bodies.set(definition.key, { definition, Body });
      return () => bodies.delete(definition.key);
    }
  },
  sessions: {
    binding(id) {
      return id === SESSION ? binding : undefined;
    }
  },
  sidebarRight: {
    mounted,
    openTabs,
    openTab(kind, options) {
      openCalls.push({ kind, options });
      const rows = openTabs.getSnapshot().concat([{ sessionId: mounted.getSnapshot(), kind, tabId: "tab-" + kind }]);
      openTabs.set(rows);
      return "tab-" + kind;
    }
  }
};

const exportsObject = loaded.factory((name) => {
  if (name === "react") return React;
  throw new Error("unexpected require: " + name);
});

check("bundle exports apply()", typeof exportsObject.apply === "function");
check(
  "bundle injects the required services",
  Array.isArray(exportsObject.inject) &&
    ["slots", "locale", "sidebarRight", "sidebarRightTabs", "sessions"].every((name) => exportsObject.inject.includes(name)),
  JSON.stringify(exportsObject.inject)
);

exportsObject.apply(ctx);

/* ------------------------------------------------------------- assertions */

const spider = tabs.get("spider");
check("tab type 'spider' registered", spider !== undefined);
check("tab type id equals package name", spider !== undefined && spider.id === pkg.name, spider && spider.id);
check("tab type title() works", spider !== undefined && typeof spider.title === "function" && spider.title() === "tab.title");
check(
  "guide entry registered",
  spider !== undefined && Array.isArray(spider.guide) && spider.guide.length === 1 && typeof spider.guide[0].title === "function",
  spider && JSON.stringify(spider.guide)
);
check("body registered for keyed seat", bodies.has(pkg.name));

const bodyEntry = bodies.get(pkg.name);
check(
  "body slot name/key",
  bodyEntry !== undefined && bodyEntry.definition.name === "sidebar.right.pane.tab" && bodyEntry.definition.key === pkg.name
);

const injected = bodyEntry.definition.inject(SESSION, {});
check("body inject publishes useSpiderFeed hook", injected !== undefined && injected.hooks !== undefined && typeof injected.hooks.spiderFeed.subscribe === "function");
check("body inject publishes openUrl", injected !== undefined && typeof injected.openUrl === "function");
check("body inject publishes the fullscreen expander", injected !== undefined && typeof injected.expand === "function");

const feed = injected.hooks.spiderFeed;

function emit(event) {
  event.seq = events.length + 1;
  events.push(event);
  eventSource.set({ entries: events.map((evt) => ({ type: "event", event: evt })), hasMore: false, revision: events.length });
}

emit({
  type: "tool/call",
  time: Date.now(),
  data: { turn: 1, step: 1, callId: "call-1", name: "web_search", arguments: JSON.stringify({ queries: ["dsh client plugin", "deepseek harness"] }) }
});
emit({
  type: "tool/result",
  time: Date.now(),
  data: {
    turn: 1,
    step: 1,
    message: {
      role: "tool",
      toolCallId: "call-1",
      source: { kind: "tool", callId: "call-1" },
      content: [{ type: "text", text: "2 results" }]
    },
    meta: {
      sources: [
        { url: "https://a.example/docs", title: "A docs", snippet: "snippet a" },
        { url: "https://b.example/blog", title: "B blog", snippet: "snippet b" }
      ],
      truncated: false
    }
  }
});
emit({
  type: "tool/call",
  time: Date.now(),
  data: { turn: 1, step: 2, callId: "call-2", name: "web_fetch", arguments: JSON.stringify({ url: "https://a.example/docs" }) }
});
emit({
  type: "tool/result",
  time: Date.now(),
  data: {
    turn: 1,
    step: 2,
    message: { role: "tool", toolCallId: "call-2", source: { kind: "tool", callId: "call-2" }, content: [{ type: "text", text: "Example Domain — This domain is for use in illustrative examples in documents. You may use this domain in literature without prior coordination." }] },
    meta: { url: "https://a.example/docs", statusCode: 200, truncated: false }
  }
});

// A non-web tool call + result must be ignored by the web-research fold.
emit({
  type: "tool/call",
  time: Date.now(),
  data: { turn: 1, step: 3, callId: "call-pwsh", name: "pwsh", arguments: JSON.stringify({ command: "dir" }) }
});
emit({
  type: "tool/result",
  time: Date.now(),
  data: {
    turn: 1,
    step: 3,
    message: { role: "tool", toolCallId: "call-pwsh", source: { kind: "tool", callId: "call-pwsh" }, content: [{ type: "text", text: "ok" }] },
    meta: { exitCode: 0, durationMs: 12 }
  }
});

const snapshot = feed.getSnapshot();
const types = snapshot.history.map((event) => event.type);
check("feed folded the two web calls", snapshot.calls.length === 2, String(snapshot.calls.length));
check("feed metrics: queries/fetches/results/failures", snapshot.metrics.queries === 1 && snapshot.metrics.fetches === 1 && snapshot.metrics.results === 2 && snapshot.metrics.failures === 0, JSON.stringify(snapshot.metrics));
check("feed keeps structured calls", snapshot.calls.some((call) => call.tool === "web_search" && call.resultCount === 2 && call.queries.length === 2) && snapshot.calls.some((call) => call.tool === "web_fetch" && call.httpStatus === 200), JSON.stringify(snapshot.calls));
check("feed keeps activities for the dashboard", Array.isArray(snapshot.activities) && snapshot.activities.length >= 3, String(snapshot.activities.length));
check("feed has session.start", types.includes("session.start"), types.join(","));
check("feed has search tool.start", types.includes("tool.start"), types.join(","));
check("feed has 2 search sources", snapshot.pages.length === 2, JSON.stringify(snapshot.pages.map((page) => page.id)));
check(
  "search page carries title + completed status",
  snapshot.pages.some((page) => page.id === "https://b.example/blog" && page.title === "B blog" && page.status === "completed" && page.route === "code") &&
    snapshot.pages.some((page) => page.id === "https://a.example/docs" && page.title === "A docs"),
  JSON.stringify(snapshot.pages)
);
check(
  "fetch page completed with HTTP detail",
  snapshot.pages.some((page) => page.id === "https://a.example/docs" && page.route === "model" && page.status === "completed" && page.detail === "HTTP 200"),
  JSON.stringify(snapshot.pages)
);
check(
  "search call keeps result titles for the dashboard",
  snapshot.calls.some((call) => call.tool === "web_search" && call.resultTitles.length === 2 && call.resultTitles[0] === "A docs"),
  JSON.stringify(snapshot.calls.map((call) => ({ tool: call.tool, titles: call.resultTitles })))
);
check(
  "fetch call keeps the crawled page excerpt",
  snapshot.calls.some((call) => call.tool === "web_fetch" && typeof call.excerpt === "string" && call.excerpt.includes("Example Domain")),
  JSON.stringify(snapshot.calls.map((call) => ({ tool: call.tool, excerpt: (call.excerpt || "").slice(0, 40) })))
);
check(
  "pages expose excerpts for the scene",
  snapshot.pages.some((page) => page.id === "https://b.example/blog" && typeof page.excerpt === "string" && page.excerpt.includes("snippet b")) &&
    snapshot.pages.some((page) => page.id === "https://a.example/docs" && typeof page.excerpt === "string" && page.excerpt.includes("Example Domain")),
  JSON.stringify(snapshot.pages.map((page) => (page.excerpt || "").slice(0, 30)))
);check("feed has page events", types.some((type) => type.startsWith("page.")), types.join(","));
check("non-web tool results are ignored", snapshot.calls.length === 2 && !snapshot.calls.some((call) => call.id === "call-pwsh") && snapshot.pages.length === 2, JSON.stringify(snapshot.calls.map((call) => call.id)));
check("feed has tool.end for both calls", types.filter((type) => type === "tool.end").length === 2, types.join(","));

const observed = [];
const unsubscribe = feed.subscribe(() => observed.push(feed.getSnapshot().version));
emit({
  type: "tool/call",
  time: Date.now(),
  data: { turn: 1, step: 3, callId: "call-3", name: "web_search", arguments: JSON.stringify({ queries: ["third query"] }) }
});
check("feed notifies subscribers on new events", observed.length >= 1, String(observed.length));
unsubscribe();

/* ---------------------------------------------------------- auto-open */

mounted.set(SESSION);
await sleep(1300);
check(
  "auto-opens the spider tab once web research starts",
  openCalls.some((call) => call.kind === "spider"),
  JSON.stringify(openCalls)
);
mounted.set(SESSION);
await sleep(1300);
check("does not reopen the tab for the same session", openCalls.filter((call) => call.kind === "spider").length === 1);
openTabs.set([]);
await sleep(1300);
check("stays quiet after the user closes the tab (no reopen loop)", openCalls.filter((call) => call.kind === "spider").length === 1, String(openCalls.length));

/* ------------------------------------------------------------- render */

function useSpiderFeed(selector) {
  return React.useSyncExternalStore(
    feed.subscribe,
    () => selector(feed.getSnapshot()),
    () => selector(feed.getSnapshot())
  );
}
const props = {
  sessionId: SESSION,
  useTabInfo: () => ({ tab: { id: "t", kind: "spider", navigation: { params: { auto: true } } } }),
  useSpiderFeed,
  t: (key) => key,
  openUrl: () => {}
};
let html = "";
let renderError = null;
try {
  html = renderToStaticMarkup(React.createElement(bodyEntry.Body, props));
} catch (error) {
  renderError = error;
}
check("tab body renders without a browser", renderError === null, renderError && (renderError.stack || renderError.message));
check("body markup is a host element", typeof html === "string" && html.length > 0, String(html && html.length));

/* ------------------------------------------------------------ disposal */

let disposeError = null;
try {
  while (disposers.length > 0) {
    const dispose = disposers.pop();
    if (typeof dispose === "function") dispose();
  }
} catch (error) {
  disposeError = error;
}
check("disposal is clean", disposeError === null, disposeError && disposeError.message);

/* -------------------------------------------------------------- report */

console.log(notes.join("\n"));
if (failures.length > 0) {
  console.error(failures.join("\n"));
  console.error(`\n${failures.length} check(s) failed.`);
  process.exit(1);
}
console.log(`\nAll ${notes.length} checks passed.`);
