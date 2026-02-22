import "./chunk-3RG5ZIWI.js";

// src/rule-evaluator.ts
var parserCache = null;
var LANGUAGE_MAP = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "typescript",
  ".jsx": "typescript",
  ".py": "python",
  ".go": "go"
};
function detectLanguage(filePath) {
  const ext = filePath.slice(filePath.lastIndexOf("."));
  return LANGUAGE_MAP[ext] ?? null;
}
async function getParser(language) {
  if (!parserCache) {
    parserCache = /* @__PURE__ */ new Map();
  }
  if (parserCache.has(language)) {
    return parserCache.get(language);
  }
  try {
    const TreeSitter = (await import("web-tree-sitter")).default;
    await TreeSitter.init();
    const parser = new TreeSitter();
    const langFile = `tree-sitter-${language}.wasm`;
    try {
      const { join } = await import("path");
      const { existsSync } = await import("fs");
      const possiblePaths = [
        join(process.cwd(), "node_modules", `tree-sitter-${language}`, langFile),
        join(process.cwd(), "node_modules", "web-tree-sitter", langFile)
      ];
      let wasmPath = null;
      for (const p of possiblePaths) {
        if (existsSync(p)) {
          wasmPath = p;
          break;
        }
      }
      if (!wasmPath) {
        return null;
      }
      const lang = await TreeSitter.Language.load(wasmPath);
      parser.setLanguage(lang);
      parserCache.set(language, parser);
      return parser;
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}
function collectNodesByType(node, targetTypes) {
  const results = [];
  function walk(n) {
    if (targetTypes.includes(n.type)) {
      results.push(n);
    }
    for (const child of n.children) {
      walk(child);
    }
  }
  walk(node);
  return results;
}
async function evaluateStructural(rule, filePath, content) {
  const language = detectLanguage(filePath);
  if (!language) return [];
  const parser = await getParser(language);
  if (!parser) return [];
  const tree = parser.parse(content);
  const targetTypes = rule.query.split(",").map((t) => t.trim()).filter(Boolean);
  if (targetTypes.length === 0) return [];
  const matches = collectNodesByType(tree.rootNode, targetTypes);
  return matches.map((node) => ({
    ruleKey: rule.key,
    ruleName: rule.name,
    severity: rule.severity,
    message: rule.message || `Structural rule "${rule.name}" matched node type "${node.type}"`,
    filePath,
    line: node.startPosition.row + 1,
    matchedCode: node.text.slice(0, 200)
  }));
}
function evaluateNaming(rule, filePath, localGraph) {
  const entities = localGraph.getEntitiesByFile(filePath);
  if (entities.length === 0) return [];
  let regex;
  try {
    regex = new RegExp(rule.query);
  } catch {
    return [];
  }
  const violations = [];
  for (const entity of entities) {
    if (regex.test(entity.name)) {
      violations.push({
        ruleKey: rule.key,
        ruleName: rule.name,
        severity: rule.severity,
        message: rule.message || `Naming rule "${rule.name}" matched entity "${entity.name}"`,
        filePath,
        line: entity.start_line,
        matchedCode: entity.name
      });
    }
  }
  return violations;
}
async function evaluateRules(rules, filePath, content, localGraph) {
  const violations = [];
  let structuralCount = 0;
  let namingCount = 0;
  let skippedCount = 0;
  for (const rule of rules) {
    if (!rule.enabled) {
      skippedCount++;
      continue;
    }
    switch (rule.engine) {
      case "structural": {
        structuralCount++;
        const structViolations = await evaluateStructural(rule, filePath, content);
        violations.push(...structViolations);
        break;
      }
      case "naming": {
        namingCount++;
        const nameViolations = evaluateNaming(rule, filePath, localGraph);
        violations.push(...nameViolations);
        break;
      }
      default:
        skippedCount++;
        break;
    }
  }
  return {
    violations,
    _meta: {
      source: "local",
      evaluatedRules: structuralCount + namingCount,
      skippedRules: skippedCount,
      engines: {
        structural: structuralCount,
        naming: namingCount,
        skipped: skippedCount
      }
    }
  };
}
export {
  evaluateRules
};
