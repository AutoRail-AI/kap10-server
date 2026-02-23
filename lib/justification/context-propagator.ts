/**
 * Bi-directional context propagation for justification coherence.
 *
 * Three-pass propagation ensures files/classes get informed by their children's
 * justifications, and children inherit parent context:
 *
 * 1. Bottom-up: Aggregate child justifications into parent context
 * 2. Top-down: Enrich children with parent's aggregated context
 * 3. Re-aggregate: Final bottom-up pass to catch cross-pollination
 */

import type { EntityDoc, JustificationDoc } from "@/lib/ports/types"

export interface HierarchyNode {
  entity: EntityDoc
  justification?: JustificationDoc
  children: HierarchyNode[]
  parent?: HierarchyNode
}

export interface PropagatedContext {
  /** Dominant feature tag from children (most frequent) */
  propagated_feature_tag?: string
  /** Domain concepts aggregated from children */
  propagated_domain_concepts?: string[]
  /** Average confidence of children */
  propagated_confidence?: number
}

/**
 * Build a hierarchy tree from entities using the `parent` field and `contains` edges.
 */
export function buildHierarchy(
  entities: EntityDoc[],
  edges: Array<{ _from: string; _to: string; kind: string }>,
  justifications: Map<string, JustificationDoc>
): HierarchyNode[] {
  const nodeMap = new Map<string, HierarchyNode>()

  // Create nodes for all entities
  for (const entity of entities) {
    nodeMap.set(entity.id, {
      entity,
      justification: justifications.get(entity.id),
      children: [],
    })
  }

  // Build parent-child relationships using:
  // 1. `parent` field on entities (method → class name)
  // 2. `contains` edges
  const entityByName = new Map<string, HierarchyNode>()
  for (const node of Array.from(nodeMap.values())) {
    entityByName.set(node.entity.name, node)
  }

  // Link via parent field
  for (const node of Array.from(nodeMap.values())) {
    const parentName = node.entity.parent as string | undefined
    if (parentName) {
      const parentNode = entityByName.get(parentName)
      if (parentNode && parentNode !== node) {
        parentNode.children.push(node)
        node.parent = parentNode
      }
    }
  }

  // Link via contains edges (if not already linked)
  for (const edge of edges) {
    if (edge.kind !== "contains") continue
    const fromId = edge._from.split("/").pop()!
    const toId = edge._to.split("/").pop()!
    const parentNode = nodeMap.get(fromId)
    const childNode = nodeMap.get(toId)
    if (parentNode && childNode && !childNode.parent) {
      parentNode.children.push(childNode)
      childNode.parent = parentNode
    }
  }

  // Return root nodes (nodes without parents)
  return Array.from(nodeMap.values()).filter((n) => !n.parent)
}

/**
 * Bottom-up pass: aggregate child justifications into parent context.
 * Sets propagated_feature_tag, propagated_domain_concepts, propagated_confidence.
 */
function bottomUpPass(nodes: HierarchyNode[]): void {
  for (const node of nodes) {
    // Recurse first (children before parents)
    if (node.children.length > 0) {
      bottomUpPass(node.children)
    }

    if (node.children.length === 0 || !node.justification) continue

    // Aggregate children's feature tags (most frequent wins)
    const tagCounts = new Map<string, number>()
    const allConcepts: string[] = []
    let totalConfidence = 0
    let childCount = 0

    for (const child of node.children) {
      const cj = child.justification
      if (!cj) continue
      childCount++

      const tag = (cj.propagated_feature_tag as string | undefined) ?? cj.feature_tag
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1)

      const concepts = (cj.propagated_domain_concepts as string[] | undefined) ?? cj.domain_concepts
      allConcepts.push(...concepts)
      totalConfidence += cj.confidence
    }

    if (childCount === 0) continue

    // Dominant feature tag
    let dominantTag = node.justification.feature_tag
    let maxCount = 0
    for (const [tag, count] of Array.from(tagCounts.entries())) {
      if (count > maxCount) {
        maxCount = count
        dominantTag = tag
      }
    }

    // Deduplicate and rank domain concepts by frequency
    const conceptFreq = new Map<string, number>()
    for (const c of allConcepts) {
      conceptFreq.set(c, (conceptFreq.get(c) ?? 0) + 1)
    }
    const topConcepts = Array.from(conceptFreq.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([c]) => c)

    node.justification.propagated_feature_tag = dominantTag
    node.justification.propagated_domain_concepts = topConcepts
    node.justification.propagated_confidence = Math.round((totalConfidence / childCount) * 100) / 100
  }
}

/**
 * Top-down pass: enrich children with parent's aggregated context.
 */
function topDownPass(nodes: HierarchyNode[]): void {
  for (const node of nodes) {
    if (!node.justification || node.children.length === 0) continue

    const parentTag = (node.justification.propagated_feature_tag as string | undefined) ?? node.justification.feature_tag
    const parentConcepts = (node.justification.propagated_domain_concepts as string[] | undefined) ?? node.justification.domain_concepts

    for (const child of node.children) {
      if (!child.justification) continue

      // Inherit parent's feature tag if child has a generic one
      const childTag = child.justification.feature_tag
      if (childTag === "unclassified" || childTag === "utility" || childTag === "misc") {
        child.justification.propagated_feature_tag = parentTag
      } else if (!child.justification.propagated_feature_tag) {
        child.justification.propagated_feature_tag = childTag
      }

      // Merge parent domain concepts with child's
      const childConcepts = child.justification.domain_concepts ?? []
      const uniqueConcepts = new Set<string>()
      for (const c of childConcepts) uniqueConcepts.add(c)
      for (const c of parentConcepts) uniqueConcepts.add(c)
      child.justification.propagated_domain_concepts = Array.from(uniqueConcepts).slice(0, 15)
    }

    // Recurse to grandchildren
    topDownPass(node.children)
  }
}

/**
 * Run three-pass bi-directional context propagation.
 *
 * @param entities - All entities for the repo
 * @param edges - All edges for the repo
 * @param justifications - Map of entity_id → JustificationDoc (will be mutated in place)
 * @returns The mutated justifications with propagated context fields
 */
export function propagateContext(
  entities: EntityDoc[],
  edges: Array<{ _from: string; _to: string; kind: string }>,
  justifications: Map<string, JustificationDoc>
): Map<string, JustificationDoc> {
  const roots = buildHierarchy(entities, edges, justifications)

  // Pass 1: Bottom-up (children → parent)
  bottomUpPass(roots)

  // Pass 2: Top-down (parent → children)
  topDownPass(roots)

  // Pass 3: Final bottom-up to catch cross-pollination
  bottomUpPass(roots)

  return justifications
}
