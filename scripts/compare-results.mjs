#!/usr/bin/env node
/**
 * compare-results.mjs — 执行结果基线对比（回归守护）
 *
 * 把最新一次执行结果（api-results-*.json / ui-results-*.json）与基线对比，
 * 报告：新增失败（回归）、已修复、仍失败、flaky（与基线状态不一致）。
 * 这是流水线从「一次性生成」升级为「持续守护」的关键一环。
 *
 * 基线存放：test-artifacts/baseline/api-results.json、ui-results.json
 *
 * 用法：
 *   node scripts/compare-results.mjs [--kind api|ui] [--current <path>] [--baseline <path>]
 *                                    [--artifacts-dir <dir>] [--update-baseline] [--fail-on-regression]
 * 选项：
 *   --kind <api|ui>        指定对比类型（默认两者都尝试）
 *   --current <path>       显式指定当前结果文件（默认取最新）
 *   --baseline <path>      显式指定基线文件
 *   --artifacts-dir <dir>  产物根目录（默认 ./test-artifacts）
 *   --update-baseline      用当前结果覆盖/创建基线，然后退出
 *   --fail-on-regression   存在新增失败时退出码 1（CI 门禁用）
 *   -h, --help
 */

import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const o = { kind: null, current: null, baseline: null, artifactsDir: "test-artifacts", updateBaseline: false, failOnRegression: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") o.help = true;
    else if (a === "--kind") o.kind = argv[++i];
    else if (a === "--current") o.current = argv[++i];
    else if (a === "--baseline") o.baseline = argv[++i];
    else if (a === "--artifacts-dir") o.artifactsDir = argv[++i];
    else if (a === "--update-baseline") o.updateBaseline = true;
    else if (a === "--fail-on-regression") o.failOnRegression = true;
  }
  return o;
}

const HELP = `用法:
  node scripts/compare-results.mjs [--kind api|ui] [--update-baseline] [--fail-on-regression]
                                   [--current <path>] [--baseline <path>] [--artifacts-dir <dir>]
`;

function exists(p) { try { fs.accessSync(p); return true; } catch { return false; } }

function latestResults(root, kind) {
  const dir = path.join(root, kind === "api" ? "api-reports" : "ui-reports");
  if (!exists(dir)) return null;
  const prefix = kind === "api" ? "api-results-" : "ui-results-";
  const files = fs.readdirSync(dir)
    .filter((n) => n.startsWith(prefix) && n.endsWith(".json"))
    .map((n) => ({ p: path.join(dir, n), m: fs.statSync(path.join(dir, n)).mtimeMs }))
    .sort((a, b) => b.m - a.m);
  return files.length ? files[0].p : null;
}

function statusMap(resultsObj) {
  const map = new Map();
  for (const r of resultsObj.results || []) map.set(r.id, r.status);
  return map;
}

// 对比单一类型，返回 { kind, regressions, fixed, stillFailing, newCases, removedCases }
function compareKind(kind, root, opts) {
  const currentPath = opts.current || latestResults(root, kind);
  if (!currentPath || !exists(currentPath)) return null;
  const current = JSON.parse(fs.readFileSync(currentPath, "utf8"));

  const baselineDir = path.join(root, "baseline");
  const baselinePath = opts.baseline || path.join(baselineDir, `${kind}-results.json`);

  if (opts.updateBaseline) {
    fs.mkdirSync(baselineDir, { recursive: true });
    fs.writeFileSync(baselinePath, JSON.stringify(current, null, 2), "utf8");
    return { kind, updated: true, baselinePath, currentPath };
  }

  if (!exists(baselinePath)) {
    return { kind, noBaseline: true, currentPath, baselinePath };
  }
  const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
  const curMap = statusMap(current);
  const baseMap = statusMap(baseline);

  const regressions = [], fixed = [], stillFailing = [], newCases = [], removedCases = [];
  const passLike = (s) => s === "passed";

  for (const [id, curStatus] of curMap) {
    if (!baseMap.has(id)) { newCases.push({ id, status: curStatus }); continue; }
    const baseStatus = baseMap.get(id);
    if (passLike(baseStatus) && !passLike(curStatus)) regressions.push({ id, from: baseStatus, to: curStatus });
    else if (!passLike(baseStatus) && passLike(curStatus)) fixed.push({ id, from: baseStatus, to: curStatus });
    else if (!passLike(baseStatus) && !passLike(curStatus)) stillFailing.push({ id, status: curStatus });
  }
  for (const id of baseMap.keys()) if (!curMap.has(id)) removedCases.push({ id, status: baseMap.get(id) });

  return { kind, currentPath, baselinePath, regressions, fixed, stillFailing, newCases, removedCases };
}

function printReport(cmp) {
  console.log(`\n━━ ${cmp.kind.toUpperCase()} 结果对比 ━━`);
  if (cmp.updated) { console.log(`✅ 已更新基线：${cmp.baselinePath}`); return; }
  if (cmp.noBaseline) {
    console.log(`⚠️  无基线（${cmp.baselinePath}）。首次运行请加 --update-baseline 建立基线。`);
    console.log(`   当前结果：${cmp.currentPath}`);
    return;
  }
  console.log(`基线: ${cmp.baselinePath}`);
  console.log(`当前: ${cmp.currentPath}`);
  console.log(`🔴 新增失败(回归): ${cmp.regressions.length}`);
  for (const r of cmp.regressions) console.log(`   - ${r.id}: ${r.from} → ${r.to}`);
  console.log(`🟢 已修复: ${cmp.fixed.length}`);
  for (const r of cmp.fixed) console.log(`   - ${r.id}: ${r.from} → ${r.to}`);
  console.log(`⚪ 仍失败: ${cmp.stillFailing.length}`);
  console.log(`🆕 新增用例: ${cmp.newCases.length}`);
  console.log(`➖ 基线中已移除: ${cmp.removedCases.length}`);
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { console.log(HELP); process.exit(0); }
  const root = path.resolve(process.cwd(), opts.artifactsDir);
  const kinds = opts.kind ? [opts.kind] : ["api", "ui"];

  let anyRegression = false;
  let anyCompared = false;
  for (const kind of kinds) {
    const cmp = compareKind(kind, root, opts);
    if (!cmp) continue;
    anyCompared = true;
    printReport(cmp);
    if (cmp.regressions && cmp.regressions.length) anyRegression = true;
  }
  if (!anyCompared) {
    console.error("❌ 未找到可对比的结果文件（api-results-*.json / ui-results-*.json）。");
    process.exit(1);
  }
  if (opts.failOnRegression && anyRegression) {
    console.log("\n❌ 检测到回归，按 --fail-on-regression 退出码 1。");
    process.exit(1);
  }
  console.log("");
  process.exit(0);
}

if (process.argv[1]?.endsWith("compare-results.mjs")) main();

