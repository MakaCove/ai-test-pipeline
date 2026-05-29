#!/usr/bin/env node
/**
 * run-api-tests.mjs — 接口用例确定性执行器（零依赖，Node 内置 fetch）
 *
 * 读取 api-test-case-generate 产出的 api-cases-*.json，按依赖顺序逐条发送 HTTP
 * 请求、判定断言、维护变量链，产出 Markdown 报告：
 *   - api-reports/api-report-{ts}.md     人读报告（_shared/接口报告模板.md）
 *
 * 用法：
 *   node scripts/run-api-tests.mjs [文件路径] [选项]
 * 选项：
 *   --artifacts-dir <dir>  产物根目录（默认 ./test-artifacts）
 *   --base-url <url>       覆盖 baseUrl（默认取用例 meta 或 http://localhost:8080）
 *   --limit <n>            仅执行前 n 条（按 executionOrder）
 *   --all                  执行全部（默认）
 *   --module <name>        仅执行指定 module
 *   --ids <id,id,...>      仅执行指定用例 id（逗号分隔）
 *   --timeout <ms>         单请求超时（默认 30000）
 *   -h, --help             显示帮助
 */

import fs from "node:fs";
import path from "node:path";

const DEFAULT_TIMEOUT = 30000;
const DEFAULT_BASE_URL = "http://localhost:8080";

function parseArgs(argv) {
  const opts = {
    file: null,
    artifactsDir: "test-artifacts",
    baseUrl: null,
    limit: null,
    all: false,
    module: null,
    ids: null,
    timeout: DEFAULT_TIMEOUT,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") opts.help = true;
    else if (a === "--artifacts-dir") opts.artifactsDir = argv[++i];
    else if (a === "--base-url") opts.baseUrl = argv[++i];
    else if (a === "--limit") opts.limit = Number(argv[++i]);
    else if (a === "--all") opts.all = true;
    else if (a === "--module") opts.module = argv[++i];
    else if (a === "--ids") opts.ids = String(argv[++i]).split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--timeout") opts.timeout = Number(argv[++i]);
    else if (!a.startsWith("-") && !opts.file) opts.file = a;
  }
  return opts;
}

const HELP = `用法:
  node scripts/run-api-tests.mjs [文件路径] [选项]

选项:
  --artifacts-dir <dir>  产物根目录（默认 ./test-artifacts）
  --base-url <url>       覆盖 baseUrl
  --limit <n>            仅执行前 n 条（按 executionOrder）
  --all                  执行全部（默认）
  --module <name>        仅执行指定 module
  --ids <id,id,...>      仅执行指定用例 id
  --timeout <ms>         单请求超时（默认 30000）
  -h, --help             显示帮助
`;

function fileExists(p) {
  try { fs.accessSync(p, fs.constants.F_OK); return true; } catch { return false; }
}

function resolveCaseFile(opts) {
  if (opts.file) return path.resolve(process.cwd(), opts.file);
  const root = path.resolve(process.cwd(), opts.artifactsDir);
  const casesDir = path.join(root, "api-cases");
  const latestPath = path.join(root, "latest");
  if (fileExists(latestPath)) {
    const ts = fs.readFileSync(latestPath, "utf8").trim();
    const candidate = path.join(casesDir, `api-cases-${ts}.json`);
    if (fileExists(candidate)) return candidate;
  }
  if (!fileExists(casesDir)) throw new Error(`未找到 ${casesDir}，也未传入文件路径。`);
  const files = fs.readdirSync(casesDir)
    .filter((n) => /^api-cases-.*\.json$/.test(n))
    .map((n) => ({ full: path.join(casesDir, n), m: fs.statSync(path.join(casesDir, n)).mtimeMs }))
    .sort((a, b) => b.m - a.m);
  if (files.length === 0) throw new Error("api-cases 目录下没有 api-cases-*.json。");
  return files[0].full;
}

function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export { parseArgs, resolveCaseFile, timestamp, fileExists };

// ── 按点号 + 数组索引路径从响应取值：body.data.items[0].name ──
function getByPath(root, fieldPath) {
  if (!fieldPath) return undefined;
  const parts = String(fieldPath).replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean);
  let cur = root;
  for (const part of parts) {
    if (cur == null) return undefined;
    cur = cur[part];
  }
  return cur;
}

// ── 断言判定（与 _shared/断言语法.md 算子表一致）──
function judge(actual, operator, expected) {
  switch (operator) {
    case "eq": return actual === expected;
    case "neq": return actual !== expected;
    case "contains": return String(actual).includes(String(expected));
    case "not_contains": return !String(actual).includes(String(expected));
    case "gt": return Number(actual) > Number(expected);
    case "lt": return Number(actual) < Number(expected);
    case "exists": return actual !== undefined && actual !== null;
    case "not_exists": return actual === undefined || actual === null;
    case "regex": return new RegExp(expected).test(String(actual));
    case "type":
      if (expected === "array") return Array.isArray(actual);
      if (expected === "null") return actual === null;
      return typeof actual === expected;
    default: return false;
  }
}

// ── 取断言实际值：status 取状态码，body[.path] 取响应体 ──
function resolveAssertionActual(field, ctx) {
  if (field === "status") return ctx.status;
  if (field === "body") return ctx.bodyText;
  if (field.startsWith("body.")) return getByPath(ctx.body, field.slice(5));
  if (field.startsWith("headers.")) return ctx.headers[field.slice(8).toLowerCase()];
  return getByPath(ctx.body, field);
}

// ── {{var}} 模板替换（递归处理 path/headers/body）──
function substitute(value, vars) {
  if (typeof value === "string") {
    return value.replace(/\{\{(\w+)\}\}/g, (m, name) => (name in vars ? vars[name] : m));
  }
  if (Array.isArray(value)) return value.map((v) => substitute(v, vars));
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = substitute(v, vars);
    return out;
  }
  return value;
}

function collectTemplateVars(testCase) {
  const found = new Set();
  const scan = (v) => {
    if (typeof v === "string") {
      for (const m of v.matchAll(/\{\{(\w+)\}\}/g)) found.add(m[1]);
    } else if (Array.isArray(v)) v.forEach(scan);
    else if (v && typeof v === "object") Object.values(v).forEach(scan);
  };
  scan(testCase.request);
  return found;
}

// ── 依赖感知排序：尊重 executionOrder，再按 dependsOnCases 拓扑兜底 ──
function orderCases(cases) {
  const hasOrder = cases.every((c) => Number.isFinite(c.executionOrder));
  if (hasOrder) return [...cases].sort((a, b) => a.executionOrder - b.executionOrder);
  const byId = new Map(cases.map((c) => [c.id, c]));
  const visited = new Set();
  const result = [];
  const visit = (c, stack = new Set()) => {
    if (visited.has(c.id) || stack.has(c.id)) return;
    stack.add(c.id);
    for (const dep of c.dependsOnCases || []) {
      const upstream = byId.get(dep);
      if (upstream) visit(upstream, stack);
    }
    stack.delete(c.id);
    visited.add(c.id);
    result.push(c);
  };
  cases.forEach((c) => visit(c));
  return result;
}

// ── 发送单个请求：30s 超时 + 网络错误重试 1 次 ──
async function sendRequest(url, init, timeoutMs, retriesLeft = 1) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    clearTimeout(timer);
    const bodyText = await res.text();
    let body;
    try { body = bodyText ? JSON.parse(bodyText) : null; } catch { body = null; }
    const headers = {};
    res.headers.forEach((v, k) => { headers[k] = v; });
    return { status: res.status, body, bodyText, headers };
  } catch (err) {
    clearTimeout(timer);
    const isTimeout = err.name === "AbortError";
    const isNetwork = /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|fetch failed/i.test(err.message || "");
    if (!isTimeout && isNetwork && retriesLeft > 0) {
      return sendRequest(url, init, timeoutMs, retriesLeft - 1);
    }
    return { error: isTimeout ? `请求超时（${timeoutMs / 1000} 秒）` : (err.message || String(err)) };
  }
}

// ── 执行单条用例 ──
async function runCase(testCase, vars, opts, completed) {
  const result = {
    id: testCase.id, title: testCase.title || "", module: testCase.module || "",
    priority: testCase.priority || "", contractRef: testCase.contractRef || testCase.flowRef || "",
    scenarioRef: testCase.scenarioRef || "", status: "passed",
    durationMs: 0, assertions: [], error: null,
    isChain: Boolean((testCase.dependsOnCases || []).length || (testCase.consumes || []).length || (testCase.produces || []).length || testCase.contractRefs),
  };

  // 0. 用例级 mockData：仅补缺失变量
  if (testCase.mockData && typeof testCase.mockData === "object") {
    for (const [k, v] of Object.entries(testCase.mockData)) {
      if (!(k in vars)) vars[k] = v;
    }
  }

  // 1. 依赖检查：上游失败 → 跳过
  for (const dep of testCase.dependsOnCases || []) {
    if (completed.get(dep) && completed.get(dep) !== "passed") {
      result.status = "skipped";
      result.error = `上游失败传递（${dep} = ${completed.get(dep)}）`;
      return result;
    }
  }
  // 2. 变量消费检查
  for (const v of testCase.consumes || []) {
    if (!(v in vars)) {
      result.status = "skipped";
      result.error = `链路变量缺失：${v}`;
      return result;
    }
  }
  // 3. 模板变量是否齐备（非系统变量）
  for (const v of collectTemplateVars(testCase)) {
    if (!(v in vars)) {
      result.status = "skipped";
      result.error = `模板变量未解析：{{${v}}}`;
      return result;
    }
  }

  const req = substitute(testCase.request || {}, vars);
  const url = (opts.baseUrl || "") + (req.path || "");
  const init = { method: req.method || "GET", headers: { ...(req.body && req.method !== "GET" ? { "Content-Type": "application/json" } : {}), ...(req.headers || {}) } };
  if (req.body !== undefined && req.method !== "GET" && req.body !== "__FORM__") {
    init.body = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
  }

  const t0 = Date.now();
  const resp = await sendRequest(url, init, opts.timeout);
  result.durationMs = Date.now() - t0;

  if (resp.error) {
    result.status = "failed";
    result.error = resp.error;
    return result;
  }

  // 4. 断言判定
  const ctx = resp;
  let allPass = true;
  for (const a of testCase.assertions || []) {
    const actual = resolveAssertionActual(a.field, ctx);
    const pass = judge(actual, a.operator, a.expected);
    if (!pass) allPass = false;
    result.assertions.push({ field: a.field, operator: a.operator, expected: a.expected, actual, pass });
  }
  result.status = allPass ? "passed" : "failed";
  if (!allPass) {
    const f = result.assertions.find((x) => !x.pass);
    result.error = `断言失败：${f.field} ${f.operator} ${JSON.stringify(f.expected)}（实际 ${JSON.stringify(f.actual)}）`;
  }

  // 5. 提取变量入池
  if (testCase.extract && typeof testCase.extract === "object") {
    for (const [name, p] of Object.entries(testCase.extract)) {
      const val = getByPath(ctx.body, p.startsWith("body.") ? p.slice(5) : p);
      if (val !== undefined && val !== null) vars[name] = val;
    }
  }
  // 6. produces 校验
  for (const v of testCase.produces || []) {
    if (!(v in vars)) {
      result.status = result.status === "passed" ? "failed" : result.status;
      result.error = (result.error ? result.error + "；" : "") + `产出变量未得到：${v}`;
    }
  }
  return result;
}

function buildMarkdown(meta, results, caseFile, baseUrl, durationMs) {
  const total = results.length;
  const passed = results.filter((r) => r.status === "passed").length;
  const failed = results.filter((r) => r.status === "failed").length;
  const skipped = results.filter((r) => r.status === "skipped").length;
  const passRate = total ? ((passed / total) * 100).toFixed(1) : "0.0";
  const cov = meta?.coverage || {};
  const fc = cov.flowChains || {};
  const chainResults = results.filter((r) => r.isChain);
  const chainPassed = chainResults.filter((r) => r.status === "passed").length;
  const icon = (s) => (s === "passed" ? "✅" : s === "failed" ? "❌" : "⏭️");
  const failures = results.filter((r) => r.status !== "passed");

  let md = `# 接口测试报告\n\n`;
  md += `**生成时间**：${new Date().toISOString()}\n`;
  md += `**用例来源**：${caseFile}\n`;
  md += `**项目分析**：${meta?.sourceAnalysis || "N/A"}\n`;
  md += `**执行环境**：${baseUrl}\n\n---\n\n## 概览\n\n`;
  md += `| 指标 | 数值 |\n|------|------|\n`;
  md += `| 总用例数 | ${total} |\n| 通过 | ${passed} |\n| 失败 | ${failed} |\n| 跳过 | ${skipped} |\n| 通过率 | ${passRate}% |\n| 执行耗时 | ${(durationMs / 1000).toFixed(1)}s |\n\n---\n\n`;
  md += `## 覆盖统计（来自用例 meta.coverage）\n\n| 指标 | 数值 |\n|------|------|\n`;
  if (cov.mainFlowTotal != null) {
    md += `| 主流程覆盖 | ${cov.mainFlowsCovered ?? "?"} / ${cov.mainFlowTotal ?? "?"}（${cov.mainFlowCoveragePercent ?? "?"}%） |\n`;
    md += `| 未覆盖主流程 | ${(cov.uncoveredMainFlows || []).join(", ") || "无"} |\n`;
  } else {
    md += `| 端点覆盖 | ${cov.endpointsCovered ?? "?"} / ${cov.endpointTotal ?? "?"}（${cov.endpointCoveragePercent ?? "?"}%） |\n`;
    md += `| P0 契约场景覆盖 | ${cov.contractScenariosCovered ?? "?"} / ${cov.contractScenarioTotal ?? "?"}（${cov.contractScenarioCoveragePercent ?? "?"}%） |\n`;
    md += `| 未覆盖场景 | ${(cov.uncoveredScenarios || []).join(", ") || "无"} |\n`;
  }
  md += `| 孤儿用例数 | ${cov.orphanCases ?? "?"} |\n\n---\n\n`;
  if (fc.chainScenarioTotal) {
    const cpr = chainResults.length ? ((chainPassed / chainResults.length) * 100).toFixed(1) : "0.0";
    md += `## 链路覆盖\n\n| 指标 | 数值 |\n|------|------|\n`;
    md += `| 链路场景覆盖 | ${fc.chainScenarioCovered} / ${fc.chainScenarioTotal}（${fc.chainScenarioCoveragePercent}%） |\n`;
    md += `| 链路用例通过 | ${chainPassed} / ${chainResults.length}（${cpr}%） |\n\n---\n\n`;
  }
  if (failures.length) {
    md += `## 失败/跳过用例\n\n`;
    for (const r of failures) {
      md += `### ${icon(r.status)} ${r.id} — ${r.title}\n\n`;
      md += `- **模块**：${r.module}\n- **优先级**：${r.priority}\n- **契约追溯**：${r.contractRef} / ${r.scenarioRef}\n- **错误信息**：${r.error}\n\n---\n\n`;
    }
  }
  md += `## 全部用例明细\n\n| ID | 模块 | 标题 | 契约/场景 | 优先级 | 结果 | 耗时 |\n|----|------|------|-----------|--------|------|------|\n`;
  for (const r of results) {
    md += `| ${r.id} | ${r.module} | ${r.title} | ${r.contractRef}/${r.scenarioRef} | ${r.priority} | ${icon(r.status)} | ${r.durationMs}ms |\n`;
  }
  return md;
}

function filterCases(cases, opts) {
  let sel = cases;
  if (opts.ids) sel = sel.filter((c) => opts.ids.includes(c.id));
  if (opts.module) sel = sel.filter((c) => c.module === opts.module);
  const ordered = orderCases(sel);
  if (opts.limit && !opts.all) return ordered.slice(0, opts.limit);
  return ordered;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { console.log(HELP); process.exit(0); }

  let caseFile, payload;
  try {
    caseFile = resolveCaseFile(opts);
    payload = JSON.parse(fs.readFileSync(caseFile, "utf8"));
  } catch (e) {
    console.error(`❌ 读取用例失败：${e.message}`);
    process.exit(1);
  }
  if (!Array.isArray(payload) || payload.length < 2) {
    console.error("❌ 用例文件结构错误：顶层须为 [meta, ...cases]。");
    process.exit(1);
  }

  const meta = payload[0];
  const allCases = payload.slice(1);
  const baseUrl = opts.baseUrl || meta.baseUrl || DEFAULT_BASE_URL;
  opts.baseUrl = baseUrl;

  // 测试账号与 mock 数据注入为系统变量
  const vars = {};
  if (meta.mockData && typeof meta.mockData === "object") {
    Object.assign(vars, meta.mockData);
  }
  const acct = meta.testAccount || meta.auth?.testAccount;
  if (acct?.username) vars.username = acct.username;
  if (acct?.password) vars.password = acct.password;
  vars.timestamp = String(Date.now());

  const cases = filterCases(allCases, opts);
  console.log(`\n🚀 接口测试执行 | baseUrl=${baseUrl} | 选中 ${cases.length}/${allCases.length} 条\n`);

  const completed = new Map();
  const results = [];
  const start = Date.now();
  for (const c of cases) {
    const r = await runCase(c, vars, opts, completed);
    completed.set(c.id, r.status);
    results.push(r);
    const icon = r.status === "passed" ? "✅" : r.status === "failed" ? "❌" : "⏭️";
    console.log(`${icon} ${c.id} ${r.title || ""}${r.error ? " — " + r.error : ""}`);
  }
  const durationMs = Date.now() - start;

  // 写产物
  const root = path.resolve(process.cwd(), opts.artifactsDir);
  const reportsDir = path.join(root, "api-reports");
  fs.mkdirSync(reportsDir, { recursive: true });
  const ts = timestamp();
  const md = buildMarkdown(meta, results, caseFile, baseUrl, durationMs);
  const passed = results.filter((r) => r.status === "passed").length;
  const failed = results.filter((r) => r.status === "failed").length;
  const skipped = results.filter((r) => r.status === "skipped").length;
  fs.writeFileSync(path.join(reportsDir, `api-report-${ts}.md`), md, "utf8");

  console.log(`\n📊 通过 ${passed} | ❌ 失败 ${failed} | ⏭️ 跳过 ${skipped}`);
  console.log(`📁 报告：${path.join(reportsDir, `api-report-${ts}.md`)}`);
  process.exit(failed > 0 ? 1 : 0);
}

// 仅在直接运行时执行 main（被 import 时不触发）
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("run-api-tests.mjs")) {
  main();
}




