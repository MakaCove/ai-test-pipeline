#!/usr/bin/env node
/**
 * run-ui-tests.mjs — UI 用例执行器（只接受 trace.*）
 */

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const DEFAULT_BASE_URL = "http://localhost:5173";
const V1_FIELDS = ["dependsOnCases", "consumes", "produces", "featureRef", "featureRefs"];

function parseArgs(argv) {
  const o = {
    file: null,
    artifactsDir: "test-artifacts",
    baseUrl: null,
    profile: null,
    localChrome: false,
    headless: false,
    slowMo: null,
    limit: null,
    all: false,
    module: null,
    ids: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "-h" || a === "--help") o.help = true;
    else if (a === "--artifacts-dir") o.artifactsDir = argv[++i];
    else if (a === "--base-url") o.baseUrl = argv[++i];
    else if (a === "--profile") o.profile = argv[++i];
    else if (a === "--local-chrome") o.localChrome = true;
    else if (a === "--headless") o.headless = true;
    else if (a === "--slow-mo") o.slowMo = Number(argv[++i]);
    else if (a === "--limit") o.limit = Number(argv[++i]);
    else if (a === "--all") o.all = true;
    else if (a === "--module") o.module = argv[++i];
    else if (a === "--ids") o.ids = String(argv[++i]).split(",").map((s) => s.trim()).filter(Boolean);
    else if (!a.startsWith("-") && !o.file) o.file = a;
  }
  return o;
}

const HELP = `用法:
  node scripts/run-ui-tests.mjs [文件路径] [选项]

选项:
  --artifacts-dir <dir>  产物根目录（默认 ./test-artifacts）
  --base-url <url>       覆盖 baseUrl
  --profile <name>       ui-test.config.json 中的 profile
  --local-chrome         强制系统 Chrome
  --headless             无头模式（须明确指定）
  --slow-mo <ms>         动作间隔
  --limit <n> / --all    执行范围
  --module <name> / --ids <id,...>
  -h, --help             显示帮助
`;

function fileExists(p) { try { fs.accessSync(p); return true; } catch { return false; } }

function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function failField(moduleName, caseId, fieldPath, message) {
  return `[${moduleName || "unknown"}][${caseId || "unknown"}][${fieldPath}] ${message}`;
}

function resolveCaseFile(opts) {
  if (opts.file) return path.resolve(process.cwd(), opts.file);
  const root = path.resolve(process.cwd(), opts.artifactsDir);
  const dir = path.join(root, "ui-cases");
  const latest = path.join(root, "latest");
  if (fileExists(latest)) {
    const ts = fs.readFileSync(latest, "utf8").trim();
    const c = path.join(dir, `ui-cases-${ts}.json`);
    if (fileExists(c)) return c;
  }
  if (!fileExists(dir)) throw new Error(`未找到 ${dir}，也未传入文件路径。`);
  const files = fs.readdirSync(dir).filter((n) => /^ui-cases-.*\.json$/.test(n))
    .map((n) => ({ full: path.join(dir, n), m: fs.statSync(path.join(dir, n)).mtimeMs }))
    .sort((a, b) => b.m - a.m);
  if (!files.length) throw new Error("ui-cases 目录下没有 ui-cases-*.json。");
  return files[0].full;
}

function loadUiConfig(root) {
  const cfgPath = path.join(root, "ui-test.config.json");
  if (!fileExists(cfgPath)) return null;
  try { return JSON.parse(fs.readFileSync(cfgPath, "utf8")); } catch { return null; }
}

function scriptRootDir() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

function resolvePlaywrightModulePaths(cfg) {
  const paths = [];
  for (const p of cfg?.browserResolve?.playwrightModulePaths || []) {
    paths.push(path.resolve(p));
  }
  let dir = process.cwd();
  for (let i = 0; i < 8; i += 1) {
    paths.push(path.join(dir, "node_modules", "playwright"));
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  paths.push(path.join(scriptRootDir(), "node_modules", "playwright"));
  return [...new Set(paths)];
}

async function resolvePlaywrightModule(cfg) {
  const browsersPath = cfg?.browserResolve?.playwrightBrowsersPath
    || process.env.PLAYWRIGHT_BROWSERS_PATH
    || path.join(process.env.LOCALAPPDATA || "", "ms-playwright");

  if (fileExists(browsersPath)) process.env.PLAYWRIGHT_BROWSERS_PATH = browsersPath;

  for (const pkgDir of resolvePlaywrightModulePaths(cfg)) {
    const pkgJson = path.join(pkgDir, "package.json");
    if (!fileExists(pkgJson)) continue;
    try {
      const req = createRequire(path.join(pkgDir, "index.js"));
      const mod = req(".");
      const version = JSON.parse(fs.readFileSync(pkgJson, "utf8")).version;
      return { chromium: mod.chromium, version, modulePath: pkgDir, browsersPath };
    } catch {
      // noop
    }
  }

  try {
    const mod = await import("playwright");
    return { chromium: mod.chromium, version: "unknown", modulePath: "playwright", browsersPath };
  } catch {
    return null;
  }
}

function readChromiumRevision(modulePath) {
  if (!modulePath || modulePath === "playwright") return null;
  const browsersJson = path.join(path.dirname(modulePath), "playwright-core", "browsers.json");
  if (!fileExists(browsersJson)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(browsersJson, "utf8"));
    return data.browsers?.find((b) => b.name === "chromium")?.revision || null;
  } catch {
    return null;
  }
}

function hasFixedChromium(browsersPath, revision) {
  if (!revision || !fileExists(browsersPath)) return false;
  const dir = path.join(browsersPath, `chromium-${revision}`);
  if (!fileExists(dir)) return false;
  const markers = [
    path.join(dir, "INSTALLATION_COMPLETE"),
    path.join(dir, "chrome-win64", "chrome.exe"),
    path.join(dir, "chrome-linux", "chrome"),
    path.join(dir, "chrome-mac", "Chromium.app"),
  ];
  return markers.some((p) => fileExists(p));
}

function findChromeExecutable(cfg) {
  for (const p of cfg?.browserResolve?.chromeExecutablePaths || []) {
    const resolved = path.resolve(p);
    if (fileExists(resolved)) return resolved;
  }
  const defaults = [
    path.join(process.env.ProgramFiles || "", "Google", "Chrome", "Application", "chrome.exe"),
    path.join(process.env["ProgramFiles(x86)"] || "", "Google", "Chrome", "Application", "chrome.exe"),
    path.join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "Application", "chrome.exe"),
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
  ];
  return defaults.find((p) => p && fileExists(p)) || null;
}

function resolveBrowserEngine(cfg, pwInfo, headed) {
  const prefer = cfg?.browserResolve?.preferEngine || ["fixed-chromium", "system-chrome"];
  const revision = readChromiumRevision(pwInfo?.modulePath);
  const browsersPath = pwInfo?.browsersPath;
  const chromeExe = findChromeExecutable(cfg);
  for (const step of prefer) {
    if (step === "fixed-chromium" && hasFixedChromium(browsersPath, revision)) {
      return {
        engine: "playwright-chromium",
        launchOptions: { headless: !headed },
        label: `固定缓存 chromium-${revision} (${headed ? "headed" : "headless"})`,
      };
    }
    if (step === "system-chrome" && chromeExe) {
      return {
        engine: "local-chrome",
        launchOptions: { headless: !headed, channel: "chrome" },
        label: `系统 Chrome (${headed ? "headed" : "headless"}) @ ${chromeExe}`,
      };
    }
  }
  return {
    engine: "playwright-chromium",
    launchOptions: { headless: !headed },
    label: `Playwright Chromium 兜底 (${headed ? "headed" : "headless"})`,
  };
}

function resolveProfile(opts, cfg) {
  let name = opts.profile;
  if (!name && opts.localChrome) name = opts.headless ? "local-chrome-headless" : "local-chrome-headed";
  if (!name) name = cfg?.defaultProfile || "auto-headed";
  const builtin = {
    "auto-headed": { engine: "auto", headed: true, slowMo: 800, launchOptions: { args: ["--start-maximized"] }, contextOptions: { viewport: null } },
    "auto-headless": { engine: "auto", headed: false, slowMo: 0 },
    "playwright-headed": { engine: "playwright-chromium", headed: true, slowMo: 1000, launchOptions: { args: ["--start-maximized"] }, contextOptions: { viewport: null } },
    "playwright-headless": { engine: "playwright-chromium", headed: false, slowMo: 0 },
    "local-chrome-headed": { engine: "local-chrome", headed: true, slowMo: 800, launchOptions: { args: ["--start-maximized"] }, contextOptions: { viewport: null } },
    "local-chrome-headless": { engine: "local-chrome", headed: false, slowMo: 0 },
  };
  const profile = { ...(cfg?.profiles?.[name] || builtin[name] || builtin["auto-headed"]) };
  if (opts.headless) profile.headed = false;
  if (opts.slowMo != null) profile.slowMo = opts.slowMo;
  return { name, profile };
}

function ensureV2Shape(meta, cases) {
  if (!meta.schema || !String(meta.schema).includes("/v2")) {
    throw new Error("[meta][schema] schema 必须包含 /v2");
  }
  for (const c of cases) {
    for (const f of V1_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(c, f)) {
        throw new Error(failField(c.module, c.id, f, "检测到无效字段，仅支持 trace.*"));
      }
    }
    if (!c.trace || typeof c.trace !== "object") {
      throw new Error(failField(c.module, c.id, "trace", "缺少 trace 对象"));
    }
    if (!Array.isArray(c.trace.flowRefs) || c.trace.flowRefs.length === 0) {
      throw new Error(failField(c.module, c.id, "trace.flowRefs", "必须是非空数组"));
    }
    if (c.trace.dependsOn && !Array.isArray(c.trace.dependsOn)) {
      throw new Error(failField(c.module, c.id, "trace.dependsOn", "必须是数组"));
    }
    if (c.trace.consumes && !Array.isArray(c.trace.consumes)) {
      throw new Error(failField(c.module, c.id, "trace.consumes", "必须是数组"));
    }
    if (c.trace.produces && !Array.isArray(c.trace.produces)) {
      throw new Error(failField(c.module, c.id, "trace.produces", "必须是数组"));
    }
  }
}

function orderCases(cases) {
  const hasOrder = cases.every((c) => Number.isFinite(c.executionOrder));
  if (hasOrder) return [...cases].sort((a, b) => a.executionOrder - b.executionOrder);
  const byId = new Map(cases.map((c) => [c.id, c]));
  const visited = new Set();
  const stack = new Set();
  const out = [];
  const visit = (c) => {
    if (visited.has(c.id)) return;
    if (stack.has(c.id)) throw new Error(failField(c.module, c.id, "trace.dependsOn", "依赖图中存在循环"));
    stack.add(c.id);
    for (const depId of c.trace?.dependsOn || []) {
      const dep = byId.get(depId);
      if (dep) visit(dep);
    }
    stack.delete(c.id);
    visited.add(c.id);
    out.push(c);
  };
  cases.forEach(visit);
  return out;
}

function filterCases(cases, opts) {
  let sel = cases;
  if (opts.ids) sel = sel.filter((c) => opts.ids.includes(c.id));
  if (opts.module) sel = sel.filter((c) => c.module === opts.module);
  const ordered = orderCases(sel);
  if (opts.limit && !opts.all) return ordered.slice(0, opts.limit);
  return ordered;
}

function subst(str, vars) {
  if (typeof str !== "string") return str;
  return str.replace(/\{\{(\w+)\}\}/g, (m, n) => (n in vars ? vars[n] : m));
}

async function locate(page, desc) {
  const text = String(desc || "").trim();
  if (!text) return null;
  const tid = text.match(/^testid=(.+)$/);
  if (tid) return { locator: page.getByTestId(tid[1]), strategy: `testid=${tid[1]}` };
  for (const role of ["button", "link", "menuitem", "tab"]) {
    const loc = page.getByRole(role, { name: text, exact: false });
    if (await loc.count().catch(() => 0)) return { locator: loc.first(), strategy: `role=${role}[name=${text}]` };
  }
  const byLabel = page.getByLabel(text, { exact: false });
  if (await byLabel.count().catch(() => 0)) return { locator: byLabel.first(), strategy: `label=${text}` };
  const byPh = page.getByPlaceholder(text, { exact: false });
  if (await byPh.count().catch(() => 0)) return { locator: byPh.first(), strategy: `placeholder=${text}` };
  const byText = page.getByText(text, { exact: false });
  if (await byText.count().catch(() => 0)) return { locator: byText.first(), strategy: `text=${text}` };
  return null;
}

function resolveMenuLabel(rawTarget, menuMap) {
  if (!rawTarget) return rawTarget;
  if (!Array.isArray(menuMap)) return rawTarget;
  const hit = menuMap.find((item) => item?.route === rawTarget || item?.menuLabel === rawTarget);
  return hit?.menuLabel || rawTarget;
}

async function runStep(page, step, vars, baseUrl, menuMap) {
  const action = step.action;
  const target = subst(step.target, vars);
  const value = subst(step.value, vars);

  const click = async (desc) => {
    const hit = await locate(page, desc);
    if (!hit) return { ok: false, error: `未定位到元素：${desc}` };
    await hit.locator.click({ timeout: 10000 });
    return { ok: true, strategy: hit.strategy };
  };

  switch (action) {
    case "reset_session":
      await page.context().clearCookies();
      await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded" }).catch(() => {});
      await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); }).catch(() => {});
      return { ok: true };
    case "open_login":
      await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded" });
      return { ok: true };
    case "ensure_session":
      return { ok: true };
    case "navigate":
      await page.goto(baseUrl + (String(target).startsWith("http") ? "" : String(target)), { waitUntil: "domcontentloaded" });
      return { ok: true };
    case "click_menu": {
      const menuLabel = resolveMenuLabel(target, menuMap);
      return click(menuLabel);
    }
    case "switch_auth_tab":
    case "switch_tab":
    case "click":
      return click(target);
    case "fill": {
      const hit = await locate(page, target);
      if (!hit) return { ok: false, error: `未定位到输入框：${target}` };
      await hit.locator.fill(String(value), { timeout: 10000 });
      return { ok: true, strategy: hit.strategy, outputValue: String(value) };
    }
    case "select": {
      const hit = await locate(page, target);
      if (!hit) return { ok: false, error: `未定位到下拉：${target}` };
      await hit.locator.selectOption({ label: String(value) }).catch(async () => { await hit.locator.click(); });
      return { ok: true, strategy: hit.strategy, outputValue: String(value) };
    }
    case "hover": {
      const hit = await locate(page, target);
      if (!hit) return { ok: false, error: `未定位到元素：${target}` };
      await hit.locator.hover();
      return { ok: true, strategy: hit.strategy };
    }
    case "wait":
      await page.waitForTimeout(Number(value) || 1000);
      return { ok: true };
    case "press_key":
      await page.keyboard.press(String(value || target));
      return { ok: true };
    case "scroll":
      await page.mouse.wheel(0, Number(value) || 600);
      return { ok: true };
    case "screenshot":
      return { ok: true, screenshotHint: true };
    default:
      return { ok: false, error: `不支持的 action：${action}` };
  }
}

async function judgeUiAssertion(page, a) {
  const target = String(a.target || "");
  try {
    switch (a.type) {
      case "element_visible": {
        const hit = await locate(page, target);
        const vis = hit ? await hit.locator.isVisible().catch(() => false) : false;
        return vis === (a.expected !== false);
      }
      case "element_hidden": {
        const hit = await locate(page, target);
        const vis = hit ? await hit.locator.isVisible().catch(() => false) : false;
        return !vis;
      }
      case "text_contains":
        return (await page.content()).includes(target);
      case "text_not_contains":
        return !(await page.content()).includes(target);
      case "url_equals":
        return page.url() === target || page.url().replace(/\/$/, "") === target.replace(/\/$/, "");
      case "url_contains":
        return page.url().includes(target);
      case "count_gte": {
        const hit = await locate(page, target);
        const n = hit ? await hit.locator.count() : 0;
        return n >= Number(a.expected);
      }
      case "count_eq": {
        const hit = await locate(page, target);
        const n = hit ? await hit.locator.count() : 0;
        return n === Number(a.expected);
      }
      default:
        return false;
    }
  } catch {
    return false;
  }
}

async function runCase(page, testCase, vars, completed, shotDir, ts) {
  const result = {
    id: testCase.id,
    title: testCase.title || "",
    module: testCase.module || "",
    priority: testCase.priority || "",
    flowRefs: testCase.trace.flowRefs || [],
    status: "passed",
    durationMs: 0,
    assertions: [],
    steps: [],
    screenshot: "",
    error: null,
    isChain: Boolean((testCase.trace.dependsOn || []).length || (testCase.trace.consumes || []).length),
  };

  for (const depId of testCase.trace.dependsOn || []) {
    if (completed.get(depId) && completed.get(depId) !== "passed") {
      result.status = "skipped";
      result.error = failField(testCase.module, testCase.id, "trace.dependsOn", `上游失败传递：${depId}`);
      return result;
    }
  }
  for (const name of testCase.trace.consumes || []) {
    if (!(name in vars)) {
      result.status = "skipped";
      result.error = failField(testCase.module, testCase.id, "trace.consumes", `变量缺失：${name}`);
      return result;
    }
  }

  const t0 = Date.now();
  const stepVars = { ...vars };
  for (const step of testCase.steps || []) {
    if (Array.isArray(step.useVar)) {
      for (const v of step.useVar) {
        if (!(v in stepVars)) {
          result.status = "failed";
          result.error = failField(testCase.module, testCase.id, `steps.${step.step}.useVar`, `变量缺失：${v}`);
          break;
        }
      }
      if (result.status === "failed") break;
    }
    let stepResult;
    try {
      stepResult = await runStep(page, step, stepVars, vars.__baseUrl, vars.__menuMap);
    } catch (err) {
      stepResult = { ok: false, error: `步骤异常：${err?.message || String(err)}` };
    }
    result.steps.push({
      step: step.step,
      action: step.action,
      target: step.target,
      ok: stepResult.ok,
      strategy: stepResult.strategy || "",
      error: stepResult.error || "",
    });
    if (stepResult.screenshotHint) {
      const p = path.join(shotDir, `${testCase.id}_step${step.step}_${ts}.png`);
      await page.screenshot({ path: p }).catch(() => {});
    }
    if (step.saveAs) {
      stepVars[step.saveAs] = stepResult.outputValue ?? String(step.value ?? "");
      vars[step.saveAs] = stepVars[step.saveAs];
    }
    if (!stepResult.ok) {
      result.status = "failed";
      result.error = failField(testCase.module, testCase.id, `steps.${step.step}`, stepResult.error || "执行失败");
      break;
    }
  }

  if (result.status !== "failed") {
    let allPass = true;
    for (const assertion of testCase.assertions || []) {
      const pass = await judgeUiAssertion(page, assertion);
      if (!pass) allPass = false;
      result.assertions.push({ type: assertion.type, target: assertion.target, expected: assertion.expected, pass });
    }
    if (!allPass) {
      result.status = "failed";
      const failItem = result.assertions.find((x) => !x.pass);
      result.error = failField(testCase.module, testCase.id, `assertions.${failItem.type}`, `断言失败：${failItem.target}`);
    }
  }

  if (result.status === "failed") {
    const p = path.join(shotDir, `${testCase.id}_fail_${ts}.png`);
    await page.screenshot({ path: p }).catch(() => {});
    result.screenshot = p;
  }

  for (const name of testCase.trace.produces || []) {
    if (!(name in vars)) vars[name] = `__produced_by_${testCase.id}__`;
  }

  result.durationMs = Date.now() - t0;
  return result;
}

function buildMarkdown(meta, results, caseFile, baseUrl, browser, durationMs) {
  const total = results.length;
  const passed = results.filter((r) => r.status === "passed").length;
  const failed = results.filter((r) => r.status === "failed").length;
  const skipped = results.filter((r) => r.status === "skipped").length;
  const passRate = total ? ((passed / total) * 100).toFixed(1) : "0.0";
  const cov = meta?.coverage || {};
  const icon = (s) => (s === "passed" ? "✅" : s === "failed" ? "❌" : "⏭️");
  let md = "# UI 测试报告\n\n";
  md += `**生成时间**：${new Date().toISOString()}\n`;
  md += `**用例来源**：${caseFile}\n`;
  md += `**测试地址**：${baseUrl}\n`;
  md += `**浏览器**：${browser}\n`;
  md += `**Schema**：${meta.schema || "unknown"}\n\n---\n\n`;
  md += "## 概览\n\n";
  md += "| 指标 | 数值 |\n|------|------|\n";
  md += `| 总用例数 | ${total} |\n| 通过 | ${passed} |\n| 失败 | ${failed} |\n| 跳过 | ${skipped} |\n| 通过率 | ${passRate}% |\n| 执行耗时 | ${(durationMs / 1000).toFixed(1)}s |\n\n`;
  md += "## 覆盖统计\n\n";
  md += "| 指标 | 数值 |\n|------|------|\n";
  md += `| 主流程覆盖 | ${cov.mainFlowsCovered ?? "?"} / ${cov.mainFlowTotal ?? "?"}（${cov.mainFlowCoveragePercent ?? "?"}%） |\n`;
  md += `| 未覆盖主流程 | ${(cov.uncoveredMainFlows || []).join(", ") || "无"} |\n`;
  md += `| 孤儿用例数 | ${cov.orphanCases ?? "?"} |\n\n`;
  const failures = results.filter((r) => r.status !== "passed");
  if (failures.length) {
    md += "## 失败/跳过用例\n\n";
    for (const r of failures) {
      md += `### ${icon(r.status)} ${r.id} — ${r.title}\n\n`;
      md += `- **模块**：${r.module}\n`;
      md += `- **优先级**：${r.priority}\n`;
      md += `- **追溯主流程**：${r.flowRefs.join(", ")}\n`;
      md += `- **截图**：${r.screenshot || "无"}\n`;
      md += `- **错误信息**：${r.error || "无"}\n\n`;
    }
  }
  md += "## 全部用例明细\n\n";
  md += "| ID | 模块 | 标题 | 主流程 | 优先级 | 结果 | 耗时 |\n|----|------|------|--------|--------|------|------|\n";
  for (const r of results) {
    md += `| ${r.id} | ${r.module} | ${r.title} | ${r.flowRefs.join(",")} | ${r.priority} | ${icon(r.status)} | ${(r.durationMs / 1000).toFixed(1)}s |\n`;
  }
  return md;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { console.log(HELP); process.exit(0); }

  let caseFile;
  let payload;
  try {
    caseFile = resolveCaseFile(opts);
    payload = JSON.parse(fs.readFileSync(caseFile, "utf8"));
  } catch (e) {
    console.error(`❌ 读取用例失败：${e.message}`);
    process.exit(1);
  }
  if (!Array.isArray(payload) || payload.length < 2) {
    console.error("❌ 用例结构错误：顶层须为 [meta, ...cases]。");
    process.exit(1);
  }

  const meta = payload[0];
  const allCases = payload.slice(1);
  try {
    ensureV2Shape(meta, allCases);
  } catch (error) {
    console.error(`❌ 校验失败：${error.message}`);
    process.exit(1);
  }
  const root = path.resolve(process.cwd(), opts.artifactsDir);
  const cfg = loadUiConfig(root);

  const pwInfo = await resolvePlaywrightModule(cfg);
  if (!pwInfo) {
    console.error("❌ 未找到 Playwright npm 包。请执行 npm install playwright，或在 test-artifacts/ui-test.config.json 配置 browserResolve.playwrightModulePaths");
    process.exit(2);
  }

  const baseUrl = opts.baseUrl || meta.baseUrl || DEFAULT_BASE_URL;
  const { name: profileName, profile } = resolveProfile(opts, cfg);
  const selectedCases = filterCases(allCases, opts);
  const browserPlan = profile.engine === "auto"
    ? resolveBrowserEngine(cfg, pwInfo, profile.headed)
    : {
      engine: profile.engine,
      launchOptions: {
        headless: !profile.headed,
        ...(profile.engine === "local-chrome" ? { channel: "chrome" } : {}),
      },
      label: `${profile.engine} (${profile.headed ? "headed" : "headless"}) profile=${profileName}`,
    };

  const reportsDir = path.join(root, "ui-reports");
  const shotDir = path.join(reportsDir, "screenshots");
  fs.mkdirSync(shotDir, { recursive: true });

  const vars = { __baseUrl: baseUrl, __menuMap: meta.coverage?.routeMenuMap || [] };
  const acct = meta.testAccount || meta.auth?.testAccount;
  if (acct?.username) vars.username = acct.username;
  if (acct?.password) vars.password = acct.password;
  vars.timestamp = String(Date.now());

  const launchOptions = {
    slowMo: profile.slowMo || 0,
    ...(profile.launchOptions || {}),
    ...browserPlan.launchOptions,
  };
  const browserLabel = profile.engine === "auto"
    ? `${browserPlan.label} profile=${profileName}`
    : browserPlan.label;

  console.log(`\n🚀 UI 执行 | baseUrl=${baseUrl} | 选中 ${selectedCases.length}/${allCases.length} 条`);
  console.log(`📦 Playwright: ${pwInfo.modulePath} (v${pwInfo.version})`);
  console.log(`📁 浏览器缓存: ${pwInfo.browsersPath}`);
  console.log(`🌐 引擎: ${browserLabel}\n`);

  const browser = await pwInfo.chromium.launch(launchOptions);
  const context = await browser.newContext(profile.contextOptions || {});
  const page = await context.newPage();

  const completed = new Map();
  const results = [];
  const start = Date.now();
  const ts = timestamp();
  for (const c of selectedCases) {
    const r = await runCase(page, c, vars, completed, shotDir, ts);
    completed.set(c.id, r.status);
    results.push(r);
    const icon = r.status === "passed" ? "✅" : r.status === "failed" ? "❌" : "⏭️";
    console.log(`${icon} ${c.id} ${c.title || ""}${r.error ? ` — ${r.error}` : ""}`);
  }
  await browser.close();
  const durationMs = Date.now() - start;

  const passed = results.filter((r) => r.status === "passed").length;
  const failed = results.filter((r) => r.status === "failed").length;
  const skipped = results.filter((r) => r.status === "skipped").length;
  const md = buildMarkdown(meta, results, caseFile, baseUrl, browserLabel, durationMs);
  const reportPath = path.join(reportsDir, `ui-report-${ts}.md`);
  fs.writeFileSync(reportPath, md, "utf8");

  console.log(`\n📊 通过 ${passed} | ❌ 失败 ${failed} | ⏭️ 跳过 ${skipped}`);
  console.log(`📁 报告：${reportPath}`);
  process.exit(failed > 0 ? 1 : 0);
}

if (process.argv[1]?.endsWith("run-ui-tests.mjs")) main();

export { parseArgs, timestamp, fileExists };
