import { readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const GATE_STATUS = Object.freeze({ PASS: "PASS", FAIL: "FAIL" });

const BUDGETS = Object.freeze({
  totalBytes: 1_100_000
});

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

function collectAssets() {
  let files;
  try {
    files = walk(distRoot);
  } catch (err) {
    console.error(`BUNDLE_BUDGET: dist not found at ${distRoot}. Run \`yarn build\` first.`);
    console.error(err);
    process.exit(2);
  }
  let total = 0;
  const entries = [];
  for (const f of files) {
    total += f.size;
    entries.push({ name: relative(distRoot, f.path), size: f.size });
  }
  return { total, files: entries };
}

function format(bytes) {
  return `${(bytes / 1024).toFixed(1)}KiB`;
}

const summary = collectAssets();
const totalStatus = summary.total <= BUDGETS.totalBytes ? GATE_STATUS.PASS : GATE_STATUS.FAIL;

console.log(
  `BUNDLE_BUDGET: total=${format(summary.total)} (${summary.total} B) budget=${format(BUDGETS.totalBytes)} ${totalStatus}`
);
for (const f of summary.files) {
  console.log(`BUNDLE_FILE: ${f.name} ${format(f.size)}`);
}

if (totalStatus === GATE_STATUS.FAIL) {
  process.exit(1);
}
