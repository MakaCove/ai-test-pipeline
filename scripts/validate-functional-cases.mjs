#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const SCHEMA = "ai-test-pipeline/functional-case/v1";
const CASE_ID_REGEX = /^TC-FUNC-[A-Z0-9-]+$/;
const HELP_TEXT = `用法:
  node scripts/validate-functional-cases.mjs [文件路径] [--strict] [--enforce-chain] [--analysis <path>]
  node scripts/validate-functional-cases.mjs [--strict] [--enforce-chain] [文件路径]

选项:
  --strict    将 warning 也视为失败（退出码 1）
  --enforce-chain  识别到可串联场景时，若无链路用例则失败
  --analysis <p>   交叉校验路由分母与 project-analysis（不传则自动探测 meta.sourceAnalysis）
  -h, --help  显示帮助
`;

// 加载 project-analysis：显式路径 > meta.sourceAnalysis > test-artifacts 下最新
function loadAnalysis(explicitPath, meta) {
  const tryRead = (p) => {
    try {
      if (!p) return null;
      const abs = path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
      if (!fs.existsSync(abs)) return null;
      return { data: JSON.parse(fs.readFileSync(abs, "utf8")), path: abs };
    } catch { return null; }
  };
  let hit = tryRead(explicitPath) || tryRead(meta?.sourceAnalysis);
  if (hit) return hit;
  try {
    const root = path.resolve(process.cwd(), "test-artifacts");
    if (!fs.existsSync(root)) return null;
    const files = fs.readdirSync(root)
      .filter((n) => /^project-analysis-.*\.json$/.test(n))
      .map((n) => ({ p: path.join(root, n), m: fs.statSync(path.join(root, n)).mtimeMs }))
      .sort((a, b) => b.m - a.m);
    return files.length ? tryRead(files[0].p) : null;
  } catch { return null; }
}

// 路由守卫识别关键词：优先读 ui-test.config.json.guardKeywords，回退中文默认。
// 同时支持结构化信号（用例 isRouteGuard:true 或 tags 含 route-guard），适配非中文项目。
const DEFAULT_GUARD_KEYWORDS = ["守卫", "重定向", "路由守卫", "守卫专项", "guard", "redirect"];

function loadGuardKeywords() {
  try {
    const cfgPath = path.resolve(process.cwd(), "test-artifacts", "ui-test.config.json");
    if (fs.existsSync(cfgPath)) {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
      if (Array.isArray(cfg.guardKeywords) && cfg.guardKeywords.length) {
        return cfg.guardKeywords.filter((k) => typeof k === "string" && k.trim());
      }
    }
  } catch { /* ignore */ }
  return DEFAULT_GUARD_KEYWORDS;
}

function isGuardCaseOf(testCase, keywords) {
  if (testCase?.module !== "auth") return false;
  // 结构化信号（语言无关，推荐）
  if (testCase?.isRouteGuard === true) return true;
  if (Array.isArray(testCase?.tags) && testCase.tags.some((t) => /route-?guard/i.test(String(t)))) return true;
  // 关键词回退
  const hay = `${testCase?.title || ""}\n${testCase?.description || ""}`;
  return keywords.some((k) => hay.includes(k));
}

const PRODUCER_TYPES = new Set(["form", "dialog", "batch", "async", "auth"]);
const CONSUMER_TYPES = new Set(["table-action", "state-display", "filter", "pagination", "readonly", "navigation", "form", "dialog", "auth"]);

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

function fileExists(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveInputFile(argvPath) {
  if (argvPath) {
    return path.resolve(process.cwd(), argvPath);
  }

  const latestPath = path.resolve(process.cwd(), "test-artifacts", "latest");
  const casesDir = path.resolve(process.cwd(), "test-artifacts", "functional-cases");

  if (fileExists(latestPath)) {
    const ts = fs.readFileSync(latestPath, "utf8").trim();
    if (ts) {
      const candidate = path.join(casesDir, `functional-cases-${ts}.json`);
      if (fileExists(candidate)) {
        return candidate;
      }
    }
  }

  if (!fileExists(casesDir)) {
    throw new Error("未找到 test-artifacts/functional-cases 目录，也没有传入文件路径。");
  }

  const files = fs
    .readdirSync(casesDir)
    .filter((name) => /^functional-cases-.*\.json$/.test(name))
    .map((name) => ({
      name,
      fullPath: path.join(casesDir, name),
      mtimeMs: fs.statSync(path.join(casesDir, name)).mtimeMs,
    }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  if (files.length === 0) {
    throw new Error("functional-cases 目录下没有找到 functional-cases-*.json 文件。");
  }

  return files[0].fullPath;
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(HELP_TEXT);
    process.exit(0);
  }

  const strictMode = args.includes("--strict");
  const enforceChainMode = args.includes("--enforce-chain");
  const analysisIdx = args.indexOf("--analysis");
  const analysisArg = analysisIdx >= 0 ? args[analysisIdx + 1] : null;
  const inputArg = args.find((arg, i) => !arg.startsWith("-") && args[i - 1] !== "--analysis");
  const guardKeywords = loadGuardKeywords();
  const issues = [];
  const warnings = [];

  const addIssue = (category, message, caseId = null) => {
    issues.push({ category, message, caseId });
  };
  const addWarning = (category, message, caseId = null) => {
    warnings.push({ category, message, caseId });
  };

  let filePath;
  let payload;
  try {
    filePath = resolveInputFile(inputArg);
    payload = readJson(filePath);
  } catch (error) {
    console.error(`❌ 读取失败: ${error.message}`);
    process.exit(1);
  }

  if (!Array.isArray(payload)) {
    addIssue("结构错误", "顶层必须是数组。");
    return finish();
  }
  if (payload.length < 2) {
    addIssue("结构错误", "顶层数组长度必须 >= 2（meta + 至少 1 条用例）。");
    return finish();
  }

  const meta = payload[0];
  const cases = payload.slice(1);
  const coverage = meta?.coverage;

  if (meta?.schema !== SCHEMA) {
    addIssue("结构错误", `schema 必须为 "${SCHEMA}"。`);
  }

  if (meta?.navigationModel && meta.navigationModel !== "menu-driven") {
    addIssue("导航路径", `navigationModel 必须为 "menu-driven"，当前为 "${meta.navigationModel}"。`);
  } else if (!meta?.navigationModel) {
    addWarning("导航路径", '建议填写 meta.navigationModel = "menu-driven"。');
  }

  const routeMenuMap = Array.isArray(coverage?.routeMenuMap) ? coverage.routeMenuMap : [];
  const menuLabelSet = new Set(
    routeMenuMap.map((item) => item?.menuLabel).filter((label) => typeof label === "string" && label.trim() !== ""),
  );
  const menuRouteSet = new Set(
    routeMenuMap
      .filter((item) => item?.menuLabel && item?.route)
      .map((item) => String(item.route).trim()),
  );

  if (meta?.navigationModel === "menu-driven" && routeMenuMap.length === 0) {
    addIssue("导航路径", "menu-driven 模式下 coverage.routeMenuMap 必须为非空数组。");
  }

  const requiredCoverageKeys = [
    "routeTotal",
    "routesCovered",
    "featureTotal",
    "featuresCovered",
    "featureCoveragePercent",
    "featureInventory",
  ];

  if (!coverage || typeof coverage !== "object") {
    addIssue("结构错误", "meta.coverage 缺失或不是对象。");
  } else {
    for (const key of requiredCoverageKeys) {
      if (!(key in coverage)) {
        addIssue("结构错误", `meta.coverage 缺少必填字段: ${key}`);
      }
    }
  }

  const featureInventory = Array.isArray(coverage?.featureInventory) ? coverage.featureInventory : [];
  const featureIdSet = new Set();
  const featureModuleMap = new Map();
  for (const feature of featureInventory) {
    if (feature?.id) {
      featureIdSet.add(feature.id);
      featureModuleMap.set(feature.id, feature.module || "");
    }
  }

  const p0FeatureIds = new Set(
    featureInventory.filter((item) => item?.priority === "P0" && item?.id).map((item) => item.id),
  );
  const allCaseIds = new Set(cases.map((item) => item?.id).filter(Boolean));
  const producesByCaseId = new Map();
  for (const item of cases) {
    const arr = Array.isArray(item?.produces)
      ? item.produces.filter((v) => typeof v === "string" && v.trim() !== "")
      : [];
    if (item?.id) {
      producesByCaseId.set(item.id, arr);
    }
  }

  const referencedFeatureIds = new Set();
  const seenCaseIds = new Set();
  let computedOrphanCases = 0;
  let chainCaseCount = 0;

  const moduleFeatureTypes = new Map();
  for (const feature of featureInventory) {
    const moduleName = feature?.module;
    const typeName = feature?.type;
    if (!moduleName || !typeName) continue;
    if (!moduleFeatureTypes.has(moduleName)) {
      moduleFeatureTypes.set(moduleName, new Set());
    }
    moduleFeatureTypes.get(moduleName).add(typeName);
  }

  const potentialChainModules = [];
  for (const [moduleName, types] of moduleFeatureTypes.entries()) {
    const hasProducer = [...types].some((t) => PRODUCER_TYPES.has(t));
    const hasConsumer = [...types].some((t) => CONSUMER_TYPES.has(t));
    if (hasProducer && hasConsumer) {
      potentialChainModules.push(moduleName);
    }
  }

  for (const testCase of cases) {
    const caseId = testCase?.id ?? "(无ID)";

    if (!testCase?.id) {
      addIssue("结构错误", "存在缺失 id 的用例对象。");
    } else if (seenCaseIds.has(testCase.id)) {
      addIssue("质量不达标", `用例 id 重复: ${testCase.id}`, caseId);
    } else {
      seenCaseIds.add(testCase.id);
      if (!CASE_ID_REGEX.test(testCase.id)) {
        addWarning("质量建议", `用例 id 建议匹配 ${CASE_ID_REGEX.toString()}`, caseId);
      }
    }

    const hasFeatureRef = typeof testCase?.featureRef === "string" && testCase.featureRef.trim() !== "";
    const hasFeatureRefs =
      Array.isArray(testCase?.featureRefs) &&
      testCase.featureRefs.filter((item) => typeof item === "string" && item.trim() !== "").length > 0;
    const isWorkflowCase = hasFeatureRefs;
    const dependsOnCases = Array.isArray(testCase?.dependsOnCases)
      ? testCase.dependsOnCases.filter((item) => typeof item === "string" && item.trim() !== "")
      : [];
    const produces = Array.isArray(testCase?.produces)
      ? testCase.produces.filter((item) => typeof item === "string" && item.trim() !== "")
      : [];
    const consumes = Array.isArray(testCase?.consumes)
      ? testCase.consumes.filter((item) => typeof item === "string" && item.trim() !== "")
      : [];
    const hasStepLevelChainSignal = Array.isArray(testCase?.steps)
      ? testCase.steps.some((step) => {
          const saveAs = typeof step?.saveAs === "string" && step.saveAs.trim() !== "";
          const useVar = typeof step?.useVar === "string" && step.useVar.trim() !== "";
          return saveAs || useVar;
        })
      : false;
    const isChainCase = hasFeatureRefs || dependsOnCases.length > 0 || produces.length > 0 || consumes.length > 0 || hasStepLevelChainSignal;
    if (isChainCase) {
      chainCaseCount += 1;
    }

    if (!isWorkflowCase && !hasFeatureRef) {
      addIssue("追溯缺失", "非流程用例必须包含 featureRef。", caseId);
      computedOrphanCases += 1;
    }
    if (Array.isArray(testCase?.featureRefs) && testCase.featureRefs.length === 0) {
      addIssue("追溯缺失", "featureRefs 为空数组，流程用例必须提供非空引用。", caseId);
      computedOrphanCases += 1;
    }
    if (Array.isArray(testCase?.dependsOnCases) && testCase.dependsOnCases.length === 0) {
      addIssue("链路缺失", "dependsOnCases 为空数组，存在该字段时必须为非空。", caseId);
    }
    for (const depId of dependsOnCases) {
      if (!allCaseIds.has(depId)) {
        addIssue("链路缺失", `dependsOnCases 引用了不存在的上游用例: ${depId}`, caseId);
      }
    }

    const availableFromDeps = new Set();
    for (const depId of dependsOnCases) {
      const produced = producesByCaseId.get(depId) || [];
      for (const variable of produced) {
        availableFromDeps.add(variable);
      }
    }
    for (const variable of consumes) {
      if (!produces.includes(variable) && !availableFromDeps.has(variable)) {
        addIssue("链路缺失", `consumes 变量未在当前用例 produces 或 dependsOnCases 上游产出中找到: ${variable}`, caseId);
      }
    }

    const refs = [];
    if (hasFeatureRef) refs.push(testCase.featureRef);
    if (hasFeatureRefs) refs.push(...testCase.featureRefs);

    for (const ref of refs) {
      referencedFeatureIds.add(ref);
      if (!featureIdSet.has(ref)) {
        addIssue("追溯缺失", `引用的功能点不存在于 featureInventory: ${ref}`, caseId);
      } else {
        const expectedModule = featureModuleMap.get(ref);
        if (testCase?.module && expectedModule && testCase.module !== expectedModule) {
          addIssue(
            "质量不达标",
            `module 与功能点模块不一致（case.module=${testCase.module}, feature.module=${expectedModule}, ref=${ref}）`,
            caseId,
          );
        }
      }
    }

    if (!testCase?.module || String(testCase.module).trim() === "") {
      addIssue("质量不达标", "module 不能为空。", caseId);
    }

    const steps = Array.isArray(testCase?.steps) ? testCase.steps : [];
    const assertions = Array.isArray(testCase?.assertions) ? testCase.assertions : [];

    if (steps.length < 1) {
      addIssue("质量不达标", "steps 至少需要 1 步。", caseId);
    } else if (testCase?.priority === "P0" && steps.length < 3) {
      addWarning("质量建议", "P0 用例建议至少 3 步。", caseId);
    }
    if (assertions.length < 2) {
      addIssue("质量不达标", "assertions 至少需要 2 条。", caseId);
    }

    const stepSavedVars = new Set();
    const isGuardCase = isGuardCaseOf(testCase, guardKeywords);
    const hasAuthTabSwitch = steps.some((s) => s?.action === "switch_auth_tab");

    for (const step of steps) {
      const saveAs = typeof step?.saveAs === "string" ? step.saveAs.trim() : "";
      const useVar = typeof step?.useVar === "string" ? step.useVar.trim() : "";

      if (saveAs) {
        stepSavedVars.add(saveAs);
      }
      if (useVar) {
        const isAvailable =
          stepSavedVars.has(useVar) || produces.includes(useVar) || availableFromDeps.has(useVar);
        if (!isAvailable) {
          addWarning("质量建议", `steps.useVar 未在可用变量池中找到: ${useVar}`, caseId);
        }
      }

      if (step?.action !== "fill") continue;

      const target = String(step?.target ?? "");
      const value = String(step?.value ?? "");
      const valueLower = value.toLowerCase();

      if (valueLower === "admin" || valueLower === "123admin") {
        addIssue("硬编码风险", `检测到默认账号口令硬编码: ${value}`, caseId);
      }

    }

    // --- 导航路径校验（menu-driven）---
    if (meta?.navigationModel === "menu-driven") {
      const hasNavigateToMenuRoute = steps.some((step) => {
        if (step?.action !== "navigate") return false;
        const target = String(step?.target ?? "").trim();
        return menuRouteSet.has(target);
      });

      if (hasNavigateToMenuRoute && testCase?.module !== "auth") {
        addIssue(
          "导航路径",
          `业务模块用例不得 navigate 进入菜单可达路由，应使用 click_menu（${caseId}）。`,
          caseId,
        );
      }
      if (hasNavigateToMenuRoute && testCase?.module === "auth" && !isGuardCase) {
        addIssue(
          "导航路径",
          `auth 模块非守卫专项不得 navigate 进入菜单路由，登录页请用 open_login（${caseId}）。`,
          caseId,
        );
      }

      for (const step of steps) {
        if (step?.action === "click_menu") {
          const label = String(step?.target ?? "").trim();
          if (label && !menuLabelSet.has(label)) {
            addIssue("导航路径", `click_menu target「${label}」不在 routeMenuMap.menuLabel 中。`, caseId);
          }
        }
      }

      if (hasAuthTabSwitch && !steps.some((s) => s?.action === "open_login")) {
        addWarning("导航路径", "存在 switch_auth_tab 时，建议先显式 open_login。", caseId);
      }

      const isBusinessCase = testCase?.module && testCase.module !== "auth";
      const needsMenuEntry = steps.some((s) =>
        ["click", "fill", "select"].includes(s?.action),
      );
      if (isBusinessCase && needsMenuEntry && !steps.some((s) => s?.action === "click_menu")) {
        addWarning("导航路径", "业务模块功能用例建议包含 click_menu 进入目标页面。", caseId);
      }
    }
  }

  if (coverage && typeof coverage === "object") {
    const {
      routeTotal,
      routesCovered,
      routeCoveragePercent,
      featureTotal,
      featuresCovered,
      featureCoveragePercent,
      uncoveredFeatures,
      orphanCases,
      flowChains,
    } = coverage;

    if (Number.isFinite(routeTotal) && routeTotal > 0 && Number.isFinite(routesCovered)) {
      const expected = Math.round((routesCovered / routeTotal) * 100);
      if (Number(routeCoveragePercent) !== expected) {
        addIssue("覆盖不足", `routeCoveragePercent 不一致，期望 ${expected}，实际 ${routeCoveragePercent}`);
      }
    }
    if (Number.isFinite(featureTotal) && featureTotal > 0 && Number.isFinite(featuresCovered)) {
      const expected = Math.round((featuresCovered / featureTotal) * 100);
      if (Number(featureCoveragePercent) !== expected) {
        addIssue("覆盖不足", `featureCoveragePercent 不一致，期望 ${expected}，实际 ${featureCoveragePercent}`);
      }
    }

    if (Array.isArray(uncoveredFeatures) && uncoveredFeatures.length > 0) {
      addIssue("覆盖不足", `uncoveredFeatures 必须为空，当前 ${uncoveredFeatures.length} 项。`);
    }
    if (Number.isFinite(orphanCases) && orphanCases !== 0) {
      addIssue("追溯缺失", `coverage.orphanCases 必须为 0，当前为 ${orphanCases}。`);
    }
    if (Number.isFinite(orphanCases) && Number.isFinite(computedOrphanCases) && orphanCases !== computedOrphanCases) {
      addIssue("追溯缺失", `coverage.orphanCases 与实算不一致（meta=${orphanCases}, computed=${computedOrphanCases}）。`);
    }

    if (flowChains && typeof flowChains === "object") {
      const { chainScenarioTotal, chainScenarioCovered, chainScenarioCoveragePercent } = flowChains;
      if (
        Number.isFinite(chainScenarioTotal) &&
        chainScenarioTotal > 0 &&
        Number.isFinite(chainScenarioCovered) &&
        Number.isFinite(chainScenarioCoveragePercent)
      ) {
        const expected = Math.round((chainScenarioCovered / chainScenarioTotal) * 100);
        if (expected !== chainScenarioCoveragePercent) {
          addIssue(
            "链路缺失",
            `flowChains.chainScenarioCoveragePercent 不一致，期望 ${expected}，实际 ${chainScenarioCoveragePercent}`,
          );
        }
      }
      if (Number.isFinite(chainScenarioTotal) && Number(chainScenarioTotal) > 0 && Number(chainScenarioCovered) === 0) {
        addIssue("链路缺失", "flowChains 显示存在可串联场景，但 chainScenarioCovered 为 0。");
      }
      if (Number.isFinite(chainScenarioCovered) && Number(chainScenarioCovered) > 0 && chainCaseCount === 0) {
        addIssue("链路缺失", "flowChains 显示已覆盖链路场景，但未检测到链路用例字段表达。");
      }
    }
  }

  if (enforceChainMode) {
    const chainScenarioTotal = coverage?.flowChains?.chainScenarioTotal;
    const hasDeclaredChainScenarios = Number.isFinite(chainScenarioTotal) && Number(chainScenarioTotal) > 0;
    const hasInferredChainPotential = potentialChainModules.length > 0;
    const shouldHaveChainCases = hasDeclaredChainScenarios || hasInferredChainPotential;

    if (shouldHaveChainCases && chainCaseCount === 0) {
      const reason = hasDeclaredChainScenarios
        ? `flowChains.chainScenarioTotal=${chainScenarioTotal}`
        : `推断存在可串联模块: ${potentialChainModules.join(", ")}`;
      addIssue("链路缺失", `启用 --enforce-chain 时要求至少 1 条链路用例，当前为 0（依据：${reason}）。`);
    }
    if (hasInferredChainPotential && !coverage?.flowChains) {
      addWarning("质量建议", "检测到可串联模块，建议补充 coverage.flowChains 统计链路覆盖。");
    }
  }

  for (const p0Id of p0FeatureIds) {
    if (!referencedFeatureIds.has(p0Id)) {
      addIssue("覆盖不足", `P0 功能点未被任何用例引用: ${p0Id}`);
    }
  }

  // ── 覆盖率分母锚定：路由分母与 project-analysis 交叉校验 ──
  const analysis = loadAnalysis(analysisArg, meta);
  if (analysis) {
    const discovered = Number(analysis.data?.summary?.totalRoutes);
    const declared = Number(coverage?.routeTotal);
    if (Number.isFinite(discovered) && discovered > 0 && Number.isFinite(declared)) {
      if (declared < discovered) {
        addIssue(
          "覆盖不足",
          `routeTotal(${declared}) 小于 project-analysis 发现的路由数(${discovered})，疑似缩小分母伪造覆盖率。分析文件: ${analysis.path}`,
        );
      } else if (declared > discovered) {
        addWarning(
          "质量建议",
          `routeTotal(${declared}) 大于 project-analysis 路由数(${discovered})，请确认是否人工补充了分析外路由。`,
        );
      }
    }
  } else if (analysisArg) {
    addWarning("质量建议", `指定的 --analysis 路径不可读，跳过分母交叉校验: ${analysisArg}`);
  }

  function finish() {
    console.log(`\n📄 文件: ${filePath}`);
    const modeParts = [];
    modeParts.push(strictMode ? "strict（warning 将导致失败）" : "normal");
    if (enforceChainMode) modeParts.push("enforce-chain（链路门禁开启）");
    console.log(`🔒 模式: ${modeParts.join(" + ")}`);
    console.log(`🧪 用例数: ${cases.length}`);
    console.log(`🔗 链路用例: ${chainCaseCount}`);
    console.log(`⚠️  警告: ${warnings.length}`);
    console.log(`❌ 错误: ${issues.length}\n`);

    const printGroup = (title, list) => {
      if (list.length === 0) return;
      console.log(`${title}:`);
      for (const item of list) {
        const prefix = item.caseId ? `  - [${item.caseId}]` : "  -";
        console.log(`${prefix} ${item.message}`);
      }
      console.log("");
    };

    const categories = ["结构错误", "覆盖不足", "追溯缺失", "链路缺失", "导航路径", "质量不达标", "硬编码风险"];
    for (const category of categories) {
      printGroup(category, issues.filter((it) => it.category === category));
    }
    printGroup("质量建议", warnings);

    if (issues.length > 0) {
      console.log("❌ 校验失败：请按分类修复后重试。");
      process.exit(1);
    }
    if (strictMode && warnings.length > 0) {
      console.log("❌ 严格模式失败：存在 warning，请先修复后重试。");
      process.exit(1);
    }
    console.log("✅ 校验通过：functional-cases 文件符合当前机检规则。");
    process.exit(0);
  }

  finish();
}

main();
