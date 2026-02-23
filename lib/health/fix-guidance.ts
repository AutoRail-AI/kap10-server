/**
 * Fix guidance and rule templates for each health risk type.
 * Maps riskType → human-readable title, fix guidance, and pre-filled rule template.
 */

import type { RuleType, RuleEnforcement } from "@/lib/ports/types"

export interface FixGuidance {
  title: string
  icon: string
  category: "dead_code" | "architecture" | "quality" | "complexity" | "taxonomy"
  howToFix: string
  ruleTemplate: {
    title: string
    description: string
    type: RuleType
    enforcement: RuleEnforcement
    priority: number
  }
}

export const FIX_GUIDANCE: Record<string, FixGuidance> = {
  low_confidence: {
    title: "Low Confidence Classifications",
    icon: "AlertTriangle",
    category: "quality",
    howToFix:
      "Review entities with confidence below 0.5. Add docstrings, JSDoc comments, or rename functions/classes to better express their purpose. Re-run the justification pipeline after improving documentation.",
    ruleTemplate: {
      title: "Require documentation for low-confidence entities",
      description: "Entities with classification confidence below 0.5 must have explicit documentation (JSDoc/docstring) explaining their business purpose.",
      type: "style",
      enforcement: "warn",
      priority: 60,
    },
  },
  untested_vertical: {
    title: "Untested Business Logic",
    icon: "ShieldAlert",
    category: "quality",
    howToFix:
      "VERTICAL entities are business-critical. Low confidence on these suggests they lack tests or clear documentation. Add unit tests and business-context comments to improve confidence.",
    ruleTemplate: {
      title: "Require tests for VERTICAL entities",
      description: "Business-critical (VERTICAL) entities must have corresponding test files to ensure reliability.",
      type: "architecture",
      enforcement: "warn",
      priority: 80,
    },
  },
  single_entity_feature: {
    title: "Orphan Feature",
    icon: "Unplug",
    category: "taxonomy",
    howToFix:
      "A feature with only one entity may indicate misclassification. Review the entity's feature_tag — it may belong to a larger feature group, or the feature name may be too specific.",
    ruleTemplate: {
      title: "Investigate single-entity features",
      description: "Features with only one entity may indicate misclassification or incomplete implementation.",
      type: "architecture",
      enforcement: "suggest",
      priority: 30,
    },
  },
  high_utility_ratio: {
    title: "Excessive Utility Classification",
    icon: "Layers",
    category: "taxonomy",
    howToFix:
      "When over 70% of entities are UTILITY, the classifier may be missing business context. Review a sample of UTILITY entities — some may actually be HORIZONTAL (shared services) or VERTICAL (business logic).",
    ruleTemplate: {
      title: "Review UTILITY entity classifications",
      description: "High percentage of UTILITY entities may indicate classification issues. Review and reclassify where appropriate.",
      type: "architecture",
      enforcement: "suggest",
      priority: 40,
    },
  },
  dead_code: {
    title: "Dead Code Detected",
    icon: "Trash2",
    category: "dead_code",
    howToFix:
      "These entities have no inbound references, aren't exported, and aren't entry points. They may be truly unused code that can be safely removed. Verify each before deletion — some may be used via reflection, dynamic imports, or external tools.",
    ruleTemplate: {
      title: "Remove dead code",
      description: "Unreferenced functions and classes should be removed to reduce codebase complexity and maintenance burden.",
      type: "architecture",
      enforcement: "warn",
      priority: 50,
    },
  },
  architectural_violation: {
    title: "Mixed Architecture Pattern",
    icon: "AlertOctagon",
    category: "architecture",
    howToFix:
      "Entities with 'mixed' architectural pattern combine domain logic with infrastructure concerns. Extract infrastructure code into adapters/services and keep domain logic pure. This improves testability and maintainability.",
    ruleTemplate: {
      title: "Separate domain from infrastructure",
      description: "Entities should not mix domain logic with infrastructure concerns. Use ports & adapters to maintain clean architecture boundaries.",
      type: "architecture",
      enforcement: "warn",
      priority: 70,
    },
  },
  low_quality_justification: {
    title: "Low Quality Justifications",
    icon: "BadgeAlert",
    category: "quality",
    howToFix:
      "These justifications contain generic phrases, lazy phrasing, or programming terms used as domain concepts. Improve the source code's documentation and naming, then re-run justification to get better quality results.",
    ruleTemplate: {
      title: "Improve code documentation quality",
      description: "Functions and classes should have clear, specific documentation that explains their business purpose rather than generic descriptions.",
      type: "style",
      enforcement: "suggest",
      priority: 40,
    },
  },
  high_fan_in: {
    title: "High Fan-In Hotspots",
    icon: "ArrowDownToLine",
    category: "complexity",
    howToFix:
      "Entities with many callers are high-risk change points — any modification can break many dependents. Consider adding comprehensive tests, creating stable interfaces, or splitting responsibilities to reduce coupling.",
    ruleTemplate: {
      title: "Protect high fan-in entities",
      description: "Entities called by 10+ others require careful change management. Changes should be accompanied by thorough testing.",
      type: "architecture",
      enforcement: "warn",
      priority: 70,
    },
  },
  high_fan_out: {
    title: "God Functions",
    icon: "ArrowUpFromLine",
    category: "complexity",
    howToFix:
      "Entities calling 10+ others are doing too much. Break them into smaller, focused functions. Extract orchestration logic into dedicated coordinator/service functions.",
    ruleTemplate: {
      title: "Limit function fan-out",
      description: "Functions calling more than 10 other entities should be refactored into smaller, more focused units.",
      type: "architecture",
      enforcement: "warn",
      priority: 60,
    },
  },
  circular_dependency: {
    title: "Circular Dependencies",
    icon: "RefreshCcw",
    category: "architecture",
    howToFix:
      "Circular dependencies create tight coupling and make code hard to test and refactor. Break cycles by extracting shared interfaces, using dependency injection, or restructuring module boundaries.",
    ruleTemplate: {
      title: "Eliminate circular dependencies",
      description: "Circular dependencies between modules create tight coupling. Break cycles by extracting interfaces or restructuring.",
      type: "architecture",
      enforcement: "block",
      priority: 90,
    },
  },
  taxonomy_anomaly: {
    title: "Taxonomy Anomalies",
    icon: "Tag",
    category: "taxonomy",
    howToFix:
      "VERTICAL entities with no callers may be unused business logic. HORIZONTAL entities called by only one feature may be misclassified — they might actually be VERTICAL. Review and reclassify as needed.",
    ruleTemplate: {
      title: "Review taxonomy anomalies",
      description: "Entities with unexpected taxonomy/usage patterns should be reviewed for correct classification.",
      type: "architecture",
      enforcement: "suggest",
      priority: 30,
    },
  },
  confidence_gap: {
    title: "Feature Confidence Gap",
    icon: "TrendingDown",
    category: "quality",
    howToFix:
      "Features with low average confidence may lack clear domain boundaries or have ambiguous naming. Review the feature's entities and ensure they share a clear business purpose. Consider renaming the feature tag if it's too broad.",
    ruleTemplate: {
      title: "Improve feature classification confidence",
      description: "Features with average confidence below 0.6 need better documentation or clearer domain boundaries.",
      type: "architecture",
      enforcement: "suggest",
      priority: 50,
    },
  },
  missing_justification: {
    title: "Missing Justifications",
    icon: "FileQuestion",
    category: "taxonomy",
    howToFix:
      "These entities have no business justification. They may have been added after the last justification run, or they may have failed during processing. Re-run the justification pipeline to classify them.",
    ruleTemplate: {
      title: "Ensure all entities are justified",
      description: "All functional entities (functions, classes, methods) should have business justifications explaining their purpose.",
      type: "architecture",
      enforcement: "warn",
      priority: 60,
    },
  },
}

/** Get guidance for a risk type, with fallback for unknown types */
export function getFixGuidance(riskType: string): FixGuidance | null {
  return FIX_GUIDANCE[riskType] ?? null
}

/** Category display info */
export const CATEGORY_INFO: Record<string, { label: string; icon: string }> = {
  dead_code: { label: "Dead Code", icon: "Trash2" },
  architecture: { label: "Architecture", icon: "Layers" },
  quality: { label: "Quality", icon: "BadgeCheck" },
  complexity: { label: "Complexity", icon: "Activity" },
  taxonomy: { label: "Taxonomy", icon: "Tag" },
}
