/* ============================================================================
 * fake-dom.mjs — tiny DOM/canvas test harness for spider-widget (Node only).
 *
 * Headless Chrome cannot run inside the DSH workspace-write sandbox (its
 * multi-process IPC needs named pipes, which are denied), so this harness
 * replaces the browser for automated verification:
 *   - a minimal fake Document/Element (appendChild, classList, style, events,
 *     getBoundingClientRect, listener bookkeeping)
 *   - a manually stepped requestAnimationFrame + controllable performance clock
 *   - a recording CanvasRenderingContext2D stub (op log, used by
 *     verify-widget.mjs) or, when a real canvas backend is supplied, a real
 *     Skia-backed context (used by render-canvas.mjs for visual inspection)
 *
 * The widget source is loaded with node:vm into a fake global object, so no
 * browser or jsdom is required.
 * ========================================================================= */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

export function createRecordingContext() {
  const ops = [];
  const props = {};
  const gradients = {
    createLinearGradient(...args) {
      ops.push({ kind: 'method', method: 'createLinearGradient', args });
      return { addColorStop: (...stop) => ops.push({ kind: 'method', method: 'addColorStop', args: stop }) };
    },
    createRadialGradient(...args) {
      ops.push({ kind: 'method', method: 'createRadialGradient', args });
      return { addColorStop: (...stop) => ops.push({ kind: 'method', method: 'addColorStop', args: stop }) };
    },
  };
  const ctx = new Proxy({}, {
    get(target, key) {
      if (key in props) return props[key];
      if (key === 'measureText') {
        return (value) => {
          const text = String(value == null ? '' : value);
          const sizeMatch = /(\d+(?:\.\d+)?)px/.exec(String(props.font || ''));
          const size = sizeMatch ? Number(sizeMatch[1]) : 10;
          const width = text.length * size * 0.62;
          ops.push({ kind: 'method', method: 'measureText', args: [text], width });
          return { width };
        };
      }
      if (key in gradients) return gradients[key];
      if (key === 'getImageData') return () => ({ data: [] });
      if (typeof key === 'string') {
        return (...args) => {
          ops.push({ kind: 'method', method: key, args });
          return undefined;
        };
      }
      return undefined;
    },
    set(target, key, value) {
      props[key] = value;
      ops.push({ kind: 'set', prop: String(key), value });
      return true;
    },
  });
  return { ctx, ops, props };
}

class FakeStyle {
  constructor() {
    this.props = Object.create(null);
  }
  setProperty(name, value) {
    this.props[name] = String(value);
  }
  getPropertyValue(name) {
    return this.props[name] == null ? '' : this.props[name];
  }
  removeProperty(name) {
    delete this.props[name];
  }
}

class FakeClassList {
  constructor(element) {
    this.element = element;
  }
  _set() {
    return new Set(String(this.element._className || '').split(/\s+/).filter(Boolean));
  }
  _write(set) {
    this.element._className = Array.from(set).join(' ');
  }
  toggle(name, force) {
    const set = this._set();
    const on = force === undefined ? !set.has(name) : Boolean(force);
    if (on) set.add(name);
    else set.delete(name);
    this._write(set);
    return on;
  }
  add(name) {
    const set = this._set();
    set.add(name);
    this._write(set);
  }
  remove(name) {
    const set = this._set();
    set.delete(name);
    this._write(set);
  }
  contains(name) {
    return this._set().has(name);
  }
}

class FakeElement {
  constructor(tagName, doc) {
    this.tagName = String(tagName).toUpperCase();
    this.ownerDocument = doc;
    this.children = [];
    this.parentNode = null;
    this.style = new FakeStyle();
    this.classList = new FakeClassList(this);
    this.attributes = Object.create(null);
    this.listeners = new Map();
    this._textContent = '';
    this._className = '';
    this._rect = { x: 0, y: 0, width: 0, height: 0, left: 0, top: 0 };
    this.hidden = false;
    this.title = '';
    this.id = '';
    this.type = '';
    this.disabled = false;
    this.tabIndex = 0;
  }
  get className() {
    return this._className;
  }
  set className(value) {
    this._className = String(value == null ? '' : value);
  }
  get textContent() {
    return this._textContent;
  }
  set textContent(value) {
    this._textContent = String(value == null ? '' : value);
    if (value === '') this.children.length = 0;
  }
  appendChild(child) {
    if (child.parentNode) child.parentNode.removeChildNode(child);
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  removeChildNode(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    child.parentNode = null;
  }
  removeChild(child) {
    this.removeChildNode(child);
    return child;
  }
  remove() {
    if (this.parentNode) this.parentNode.removeChildNode(this);
  }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }
  getAttribute(name) {
    return name in this.attributes ? this.attributes[name] : null;
  }
  removeAttribute(name) {
    delete this.attributes[name];
  }
  addEventListener(type, handler) {
    const key = String(type);
    if (!this.listeners.has(key)) this.listeners.set(key, new Set());
    this.listeners.get(key).add(handler);
    if (this.ownerDocument && this.ownerDocument.__listenerLog) {
      this.ownerDocument.__listenerLog.push({ target: this, type: key, action: 'add' });
    }
  }
  removeEventListener(type, handler) {
    const key = String(type);
    const set = this.listeners.get(key);
    if (set) set.delete(handler);
    if (this.ownerDocument && this.ownerDocument.__listenerLog) {
      this.ownerDocument.__listenerLog.push({ target: this, type: key, action: 'remove' });
    }
  }
  fire(type, event) {
    const set = this.listeners.get(String(type));
    if (!set) return 0;
    let count = 0;
    for (const handler of Array.from(set)) {
      handler(event || {});
      count += 1;
    }
    return count;
  }
  dispatchEvent(event) {
    return this.fire(event && event.type, event);
  }
  getBoundingClientRect() {
    return this._rect;
  }
  setRect(rect) {
    this._rect = Object.assign({ x: 0, y: 0, left: 0, top: 0 }, rect);
    if (this._rect.x !== undefined) this._rect.left = this._rect.x;
    if (this._rect.y !== undefined) this._rect.top = this._rect.y;
    return this._rect;
  }
  scrollIntoView() {}
  focus() {}
  blur() {}
  setPointerCapture() {}
  releasePointerCapture() {}
  hasPointerCapture() {
    return false;
  }
}

class FakeCanvasElement extends FakeElement {
  constructor(doc, backend) {
    super('canvas', doc);
    this._backend = backend;
    this._width = 0;
    this._height = 0;
  }
  get width() {
    return this._width;
  }
  set width(value) {
    this._width = Math.max(1, Math.round(Number(value) || 1));
    if (this._backend) this._backend.resize(this._width, this._height);
  }
  get height() {
    return this._height;
  }
  set height(value) {
    this._height = Math.max(1, Math.round(Number(value) || 1));
    if (this._backend) this._backend.resize(this._width, this._height);
  }
  getContext(type) {
    if (type !== '2d') return null;
    return this._backend ? this._backend.ctx : null;
  }
  toDataURL(mime) {
    if (this._backend && this._backend.toDataURL) return this._backend.toDataURL(mime || 'image/png');
    return 'data:image/png;base64,FAKE-CANVAS';
  }
}

class FakeObserver {
  constructor(callback) {
    this.callback = callback;
    this.targets = [];
    this.connected = true;
  }
  observe(target) {
    this.targets.push(target);
  }
  unobserve(target) {
    this.targets = this.targets.filter((item) => item !== target);
  }
  disconnect() {
    this.connected = false;
    this.targets.length = 0;
  }
  trigger() {
    if (!this.connected) return;
    this.callback(this.targets.map((target) => ({ target, isIntersecting: true })), this);
  }
}

/**
 * @param {object} root0
 * @param {object} [root0.backend] real canvas backend {ctx,resize,toDataURL,getCanvas}
 */
export function createHarness(root0 = {}) {
  const recorder = root0.backend ? null : createRecordingContext();
  const ops = recorder ? recorder.ops : [];
  const activeBackend = root0.backend || {
    ctx: recorder.ctx,
    resize() {},
    toDataURL() {
      return 'data:image/png;base64,FAKE-CANVAS';
    },
  };
  const clock = { ms: 1_000_000 };
  const warnings = [];
  const log = [];
  const raf = new Map();
  let rafSeq = 1;
  const windowListeners = new Map();
  const observers = { resizes: [], intersections: [] };

  const doc = {
    hidden: false,
    __listenerLog: log,
    createElement(tag) {
      if (String(tag).toLowerCase() === 'canvas') return new FakeCanvasElement(doc, activeBackend);
      return new FakeElement(tag, doc);
    },
    defaultView: null,
    addEventListener() {},
    removeEventListener() {},
  };

  const sandbox = {
    console: {
      warn: (...args) => warnings.push(args.map(String).join(' ')),
      error: (...args) => warnings.push('ERROR ' + args.map(String).join(' ')),
      log: () => {},
      info: () => {},
    },
    document: doc,
    performance: { now: () => clock.ms },
    devicePixelRatio: root0.dpr == null ? 2 : root0.dpr,
    requestAnimationFrame(handler) {
      const id = rafSeq++;
      raf.set(id, handler);
      return id;
    },
    cancelAnimationFrame(id) {
      raf.delete(id);
    },
    matchMedia(query) {
      return {
        matches: Boolean(root0.reducedMotion),
        media: String(query),
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
      };
    },
    ResizeObserver: class extends FakeObserver {
      constructor(callback) {
        super(callback);
        observers.resizes.push(this);
      }
    },
    IntersectionObserver: class extends FakeObserver {
      constructor(callback, options) {
        super((entries) => callback(entries, this));
        this.entries = [{ isIntersecting: true }];
        observers.intersections.push(this);
      }
      observe(target) {
        this.targets.push(target);
        this.callback([{ target, isIntersecting: true }], this);
      }
    },
    addEventListener(type, handler) {
      const key = String(type);
      if (!windowListeners.has(key)) windowListeners.set(key, new Set());
      windowListeners.get(key).add(handler);
    },
    removeEventListener(type, handler) {
      const key = String(type);
      const set = windowListeners.get(key);
      if (set) set.delete(handler);
    },
    getComputedStyle() {
      return { getPropertyValue: () => '' };
    },
    URL,
  };

  vm.createContext(sandbox);

  const container = new FakeElement('div', doc);
  const size = {
    width: root0.width == null ? 380 : root0.width,
    height: root0.height == null ? 700 : root0.height,
    stageWidth: root0.stageWidth == null ? root0.width == null ? 380 : root0.width : root0.stageWidth,
    stageHeight: root0.stageHeight == null ? Math.max(160, (root0.height == null ? 700 : root0.height) * 0.5) : root0.stageHeight,
  };
  container.setRect({ width: size.width, height: size.height });

  const harness = {
    sandbox,
    doc,
    container,
    clock,
    ops,
    warnings,
    log,
    observers,
    raf,
    size,
    loadWidget(sourcePath) {
      const source = readFileSync(sourcePath, 'utf8');
      vm.runInContext(source, sandbox, { filename: sourcePath });
      if (typeof sandbox.createSpiderView !== 'function') throw new Error('widget did not expose createSpiderView');
      return sandbox.createSpiderView;
    },
    run(sourcePath, options) {
      const create = harness.loadWidget(sourcePath);
      harness.view = create(container, options);
      harness.findRoot();
      harness.applyLayout();
      return harness.view;
    },
    applyLayout() {
      if (!harness.root) return;
      harness.root.setRect({ width: size.width, height: size.height });
      if (harness.stage) {
        harness.stage.setRect({ width: size.stageWidth, height: size.stageHeight });
        const canvas = findFirst(harness.stage, (el) => el.tagName === 'CANVAS');
        if (canvas) canvas.setRect({ width: size.stageWidth, height: size.stageHeight });
      }
    },
    setSize(next) {
      if (next.width != null) size.width = next.width;
      if (next.height != null) size.height = next.height;
      if (next.stageWidth != null) size.stageWidth = next.stageWidth;
      else if (next.width != null) size.stageWidth = next.width;
      if (next.stageHeight != null) size.stageHeight = next.stageHeight;
      else if (next.height != null) size.stageHeight = Math.max(160, next.height * 0.5);
      container.setRect({ width: size.width, height: size.height });
      if (next.dpr != null) sandbox.devicePixelRatio = next.dpr;
      harness.applyLayout();
    },
    findRoot() {
      const found = container.children.find((child) => child.getAttribute('data-spider-view') !== null);
      if (!found) return null;
      harness.root = found;
      harness.stage = findFirst(found, (el) => el.className.indexOf('sv-stage') >= 0);
      return found;
    },
    step(frames = 1, deltaMs = 16.6667) {
      const due = [];
      for (const [id, handler] of raf) {
        raf.delete(id);
        due.push(handler);
      }
      for (const handler of due) {
        clock.ms += deltaMs;
        try {
          handler(clock.ms);
        } catch (error) {
          warnings.push('RAF ERROR: ' + error.stack);
          throw error;
        }
      }
    },
    /** advance virtual time by ms, stepping ~60fps frames */
    advance(ms, deltaMs = 16.6667) {
      let advanced = 0;
      while (advanced < ms) {
        harness.step(1, deltaMs);
        advanced += deltaMs;
      }
      return advanced;
    },
    triggerResize() {
      for (const observer of observers.resizes) observer.trigger();
    },
    listenerCount(type) {
      const set = windowListeners.get(String(type));
      return set ? set.size : 0;
    },
    /** fire a canvas click at CSS coordinates (canvas rect assumed 0,0,w,h) */
    clickCanvas(x, y) {
      const canvas = findFirst(harness.root || container, (el) => el.tagName === 'CANVAS');
      if (!canvas) return 0;
      return canvas.fire('click', { clientX: x, clientY: y, button: 0, pointerId: 1 });
    },
    find(className) {
      return findAll(harness.root || container, (el) => (' ' + el.className + ' ').indexOf(' ' + className + ' ') >= 0);
    },
    textOf(el) {
      return el ? el.textContent : '';
    },
  };

  // initial stage rect: the canvas stage is the flexible middle band; tests can
  // override it through setSize() to mimic the real flex layout.
  return harness;
}

function walk(element, visit) {
  visit(element);
  for (const child of element.children) walk(child, visit);
}
function findFirst(root, predicate) {
  let found = null;
  walk(root, (element) => {
    if (!found && predicate(element)) found = element;
  });
  return found;
}
function findAll(root, predicate) {
  const found = [];
  walk(root, (element) => {
    if (predicate(element)) found.push(element);
  });
  return found;
}
