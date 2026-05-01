// INFRA-3 bundle-size gate (see issue #195).
//
// Measures INITIAL-LOAD WEIGHT only — the bytes a user must download to
// render the first useful screen: entry JS chunk + entry CSS chunk +
// index.html + critical assets (favicon, logo). Async chunks emitted by
// Vite's code-splitter (anything in `assets/` that does NOT match the
// `index-*` entry pattern) are EXCLUDED from the budget and reported
// separately as informational so they don't gate CI. This is the metric
// that reflects TTI / first-paint cost; lazy-loading routes should
// reduce it, which the previous "sum all of dist/" gate did not allow.

import { readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const GATE_STATUS = Object.freeze({ PASS: "PASS", FAIL: "FAIL" });

const BUDGETS = Object.freeze({
  initialLoadBytes: 1_242_400
});

const ASSET_KIND = Object.freeze({
  ENTRY_JS: "ENTRY_JS",
  ENTRY_CSS: "ENTRY_CSS",
  HTML: "HTML",
  CRITICAL: "CRITICAL",
  ASYNC_CHUNK: "ASYNC_CHUNK",
  OTHER: "OTHER"
});

const CRITICAL_ROOT_FILES = Object.freeze(new Set(["favicon.svg", "logo.svg"]));
const ENTRY_JS_PATTERN = /^index-[A-Za-z0-9_-]+\.js$/;
const ENTRY_CSS_PATTERN = /^index-[A-Za-z0-9_-]+\.css$/;
const ASYNC_CHUNK_PATTERN = /\.js$/;

const here = dirname(fileURLToPath(import.meta.url));
const distRoot = join(here, "..", "dist");

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const s = statSync(full);
    if (s.isDirectory()) {
      out.push(...walk(full));
    } else if (s.isFile() && !name.endsWith(".map")) {
      out.push({ path: full, size: s.size });
    }
  }
  return out;
}

function classify(relPath) {
  const parts = relPath.split("/");
  if (parts.length === 1) {
    if (relPath === "index.html") return ASSET_KIND.HTML;
    if (CRITICAL_ROOT_FILES.has(relPath)) return ASSET_KIND.CRITICAL;
    return ASSET_KIND.OTHER;
  }
  if (parts[0] === "assets" && parts.length === 2) {
    const file = parts[1];
    if (ENTRY_JS_PATTERN.test(file)) return ASSET_KIND.ENTRY_JS;
    if (ENTRY_CSS_PATTERN.test(file)) return ASSET_KIND.ENTRY_CSS;
    if (ASYNC_CHUNK_PATTERN.test(file)) return ASSET_KIND.ASYNC_CHUNK;
    return ASSET_KIND.OTHER;
  }
  return ASSET_KIND.OTHER;
}

const INITIAL_LOAD_KINDS = new Set([
  ASSET_KIND.ENTRY_JS,
  ASSET_KIND.ENTRY_CSS,
  ASSET_KIND.HTML,
  ASSET_KIND.CRITICAL
]);

function collectAssets() {
  let files;
  try {
    files = walk(distRoot);
  } catch (err) {
    console.error(`BUNDLE_BUDGET: dist not found at ${distRoot}. Run \`yarn build\` first.`);
    console.error(err);
    process.exit(2);
  }
  const initial = [];
  const async_ = [];
  let initialTotal = 0;
  let asyncTotal = 0;
  for (const f of files) {
    const name = relative(distRoot, f.path);
    const kind = classify(name);
    const entry = { name, size: f.size, kind };
    if (INITIAL_LOAD_KINDS.has(kind)) {
      initial.push(entry);
      initialTotal += f.size;
    } else if (kind === ASSET_KIND.ASYNC_CHUNK) {
      async_.push(entry);
      asyncTotal += f.size;
    }
  }
  return { initial, initialTotal, async: async_, asyncTotal };
}

function format(bytes) {
  return `${(bytes / 1024).toFixed(1)}KiB`;
}

const summary = collectAssets();
const initialStatus =
  summary.initialTotal <= BUDGETS.initialLoadBytes ? GATE_STATUS.PASS : GATE_STATUS.FAIL;
const headroom = BUDGETS.initialLoadBytes - summary.initialTotal;

console.log(
  `BUNDLE_BUDGET: initial-load=${format(summary.initialTotal)} (${summary.initialTotal} B) ` +
    `budget=${format(BUDGETS.initialLoadBytes)} headroom=${format(headroom)} ${initialStatus}`
);
for (const f of summary.initial) {
  console.log(`BUNDLE_FILE: ${f.name} ${format(f.size)} [${f.kind}]`);
}
console.log(
  `BUNDLE_ASYNC: async-chunks=${format(summary.asyncTotal)} (${summary.asyncTotal} B) ` +
    `count=${summary.async.length} (informational, not gated)`
);
for (const f of summary.async) {
  console.log(`BUNDLE_ASYNC_FILE: ${f.name} ${format(f.size)}`);
}

if (initialStatus === GATE_STATUS.FAIL) {
  process.exit(1);
}
