#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const SCHEMA = "ai-test-pipeline/functional-case/v1";
const CASE_ID_REGEX = /^TC-FUNC-[A-Z0-9-]+$/;
const HELP_TEXT = `用法:
  node scripts/validate-functional-cases.mjs [文件路径] [--strict] [--enforce-chain]
  node scripts/validate-functional-cases.mjs [--strict] [--enforce-chain] [文件路径]

选项:
  --strict    将 warning 也视为失败（退出码 1）
  --enforce-chain  识别到可串联场景时，若无链路用例则失败
  -h, --help  显示帮助
`;

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
  const inputArg = args.find((arg) => !arg.startsWith("-"));
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

      if (/用户名/.test(target) && !/\{\{username\}\}/.test(value)) {
        addIssue("硬编码风险", "登录用户名输入建议使用 {{username}} 占位。", caseId);
      }
      if (/密码/.test(target) && !/\{\{password\}\}/.test(value)) {
        addIssue("硬编码风险", "登录密码输入建议使用 {{password}} 占位。", caseId);
      }

      if (/项目名称|名称/.test(target) && !/\{\{timestamp\}\}/.test(value)) {
        addWarning("质量建议", "创建型数据建议追加 {{timestamp}} 保证可重复执行。", caseId);
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

    const categories = ["结构错误", "覆盖不足", "追溯缺失", "链路缺失", "质量不达标", "硬编码风险"];
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
