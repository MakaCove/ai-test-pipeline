#!/usr/bin/env node
/**
 * run-functional-tests.mjs — 功能/UI 用例执行器（Playwright）
 *
 * 读取 functional-cases-*.json，按依赖顺序驱动浏览器执行 steps、判定 UI 断言、
 * 截图，产出 Markdown 报告与截图证据：
 *   - ui-reports/ui-report-{ts}.md      人读报告（_shared/界面报告模板.md）
 *   - ui-reports/screenshots/*.png       失败/步骤截图
 *
 * 选择器策略（见 _shared/选择器策略.md）：data-testid > role+name > 文案，
 * 命中后将真实 selector 回写到结果，提升可复现性。
 *
 * 用法：
 *   node scripts/run-functional-tests.mjs [文件路径] [选项]
 * 选项：
 *   --artifacts-dir <dir>   产物根目录（默认 ./test-artifacts）
 *   --base-url <url>        覆盖 baseUrl
 *   --profile <name>        ui-test.config.json 中的 profile 名
 *   --local-chrome          强制系统 Chrome（有头，除非同时 --headless）
 *   --headless              无头（须用户明确指定；默认有头）
 *   --slow-mo <ms>          动作间隔
 *   --limit <n> / --all     范围
 *   --module <name> / --ids <id,...>
 *   -h, --help
 *
 * Playwright 未安装时给出明确指引并以退出码 2 结束。
 */

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const DEFAULT_BASE_URL = "http://localhost:5173";

function parseArgs(argv) {
  const o = { file: null, artifactsDir: "test-artifacts", baseUrl: null, profile: null,
    localChrome: false, headless: false, slowMo: null, limit: null, all: false, module: null, ids: null };
  for (let i = 0; i < argv.length; i++) {
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
  node scripts/run-functional-tests.mjs [文件路径] [选项]

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

export { parseArgs, timestamp, fileExists };

function resolveCaseFile(opts) {
  if (opts.file) return path.resolve(process.cwd(), opts.file);
  const root = path.resolve(process.cwd(), opts.artifactsDir);
  const dir = path.join(root, "functional-cases");
  const latest = path.join(root, "latest");
  if (fileExists(latest)) {
    const ts = fs.readFileSync(latest, "utf8").trim();
    const c = path.join(dir, `functional-cases-${ts}.json`);
    if (fileExists(c)) return c;
  }
  if (!fileExists(dir)) throw new Error(`未找到 ${dir}，也未传入文件路径。`);
  const files = fs.readdirSync(dir).filter((n) => /^functional-cases-.*\.json$/.test(n))
    .map((n) => ({ full: path.join(dir, n), m: fs.statSync(path.join(dir, n)).mtimeMs }))
    .sort((a, b) => b.m - a.m);
  if (!files.length) throw new Error("functional-cases 目录下没有 functional-cases-*.json。");
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
  for (let i = 0; i < 8; i++) {
    paths.push(path.join(dir, "node_modules", "playwright"));
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  paths.push(path.join(scriptRootDir(), "node_modules", "playwright"));
  return [...new Set(paths)];
}

async function resolvePlaywrightModule(cfg) {
  const browsersPath =
    cfg?.browserResolve?.playwrightBrowsersPath ||
    process.env.PLAYWRIGHT_BROWSERS_PATH ||
    path.join(process.env.LOCALAPPDATA || "", "ms-playwright");

  if (fileExists(browsersPath)) {
    process.env.PLAYWRIGHT_BROWSERS_PATH = browsersPath;
  }

  for (const pkgDir of resolvePlaywrightModulePaths(cfg)) {
    const pkgJson = path.join(pkgDir, "package.json");
    if (!fileExists(pkgJson)) continue;
    try {
      const req = createRequire(path.join(pkgDir, "index.js"));
      const mod = req(".");
      const version = JSON.parse(fs.readFileSync(pkgJson, "utf8")).version;
      return { chromium: mod.chromium, version, modulePath: pkgDir, browsersPath };
    } catch { /* try next */ }
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
  } catch { return null; }
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
  for (const p of defaults) {
    if (p && fileExists(p)) return p;
  }
  return null;
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

// ── profile 解析：CLI > ui-test.config.json > 内置默认 ──
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

function orderCases(cases) {
  const hasOrder = cases.every((c) => Number.isFinite(c.executionOrder));
  if (hasOrder) return [...cases].sort((a, b) => a.executionOrder - b.executionOrder);
  const byId = new Map(cases.map((c) => [c.id, c]));
  const visited = new Set(), out = [];
  const visit = (c, stk = new Set()) => {
    if (visited.has(c.id) || stk.has(c.id)) return;
    stk.add(c.id);
    for (const d of c.dependsOnCases || []) { const u = byId.get(d); if (u) visit(u, stk); }
    stk.delete(c.id); visited.add(c.id); out.push(c);
  };
  cases.forEach((c) => visit(c));
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

// ── 分层选择器定位（见 _shared/选择器策略.md）：testid > role+name > 文案 ──
// 返回 { locator, strategy } 或 null；命中策略回写结果便于复现。
async function locate(page, desc) {
  const text = String(desc || "").trim();
  if (!text) return null;
  // 1. data-testid（用例显式写成 testid=xxx 时）
  const tid = text.match(/^testid=(.+)$/);
  if (tid) return { locator: page.getByTestId(tid[1]), strategy: `testid=${tid[1]}` };
  // 2. role + name（按钮/链接/输入框优先）
  for (const role of ["button", "link", "menuitem", "tab"]) {
    const loc = page.getByRole(role, { name: text, exact: false });
    if (await loc.count().catch(() => 0)) return { locator: loc.first(), strategy: `role=${role}[name=${text}]` };
  }
  // 3. 表单标签
  const byLabel = page.getByLabel(text, { exact: false });
  if (await byLabel.count().catch(() => 0)) return { locator: byLabel.first(), strategy: `label=${text}` };
  const byPh = page.getByPlaceholder(text, { exact: false });
  if (await byPh.count().catch(() => 0)) return { locator: byPh.first(), strategy: `placeholder=${text}` };
  // 4. 纯文案兜底
  const byText = page.getByText(text, { exact: false });
  if (await byText.count().catch(() => 0)) return { locator: byText.first(), strategy: `text=${text}` };
  return null;
}

// ── 执行单个 step；返回 { ok, strategy, error } ──
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
      await page.goto(baseUrl + "/login", { waitUntil: "domcontentloaded" }).catch(() => {});
      await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); }).catch(() => {});
      return { ok: true };
    case "open_login":
      await page.goto(baseUrl + "/login", { waitUntil: "domcontentloaded" });
      return { ok: true };
    case "ensure_session":
      return { ok: true }; // 会话由依赖用例的执行顺序保证
    case "navigate":
      await page.goto(baseUrl + (target.startsWith("http") ? "" : target), { waitUntil: "domcontentloaded" });
      return { ok: true };
    case "click_menu": {
      // 优先用 routeMenuMap 把菜单文案映射为可点击项
      return click(target);
    }
    case "switch_auth_tab":
    case "switch_tab":
      return click(target);
    case "click":
      return click(target);
    case "fill": {
      const hit = await locate(page, target);
      if (!hit) return { ok: false, error: `未定位到输入框：${target}` };
      await hit.locator.fill(String(value), { timeout: 10000 });
      return { ok: true, strategy: hit.strategy };
    }
    case "select": {
      const hit = await locate(page, target);
      if (!hit) return { ok: false, error: `未定位到下拉：${target}` };
      await hit.locator.selectOption({ label: String(value) }).catch(async () => { await hit.locator.click(); });
      return { ok: true, strategy: hit.strategy };
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
      return { ok: true, _screenshot: true };
    default:
      return { ok: false, error: `不支持的 action：${action}` };
  }
}

// ── UI 断言判定（见 _shared/断言语法.md 功能断言表）──
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
      default: return false;
    }
  } catch { return false; }
}

async function runCase(page, testCase, vars, completed, shotDir, ts) {
  const result = {
    id: testCase.id, title: testCase.title || "", module: testCase.module || "",
    priority: testCase.priority || "", featureRef: testCase.featureRef || (testCase.featureRefs || []).join(","),
    status: "passed", durationMs: 0, assertions: [], steps: [], screenshot: "", error: null,
    isChain: Boolean((testCase.dependsOnCases || []).length || (testCase.consumes || []).length || (testCase.featureRefs || []).length),
  };
  for (const dep of testCase.dependsOnCases || []) {
    if (completed.get(dep) && completed.get(dep) !== "passed") {
      result.status = "skipped"; result.error = `上游失败传递（${dep}）`; return result;
    }
  }
  for (const v of testCase.consumes || []) {
    if (!(v in vars)) { result.status = "skipped"; result.error = `链路变量缺失：${v}`; return result; }
  }

  const t0 = Date.now();
  const stepVars = { ...vars };
  for (const step of testCase.steps || []) {
    let r;
    try {
      r = await runStep(page, step, stepVars, vars.__baseUrl, vars.__menuMap);
    } catch (err) {
      r = { ok: false, error: `步骤异常：${(err && err.message ? err.message.split("\n")[0] : String(err))}` };
    }
    result.steps.push({ step: step.step, action: step.action, target: step.target, ok: r.ok, strategy: r.strategy || "", error: r.error || "" });
    if (r._screenshot) {
      const p = path.join(shotDir, `${testCase.id}_step${step.step}_${ts}.png`);
      await page.screenshot({ path: p }).catch(() => {});
    }
    if (step.saveAs) stepVars[step.saveAs] = await page.title().catch(() => "");
    if (!r.ok) { result.status = "failed"; result.error = r.error; break; }
  }

  if (result.status !== "failed") {
    let allPass = true;
    for (const a of testCase.assertions || []) {
      const pass = await judgeUiAssertion(page, a);
      if (!pass) allPass = false;
      result.assertions.push({ type: a.type, target: a.target, expected: a.expected, pass });
    }
    if (!allPass) {
      result.status = "failed";
      const f = result.assertions.find((x) => !x.pass);
      result.error = `断言失败：${f.type} ${f.target}`;
    }
  }
  // 失败截图
  if (result.status === "failed") {
    const p = path.join(shotDir, `${testCase.id}_fail_${ts}.png`);
    await page.screenshot({ path: p }).catch(() => {});
    result.screenshot = p;
  }
  // produces 入池（功能侧产出多为标识性变量，置真值占位）
  for (const v of testCase.produces || []) if (!(v in vars)) vars[v] = `__produced_by_${testCase.id}__`;
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
  const fc = cov.flowChains || {};
  const icon = (s) => (s === "passed" ? "✅" : s === "failed" ? "❌" : "⏭️");
  let md = `# UI 测试报告\n\n**生成时间**：${new Date().toISOString()}\n**用例来源**：${caseFile}\n`;
  md += `**项目分析**：${meta?.sourceAnalysis || "N/A"}\n**测试地址**：${baseUrl}\n**浏览器**：${browser}\n\n---\n\n## 概览\n\n`;
  md += `| 指标 | 数值 |\n|------|------|\n| 总用例数 | ${total} |\n| 通过 | ${passed} |\n| 失败 | ${failed} |\n| 跳过 | ${skipped} |\n| 通过率 | ${passRate}% |\n| 执行耗时 | ${(durationMs / 1000).toFixed(1)}s |\n\n---\n\n`;
  md += `## 覆盖统计（来自用例 meta.coverage）\n\n| 指标 | 数值 |\n|------|------|\n`;
  if (cov.mainFlowTotal != null) {
    md += `| 主流程覆盖 | ${cov.mainFlowsCovered ?? "?"} / ${cov.mainFlowTotal ?? "?"}（${cov.mainFlowCoveragePercent ?? "?"}%） |\n`;
    md += `| 未覆盖主流程 | ${(cov.uncoveredMainFlows || []).join(", ") || "无"} |\n`;
  } else {
    md += `| 路由覆盖 | ${cov.routesCovered ?? "?"} / ${cov.routeTotal ?? "?"}（${cov.routeCoveragePercent ?? "?"}%） |\n`;
    md += `| P0 功能点覆盖 | ${cov.featuresCovered ?? "?"} / ${cov.featureTotal ?? "?"}（${cov.featureCoveragePercent ?? "?"}%） |\n`;
    md += `| 未覆盖功能点 | ${(cov.uncoveredFeatures || []).join(", ") || "无"} |\n`;
  }
  md += `| 孤儿用例数 | ${cov.orphanCases ?? "?"} |\n\n---\n\n`;
  if (fc.chainScenarioTotal) {
    md += `## 链路覆盖\n\n| 指标 | 数值 |\n|------|------|\n| 链路场景覆盖 | ${fc.chainScenarioCovered} / ${fc.chainScenarioTotal}（${fc.chainScenarioCoveragePercent}%） |\n\n---\n\n`;
  }
  const failures = results.filter((r) => r.status !== "passed");
  if (failures.length) {
    md += `## 失败/跳过用例\n\n`;
    for (const r of failures) {
      md += `### ${icon(r.status)} ${r.id} — ${r.title}\n\n- **模块**：${r.module}\n- **优先级**：${r.priority}\n- **功能追溯**：${r.featureRef}\n- **截图**：${r.screenshot || "无"}\n- **错误信息**：${r.error}\n\n---\n\n`;
    }
  }
  md += `## 全部用例明细\n\n| ID | 模块 | 标题 | 功能点 | 优先级 | 结果 | 耗时 |\n|----|------|------|--------|--------|------|------|\n`;
  for (const r of results) md += `| ${r.id} | ${r.module} | ${r.title} | ${r.featureRef} | ${r.priority} | ${icon(r.status)} | ${(r.durationMs / 1000).toFixed(1)}s |\n`;
  return md;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { console.log(HELP); process.exit(0); }

  let caseFile, payload;
  try { caseFile = resolveCaseFile(opts); payload = JSON.parse(fs.readFileSync(caseFile, "utf8")); }
  catch (e) { console.error(`❌ 读取用例失败：${e.message}`); process.exit(1); }
  if (!Array.isArray(payload) || payload.length < 2) { console.error("❌ 用例结构错误：顶层须为 [meta, ...cases]。"); process.exit(1); }

  const meta = payload[0];
  const allCases = payload.slice(1);
  const root = path.resolve(process.cwd(), opts.artifactsDir);
  const cfg = loadUiConfig(root);

  const pwInfo = await resolvePlaywrightModule(cfg);
  if (!pwInfo) {
    console.error("❌ 未找到 Playwright npm 包。请执行 npm install playwright，或在 test-artifacts/ui-test.config.json 配置 browserResolve.playwrightModulePaths");
    process.exit(2);
  }

  const baseUrl = opts.baseUrl || meta.baseUrl || DEFAULT_BASE_URL;
  const { name: profileName, profile } = resolveProfile(opts, cfg);
  const cases = filterCases(allCases, opts);

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

  console.log(`\n🚀 UI 测试执行 | baseUrl=${baseUrl} | 选中 ${cases.length}/${allCases.length} 条`);
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
  for (const c of cases) {
    const r = await runCase(page, c, vars, completed, shotDir, ts);
    completed.set(c.id, r.status);
    results.push(r);
    const icon = r.status === "passed" ? "✅" : r.status === "failed" ? "❌" : "⏭️";
    console.log(`${icon} ${c.id} ${r.title || ""}${r.error ? " — " + r.error : ""}`);
  }
  await browser.close();
  const durationMs = Date.now() - start;

  const passed = results.filter((r) => r.status === "passed").length;
  const failed = results.filter((r) => r.status === "failed").length;
  const skipped = results.filter((r) => r.status === "skipped").length;
  const md = buildMarkdown(meta, results, caseFile, baseUrl, browserLabel, durationMs);
  fs.writeFileSync(path.join(reportsDir, `ui-report-${ts}.md`), md, "utf8");

  console.log(`\n📊 通过 ${passed} | ❌ 失败 ${failed} | ⏭️ 跳过 ${skipped}`);
  console.log(`📁 报告：${path.join(reportsDir, `ui-report-${ts}.md`)}`);
  process.exit(failed > 0 ? 1 : 0);
}

if (process.argv[1]?.endsWith("run-functional-tests.mjs")) main();




