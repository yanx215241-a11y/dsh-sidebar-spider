#!/usr/bin/env node
/**
 * build-widget.mjs — assembles spider-embed/spider-widget.js.
 *
 * The component reuses the vendored Canvas-2D drawing modules instead of
 * re-implementing them. This script reads those modules (vendored at
 * vendor/canvas-engine; see engine-lock.json for file hashes),
 * strips the ESM import/export syntax, wraps each module in a namespace IIFE and
 * concatenates our composition (src/widget.js) + a UMD-ish export footer.
 *
 * Inputs:
 *   <vendor>/app/spider.js      -> SV.spider   (drawSpider, legPose, heartbeatAt)
 *   <vendor>/app/probes.js      -> SV.probes   (drawProbes, probePose, PROBE_TIMING)
 *   <vendor>/app/live-layout.js -> SV.layout   (livePose, alpha, PAGE_SIZE, ...)
 *   <vendor>/app/orbit.js       -> SV.orbit    (drawOrbit, orbitNodes)
 *   <vendor>/app/motion.js      -> SV.motion   (cubicPoint only; extraction verified)
 *   src/widget.js                               -> createSpiderView()
 *
 * Usage: node build/build-widget.mjs [--out path] [--check]
 *   --check  verify engine module hashes + rebuild in memory, report size, write nothing.
 */
import { readFile, writeFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const ROOT = resolve(HERE, '..');
const REPO = process.env.SPIDER_ENGINE_DIR
  ? resolve(process.env.SPIDER_ENGINE_DIR)
  : resolve(ROOT, '..', 'vendor', 'canvas-engine');
const LOCK_PATH = join(HERE, 'engine-lock.json');
const WIDGET_SRC = join(ROOT, 'src', 'widget.js');
const DEFAULT_OUT = join(ROOT, 'spider-widget.js');

const argv = process.argv.slice(2);
const checkOnly = argv.includes('--check');
const outIdx = argv.indexOf('--out');
const OUT = outIdx >= 0 && argv[outIdx + 1] ? resolve(argv[outIdx + 1]) : DEFAULT_OUT;

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/** Remove ESM import lines and the `export ` prefix; assert expected symbols exist. */
function stripEsm(source, path, required) {
  const imports = source.match(/^import .*?;$/gm) || [];
  let body = source.replace(/^import .*?;$/gm, '');
  body = body.replace(/^export (const|function|class|let|var) /gm, '$1 ');
  if (/^\s*(import|export)\b/m.test(body)) throw new Error(`${path}: ESM syntax left after strip`);
  for (const symbol of required) {
    const re = new RegExp(`^(?:async )?function ${symbol}\\b|^(?:const|let|var) ${symbol}\\b`, 'm');
    if (!re.test(body)) throw new Error(`${path}: expected symbol "${symbol}" not found`);
  }
  return { body: body.trim(), imports };
}

/** Extract one function by name using brace matching (used for app/motion.js). */
function extractFunction(source, name) {
  const re = new RegExp(`^export function ${name}\\(`, 'm');
  const m = re.exec(source);
  if (!m) throw new Error(`motion.js: function "${name}" not found`);
  const start = m.index;
  let i = source.indexOf('{', start);
  let depth = 0;
  let inSingle = false, inDouble = false, inTemplate = false, inLine = false, inBlock = false;
  for (; i < source.length; i++) {
    const ch = source[i], prev = source[i - 1], next = source[i + 1];
    if (inLine) { if (ch === '\n') inLine = false; continue; }
    if (inBlock) { if (ch === '*' && next === '/') { inBlock = false; i++; } continue; }
    if (inSingle) { if (ch === '\\') i++; else if (ch === "'") inSingle = false; continue; }
    if (inDouble) { if (ch === '\\') i++; else if (ch === '"') inDouble = false; continue; }
    if (inTemplate) { if (ch === '\\') i++; else if (ch === '`') inTemplate = false; continue; }
    if (ch === '/' && next === '/') { inLine = true; i++; continue; }
    if (ch === '/' && next === '*') { inBlock = true; i++; continue; }
    if (ch === "'") { inSingle = true; continue; }
    if (ch === '"') { inDouble = true; continue; }
    if (ch === '`') { inTemplate = true; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) { let end = i + 1; if (source[end] === ';') end++; return source.slice(start, end).replace(/^export /, '').trim(); } }
  }
  throw new Error(`motion.js: unterminated function "${name}"`);
}

function wrapNamespace(name, body, exportsList) {
  return `SV.${name} = (function () {\n'use strict';\n${body}\nreturn { ${exportsList.join(', ')} };\n})();`;
}

async function build() {
  const lockRaw = (await readFile(LOCK_PATH, 'utf8')).replace(/^\uFEFF/, '');
  const lock = JSON.parse(lockRaw);
  const widgetBody = (await readFile(WIDGET_SRC, 'utf8')).trim();

  const parts = [];
  const deltas = [];

  const modules = [
    {
      key: 'spider', file: 'app/spider.js',
      exports: ['heartbeatAt', 'legPose', 'drawSpider'],
      note: 'verbatim body, ESM import/export shell removed',
    },
    {
      key: 'probes', file: 'app/probes.js',
      exports: ['PROBE_TIMING', 'probePose', 'drawProbes'],
      note: 'verbatim body, ESM shell removed',
    },
    {
      key: 'layout', file: 'app/live-layout.js',
      exports: ['PAGE_SIZE', 'LIVE_LAYOUTS', 'livePose', 'alpha', 'eventPlacement', 'hitEvent', 'routeTarget'],
      note: 'verbatim body (only livePose/alpha/PAGE_SIZE are used by the compact composition)',
    },
    {
      key: 'orbit', file: 'app/orbit.js',
      exports: ['orbitNodes', 'drawOrbit'],
      note: 'verbatim body; reused as the optional "orbit" view',
    },
  ];

  for (const mod of modules) {
    const expected = lock.files[mod.file];
    if (!expected) throw new Error(`lock file missing entry for ${mod.file}`);
    const buf = await readFile(join(REPO, mod.file));
    const actual = sha256(buf);
    if (actual !== expected.sha256) {
      throw new Error(`engine module drift: ${mod.file}\n  expected ${expected.sha256}\n  actual   ${actual}\n  (refresh build/engine-lock.json after an intentional engine change)`);
    }
    const { body, imports } = stripEsm(buf.toString('utf8'), mod.file, mod.exports);
    if (imports.length) throw new Error(`${mod.file}: unexpected imports: ${imports.join(' | ')}`);
    let patchedBody = body;
    if (mod.key === 'orbit') {
      // Narrow sidebars cannot fit engine's default eight orbit labels; add an
      // optional maxLabels cap (default 8 keeps engine behaviour unchanged).
      // Documented delta — see INTEGRATION.md "engine deltas".
      const before = patchedBody;
      patchedBody = patchedBody
        .replace('selected = null, theme, colors} = {}', 'selected = null, theme, colors, maxLabels = 8} = {}')
        .replace("labels++ < (query ? 12 : 8)", "labels++ < (query ? 12 : maxLabels)");
      if (patchedBody === before) throw new Error('app/orbit.js: compact-label patch site moved; update build transform');
      deltas.push('app/orbit.js: added optional maxLabels cap (narrow-sidebar label limit)');
    }
    parts.push(wrapNamespace(mod.key, patchedBody, mod.exports));
    deltas.push(`${mod.file}: ${mod.note}`);
  }

  // app/motion.js cannot be shipped whole (it binds reference-track data), so we
  // extract only the pure cubic helper the flight particles need.
  const motionSrc = (await readFile(join(REPO, 'app/motion.js'))).toString('utf8');
  const motionHash = sha256(Buffer.from(motionSrc));
  if (motionHash !== lock.files['app/motion.js'].sha256) throw new Error('engine module drift: app/motion.js');
  const cubicPoint = extractFunction(motionSrc, 'cubicPoint');
  parts.push(`SV.motion = (function () {\n'use strict';\n${cubicPoint}\nreturn { cubicPoint };\n})();`);
  deltas.push('app/motion.js: extracted cubicPoint() only (reference-track-bound functions dropped)');

  const banner = [
    '/*!',
    ' * spider-widget.js — self-contained Canvas-2D spider view for DSH web-research activity.',
    ' *',
    ' * Canvas 2D rendering: prompt-spider-ui (MIT, Copyright (c) 2026 Kirito14IT)',
    ' *   https://github.com/Kirito14IT/prompt-spider-ui @ f6522df29739ccc4861c1227601980b88265923d',
    ' * DSH plugin, composition and subsequent modifications:',
    ' *   Copyright (c) 2026 yanx215241-a11y — MIT licensed.',
    ' *',
    ' * Generated by embed/build/build-widget.mjs — do not edit dist by hand.',
    ' * See /NOTICE.md and /plugin/lib/THIRD_PARTY_LICENSES.txt for details.',
    ' */',
  ].join('\n');

  const header = `(function (root) {\n'use strict';\nconst SV = { meta: ${JSON.stringify({
    name: 'spider-widget',
    version: '1.0.0',
    engine: 'canvas-engine',
    license: 'MIT',
  })} };\n`;

  const footer = `\nif (root) root.createSpiderView = createSpiderView;\nif (typeof module !== 'undefined' && module && module.exports) module.exports = { createSpiderView: createSpiderView, meta: SV.meta };\n})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);\n`;

  const source = [
    banner,
    header,
    '/* ==== engine: app/spider.js (verbatim) ==== */',
    parts[0],
    '/* ==== engine: app/probes.js (verbatim) ==== */',
    parts[1],
    '/* ==== engine: app/live-layout.js (verbatim) ==== */',
    parts[2],
    '/* ==== engine: app/orbit.js (verbatim) ==== */',
    parts[3],
    '/* ==== engine: app/motion.js (cubicPoint only) ==== */',
    parts[4],
    '/* ==== spider-embed composition (src/widget.js) ==== */',
    widgetBody,
    footer,
  ].join('\n');

  const bytes = Buffer.byteLength(source);
  const digest = sha256(Buffer.from(source));
  const manifest = {
    name: 'spider-widget',
    version: '1.0.0',
    generatedBy: 'spider-embed/build/build-widget.mjs',
    engine: 'canvas-engine',
    inputs: deltas,
    bytes,
    sha256: digest,
    exports: ['createSpiderView'],
  };

  if (checkOnly) {
    console.log(`ok: would write ${OUT} (${bytes} bytes, sha256 ${digest.slice(0, 16)}…)`);
    return { source, manifest, bytes, digest };
  }
  await writeFile(OUT, source);
  await writeFile(join(HERE, 'widget-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`wrote ${OUT}`);
  console.log(`  ${bytes} bytes  sha256 ${digest}`);
  for (const d of deltas) console.log(`  reuse  ${d}`);
  return { source, manifest, bytes, digest };
}

build().catch((error) => {
  console.error('BUILD FAILED:', error.message);
  process.exitCode = 1;
});
