#!/usr/bin/env node
/**
 * build-scene.mjs — assembles spider-scene/scene.js.
 *
 * Same delivery model as embed/build/build-widget.mjs: the dashboard reuses the
 * vendored Canvas-2D drawing modules instead of re-implementing them. This script
 * reads those modules (vendored at vendor/canvas-engine, hashes below), strips the
 * ESM import/export shell, wraps each module in a namespace IIFE, and concatenates
 * the dashboard composition
 * (src/scene-dashboard.js) + a UMD-ish export footer.
 *
 * Inputs:
 *   <vendor>/app/spider.js      -> SC.spider   (drawSpider, legPose, heartbeatAt)
 *   <vendor>/app/probes.js      -> SC.probes   (drawProbes, probePose, PROBE_TIMING)
 *   <vendor>/app/live-layout.js -> SC.layout   (livePose, alpha, ...)
 *   <vendor>/app/motion.js      -> SC.motion   (cubicPoint only, verified extraction)
 *   src/scene-dashboard.js                      -> createSpiderScene()
 *
 * Usage: node build/build-scene.mjs [--out path] [--check]
 *   --check  verify engine module hashes + rebuild in memory, report size, write nothing.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const ROOT = resolve(HERE, '..');
const REPO = process.env.SPIDER_ENGINE_DIR
  ? resolve(process.env.SPIDER_ENGINE_DIR)
  : resolve(ROOT, '..', 'vendor', 'canvas-engine');
const COMPOSITION = join(ROOT, 'src', 'scene-dashboard.js');
const DEFAULT_OUT = join(ROOT, 'scene.js');

const argv = process.argv.slice(2);
const checkOnly = argv.includes('--check');
const outIdx = argv.indexOf('--out');
const OUT = outIdx >= 0 && argv[outIdx + 1] ? resolve(argv[outIdx + 1]) : DEFAULT_OUT;

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

// SHA-256 pins for the vendored Canvas engine modules (vendor/canvas-engine).
const ENGINE = {
  files: {
    'app/spider.js': 'bff247e0de977b0b61f35389796d71ea41f67a76109a302f524361087c20076e',
    'app/probes.js': 'b9221828a6beefb3f698dbc7eff237ed8c07f9025c5b09cf6014a68d21cb843a',
    'app/live-layout.js': '2d63b83dca209de1903f56784795031ca9a744195d33a8984eaa955d0911dca1',
    'app/motion.js': '37604f460a747f4eea6cd4086cfad7a08be3181376cfd05747d94b118d7b4b1b',
  },
};

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
    const ch = source[i], next = source[i + 1];
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
  return `SC.${name} = (function () {\n'use strict';\n${body}\nreturn { ${exportsList.join(', ')} };\n})();`;
}

async function build() {
  const composition = (await readFile(COMPOSITION, 'utf8')).trim();
  const parts = [];
  const deltas = [];
  const modules = [
    { key: 'spider', file: 'app/spider.js', exports: ['heartbeatAt', 'legPose', 'drawSpider'], note: 'verbatim body, ESM import/export shell removed' },
    { key: 'probes', file: 'app/probes.js', exports: ['PROBE_TIMING', 'probePose', 'drawProbes'], note: 'verbatim body, ESM shell removed' },
    { key: 'layout', file: 'app/live-layout.js', exports: ['PAGE_SIZE', 'LIVE_LAYOUTS', 'livePose', 'alpha', 'eventPlacement', 'hitEvent', 'routeTarget'], note: 'verbatim body (only livePose/alpha used by the dashboard)' },
  ];
  for (const mod of modules) {
    const expected = ENGINE.files[mod.file];
    const buf = await readFile(join(REPO, mod.file));
    const actual = sha256(buf);
    if (actual !== expected) throw new Error(`engine module drift: ${mod.file}\n  expected ${expected}\n  actual   ${actual}`);
    const { body, imports } = stripEsm(buf.toString('utf8'), mod.file, mod.exports);
    if (imports.length) throw new Error(`${mod.file}: unexpected imports: ${imports.join(' | ')}`);
    parts.push(wrapNamespace(mod.key, body, mod.exports));
    deltas.push(`${mod.file}: ${mod.note}`);
  }
  // app/motion.js cannot be shipped whole (it binds reference-track data), so we
  // extract only the pure cubic helper.
  const motionSrc = (await readFile(join(REPO, 'app/motion.js'))).toString('utf8');
  if (sha256(Buffer.from(motionSrc)) !== ENGINE.files['app/motion.js']) throw new Error('engine module drift: app/motion.js');
  const cubicPoint = extractFunction(motionSrc, 'cubicPoint');
  const motionNs = `SC.motion = (function () {\n'use strict';\n${cubicPoint}\nreturn { cubicPoint };\n})();`;
  const dashIdx = 3; // spider, probes, layout, motion
  const namespaces = [parts[0], parts[1], parts[2], motionNs];
  deltas.push('app/motion.js: extracted cubicPoint() only (reference-track-bound functions dropped)');

  const banner = [
    '/*!',
    ' * scene.js — self-contained Canvas-2D "检索大屏" dashboard for DSH web research.',
    ' *',
    ' * Canvas 2D rendering: prompt-spider-ui (MIT, Copyright (c) 2026 Kirito14IT)',
    ' *   https://github.com/Kirito14IT/prompt-spider-ui @ f6522df29739ccc4861c1227601980b88265923d',
    ' * DSH plugin, composition and subsequent modifications:',
    ' *   Copyright (c) 2026 yanx215241-a11y — MIT licensed.',
    ' *',
    ' * Generated by scene/build/build-scene.mjs — do not edit dist by hand.',
    ' * See /NOTICE.md and /plugin/lib/THIRD_PARTY_LICENSES.txt for details.',
    ' */',
  ].join('\n');

  const header = `(function (root) {\n'use strict';\nconst SC = { meta: ${JSON.stringify({ name: 'spider-scene', version: '1.0.0', engine: 'canvas-engine', license: 'MIT' })} };\n`;
  const footer = `\nif (root) root.createSpiderScene = createSpiderScene;\nif (typeof module !== 'undefined' && module && module.exports) module.exports = { createSpiderScene: createSpiderScene, meta: SC.meta };\n})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);\n`;

  const blocks = [];
  for (let i = 0; i < 4; i++) blocks.push(namespaces[i]);
  const source = [
    banner,
    header,
    '/* ==== engine: app/spider.js (verbatim) ==== */', blocks[0],
    '/* ==== engine: app/probes.js (verbatim) ==== */', blocks[1],
    '/* ==== engine: app/live-layout.js (verbatim) ==== */', blocks[2],
    '/* ==== engine: app/motion.js (cubicPoint only) ==== */', blocks[3],
    '/* ==== spider-scene composition (src/scene-dashboard.js) ==== */', composition,
    footer,
  ].join('\n');

  const bytes = Buffer.byteLength(source);
  const digest = sha256(Buffer.from(source));
  if (checkOnly) {
    console.log(`ok: would write ${OUT} (${bytes} bytes, sha256 ${digest.slice(0, 16)}…)`);
    return { source, bytes, digest };
  }
  await writeFile(OUT, source);
  console.log(`wrote ${OUT}`);
  console.log(`  ${bytes} bytes  sha256 ${digest}`);
  for (const d of deltas) console.log(`  reuse  ${d}`);
  return { source, bytes, digest };
}

build().catch((error) => {
  console.error('BUILD FAILED:', error.message);
  process.exitCode = 1;
});
