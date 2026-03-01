/**
 * Regex-based parser for Java source files.
 *
 * Extracts classes, interfaces, enums, methods, fields, constructors,
 * and annotations from Java files. Also detects extends/implements edges,
 * import edges, and within-file call edges.
 */
import { extractJSDocComment } from "../../doc-extractor"
import { entityHash } from "../../entity-hash"
import type { ParsedEdge, ParsedEntity } from "../../types"
import { MAX_BODY_LINES } from "../../types"
import type { TreeSitterOptions } from "../types"

export interface JavaParseResult {
  entities: ParsedEntity[]
  edges: ParsedEdge[]
}

export function parseJavaFile(opts: TreeSitterOptions): JavaParseResult {
  const entities: ParsedEntity[] = []
  const edges: ParsedEdge[] = []
  const lines = opts.content.split("\n")

  // Extract package name for fully qualified names
  const packageName = detectPackage(lines)

  // First pass: extract import edges
  const fileId = entityHash(opts.repoId, opts.filePath, "file", opts.filePath)
  detectJavaImportEdges(lines, fileId, opts.repoId, edges)

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const lineNum = i + 1
    const trimmed = line.trim()

    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue

    // Skip import and package declarations
    if (trimmed.startsWith("import ") || trimmed.startsWith("package ")) continue

    // Annotation declarations: @interface AnnotationName
    const annotationMatch = trimmed.match(/^(?:public\s+)?@interface\s+(\w+)/)
    if (annotationMatch) {
      const name = annotationMatch[1]!
      entities.push({
        id: entityHash(opts.repoId, opts.filePath, "interface", name),
        kind: "interface",
        name,
        file_path: opts.filePath,
        start_line: lineNum,
        language: "java",
        exported: trimmed.startsWith("public"),
      })
      continue
    }

    // Enum declarations: [modifiers] enum EnumName [implements ...] {
    const enumMatch = trimmed.match(
      /^(?:(?:public|protected|private|static|abstract|final)\s+)*enum\s+(\w+)(?:\s+implements\s+([\w,\s]+))?/
    )
    if (enumMatch) {
      const name = enumMatch[1]!
      const implementsList = enumMatch[2]
      const entity: ParsedEntity = {
        id: entityHash(opts.repoId, opts.filePath, "enum", name),
        kind: "enum",
        name,
        file_path: opts.filePath,
        start_line: lineNum,
        language: "java",
        exported: trimmed.includes("public"),
      }
      entities.push(entity)

      // implements edges
      if (implementsList) {
        for (const iface of implementsList.split(",").map((s) => s.trim()).filter(Boolean)) {
          const ifaceId = entityHash(opts.repoId, opts.filePath, "interface", iface)
          edges.push({ from_id: entity.id, to_id: ifaceId, kind: "implements" })
        }
      }
      continue
    }

    // Interface declarations: [modifiers] interface InterfaceName [extends ...] {
    const ifaceMatch = trimmed.match(
      /^(?:(?:public|protected|private|static|abstract|sealed|non-sealed)\s+)*interface\s+(\w+)(?:<[^>]*>)?(?:\s+extends\s+([\w,\s<>]+))?/
    )
    if (ifaceMatch) {
      const name = ifaceMatch[1]!
      const extendsList = ifaceMatch[2]
      const entity: ParsedEntity = {
        id: entityHash(opts.repoId, opts.filePath, "interface", name),
        kind: "interface",
        name,
        file_path: opts.filePath,
        start_line: lineNum,
        language: "java",
        exported: trimmed.includes("public"),
      }
      entities.push(entity)

      // extends edges for interfaces
      if (extendsList) {
        for (const parent of parseTypeList(extendsList)) {
          const parentId = entityHash(opts.repoId, opts.filePath, "interface", parent)
          edges.push({ from_id: entity.id, to_id: parentId, kind: "extends" })
        }
      }
      continue
    }

    // Class declarations: [modifiers] class ClassName [extends Parent] [implements ...] {
    const classMatch = trimmed.match(
      /^(?:(?:public|protected|private|static|abstract|final|sealed|non-sealed)\s+)*class\s+(\w+)(?:<[^>]*>)?(?:\s+extends\s+(\w+)(?:<[^>]*>)?)?(?:\s+implements\s+([\w,\s<>]+))?/
    )
    if (classMatch) {
      const name = classMatch[1]!
      const extendsName = classMatch[2]
      const implementsList = classMatch[3]
      const entity: ParsedEntity = {
        id: entityHash(opts.repoId, opts.filePath, "class", name),
        kind: "class",
        name,
        file_path: opts.filePath,
        start_line: lineNum,
        language: "java",
        exported: trimmed.includes("public"),
      }
      entities.push(entity)

      // extends edge
      if (extendsName) {
        const parentId = entityHash(opts.repoId, opts.filePath, "class", extendsName)
        edges.push({ from_id: entity.id, to_id: parentId, kind: "extends" })
      }

      // implements edges
      if (implementsList) {
        for (const iface of parseTypeList(implementsList)) {
          const ifaceId = entityHash(opts.repoId, opts.filePath, "interface", iface)
          edges.push({ from_id: entity.id, to_id: ifaceId, kind: "implements" })
        }
      }
      continue
    }

    // Record declarations (Java 16+): [modifiers] record RecordName(params) [implements ...] {
    const recordMatch = trimmed.match(
      /^(?:(?:public|protected|private|static|final)\s+)*record\s+(\w+)\s*\(([^)]*)\)(?:\s+implements\s+([\w,\s<>]+))?/
    )
    if (recordMatch) {
      const name = recordMatch[1]!
      const params = recordMatch[2] ?? ""
      const implementsList = recordMatch[3]
      const sig = `record ${name}(${params})`
      const entity: ParsedEntity = {
        id: entityHash(opts.repoId, opts.filePath, "class", name, sig),
        kind: "class",
        name,
        file_path: opts.filePath,
        start_line: lineNum,
        language: "java",
        signature: sig,
        exported: trimmed.includes("public"),
        parameter_count: countJavaParams(params),
      }
      entities.push(entity)

      if (implementsList) {
        for (const iface of parseTypeList(implementsList)) {
          const ifaceId = entityHash(opts.repoId, opts.filePath, "interface", iface)
          edges.push({ from_id: entity.id, to_id: ifaceId, kind: "implements" })
        }
      }
      continue
    }

    // Constructor declarations: [modifiers] ClassName(params) [throws ...] {
    // Must match a known class name in the same file
    const ctorMatch = trimmed.match(
      /^(?:(?:public|protected|private)\s+)?(\w+)\s*\(([^)]*)\)\s*(?:throws\s+[\w,\s]+)?\s*\{?\s*$/
    )
    if (ctorMatch) {
      const name = ctorMatch[1]!
      const params = ctorMatch[2] ?? ""
      // Only match if name looks like a class (PascalCase) and we've seen this class
      if (name[0] === name[0]!.toUpperCase() && entities.some((e) => e.kind === "class" && e.name === name)) {
        const sig = `${name}(${params})`
        const entity: ParsedEntity = {
          id: entityHash(opts.repoId, opts.filePath, "method", name, sig),
          kind: "method",
          name,
          file_path: opts.filePath,
          start_line: lineNum,
          language: "java",
          signature: sig,
          parent: name,
          exported: trimmed.includes("public"),
          parameter_count: countJavaParams(params),
        }
        entities.push(entity)

        // member_of edge to class
        const classId = entityHash(opts.repoId, opts.filePath, "class", name)
        edges.push({ from_id: entity.id, to_id: classId, kind: "member_of" })
        continue
      }
    }

    // Method declarations: [modifiers] returnType methodName(params) [throws ...] {
    const methodMatch = trimmed.match(
      /^(?:(?:public|protected|private|static|final|abstract|synchronized|native|default|strictfp)\s+)*(?:(?:<[^>]+>\s+)?)([\w<>\[\],\s?]+?)\s+(\w+)\s*\(([^)]*)\)\s*(?:throws\s+[\w,\s]+)?\s*[{;]\s*$/
    )
    if (methodMatch) {
      const returnType = methodMatch[1]!.trim()
      const name = methodMatch[2]!
      const params = methodMatch[3] ?? ""

      // Skip lines that are actually class/interface/enum declarations
      if (["class", "interface", "enum", "record"].includes(returnType)) continue
      // Skip if name starts with uppercase (likely constructor caught above or class decl)
      if (name[0] === name[0]!.toUpperCase() && !returnType) continue

      const sig = `${returnType} ${name}(${params})`
      const isAsync = trimmed.includes("CompletableFuture") || trimmed.includes("Future<")
      const entity: ParsedEntity = {
        id: entityHash(opts.repoId, opts.filePath, "method", name, sig),
        kind: "method",
        name,
        file_path: opts.filePath,
        start_line: lineNum,
        language: "java",
        signature: sig,
        exported: trimmed.includes("public"),
        is_async: isAsync || undefined,
        parameter_count: countJavaParams(params),
        return_type: returnType,
      }
      entities.push(entity)

      // Find the enclosing class to create member_of edge
      const enclosingClass = findEnclosingClass(entities, lineNum)
      if (enclosingClass) {
        entity.parent = enclosingClass.name
        edges.push({ from_id: entity.id, to_id: enclosingClass.id, kind: "member_of" })
      }
      continue
    }

    // Static/instance field declarations: [modifiers] Type fieldName [= ...];
    // Only match top-level fields (inside a class but outside methods)
    const fieldMatch = trimmed.match(
      /^(?:(?:public|protected|private|static|final|volatile|transient)\s+)+([\w<>\[\],\s?]+?)\s+(\w+)\s*(?:=|;)/
    )
    if (fieldMatch) {
      const fieldType = fieldMatch[1]!.trim()
      const name = fieldMatch[2]!

      // Skip if this looks like a method call or local variable
      if (["class", "interface", "enum", "record", "import", "package", "return", "throw", "new"].includes(fieldType)) continue

      entities.push({
        id: entityHash(opts.repoId, opts.filePath, "variable", name),
        kind: "variable",
        name,
        file_path: opts.filePath,
        start_line: lineNum,
        language: "java",
        signature: `${fieldType} ${name}`,
        exported: trimmed.includes("public"),
        return_type: fieldType,
      })
    }
  }

  // Post-process: compute end_line and extract body for each entity
  fillJavaEndLinesAndBodies(entities, lines)

  // Post-process: detect call edges by scanning method bodies
  detectJavaCallEdges(entities, edges)

  return { entities, edges }
}

/**
 * Detect the package declaration.
 */
function detectPackage(lines: string[]): string | undefined {
  for (const line of lines) {
    const match = line.trim().match(/^package\s+([\w.]+)\s*;/)
    if (match) return match[1]
  }
  return undefined
}

/**
 * Parse a comma-separated type list (e.g., "Serializable, Comparable<Foo>")
 * into simple type names (strips generics).
 */
function parseTypeList(typeList: string): string[] {
  return typeList
    .split(",")
    .map((t) => t.trim().replace(/<[^>]*>/g, "").trim())
    .filter((t) => t.length > 0 && t !== "Object")
}

/**
 * Find the nearest enclosing class for a given line number.
 */
function findEnclosingClass(entities: ParsedEntity[], lineNum: number): ParsedEntity | undefined {
  let best: ParsedEntity | undefined
  let bestLine = 0
  for (const e of entities) {
    if ((e.kind === "class" || e.kind === "enum" || e.kind === "interface") &&
        e.start_line != null &&
        e.start_line < lineNum &&
        e.start_line > bestLine) {
      best = e
      bestLine = e.start_line
    }
  }
  return best
}

/**
 * Compute end_line for Java entities using brace matching,
 * then extract body text and doc comments.
 */
function fillJavaEndLinesAndBodies(entities: ParsedEntity[], lines: string[]): void {
  if (entities.length === 0) return

  for (const entity of entities) {
    const startLine = entity.start_line
    if (startLine == null) continue
    const startIdx = startLine - 1

    if (entity.kind === "variable") {
      // Fields are typically single-line
      entity.end_line = startLine
      entity.body = lines[startIdx] ?? ""
      continue
    }

    // For class, interface, enum, method: find matching closing brace
    let depth = 0
    let foundOpen = false
    let endIdx = startIdx

    for (let i = startIdx; i < lines.length; i++) {
      const line = lines[i]!
      for (const ch of line) {
        if (ch === "{") {
          depth++
          foundOpen = true
        }
        if (ch === "}") {
          depth--
          if (foundOpen && depth === 0) {
            endIdx = i
            break
          }
        }
      }
      if (foundOpen && depth === 0) break
    }

    // Fallback: abstract/interface methods end with semicolon
    if (!foundOpen) {
      endIdx = startIdx
    }

    entity.end_line = endIdx + 1 // 1-based

    // Extract JavaDoc comment (uses JSDoc extractor — same /** ... */ format)
    if (!entity.doc) {
      entity.doc = extractJSDocComment(lines, startIdx)
    }

    // Extract body (capped at MAX_BODY_LINES)
    const bodyLines = lines.slice(startIdx, Math.min(endIdx + 1, startIdx + MAX_BODY_LINES))
    if (bodyLines.length > 0) {
      entity.body = bodyLines.join("\n")
      // Estimate complexity for methods
      if (entity.kind === "method") {
        entity.complexity = estimateJavaComplexity(entity.body)
      }
    }
  }
}

/**
 * Detect call edges by scanning method bodies for `name(` patterns
 * matching known entity names in the same file.
 */
function detectJavaCallEdges(entities: ParsedEntity[], edges: ParsedEdge[]): void {
  // Build a set of callable entity names → IDs
  const callableMap = new Map<string, string>()
  for (const e of entities) {
    if (e.kind === "method") {
      callableMap.set(e.name, e.id)
    }
  }

  if (callableMap.size === 0) return

  const names = Array.from(callableMap.keys()).filter((n) => n.length > 1)
  if (names.length === 0) return

  const escapedNames = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  const callPattern = new RegExp(`\\b(${escapedNames.join("|")})\\s*\\(`, "g")

  const edgeSet = new Set<string>()
  for (const entity of entities) {
    if (entity.kind !== "method") continue
    if (!entity.body) continue

    let match: RegExpExecArray | null
    const regex = new RegExp(callPattern.source, "g")
    while ((match = regex.exec(entity.body)) !== null) {
      const calledName = match[1]!
      const calleeId = callableMap.get(calledName)
      if (calleeId && calleeId !== entity.id) {
        const edgeKey = `${entity.id}→${calleeId}`
        if (!edgeSet.has(edgeKey)) {
          edgeSet.add(edgeKey)
          edges.push({ from_id: entity.id, to_id: calleeId, kind: "calls" })
        }
      }
    }
  }
}

/**
 * Detect Java import statements and create import edges.
 */
function detectJavaImportEdges(
  lines: string[],
  fileId: string,
  repoId: string,
  edges: ParsedEdge[],
): void {
  for (const line of lines) {
    const trimmed = line.trim()

    // import [static] com.example.package.ClassName;
    const importMatch = trimmed.match(/^import\s+(?:static\s+)?([\w.]+)\s*;/)
    if (!importMatch) continue

    const importPath = importMatch[1]!
    const isStatic = trimmed.includes("static ")

    // Skip java.* and javax.* standard library imports
    if (importPath.startsWith("java.") || importPath.startsWith("javax.") ||
        importPath.startsWith("sun.") || importPath.startsWith("jdk.")) {
      continue
    }

    // Convert package path to a file-like path for edge target
    // e.g., com.example.service.UserService → com/example/service/UserService.java
    const fileLikePath = importPath.replace(/\./g, "/") + ".java"
    const className = importPath.split(".").pop() ?? importPath

    const targetFileId = entityHash(repoId, fileLikePath, "file", fileLikePath)
    edges.push({
      from_id: fileId,
      to_id: targetFileId,
      kind: "imports",
      imported_symbols: [className],
      import_type: isStatic ? "static" : "value",
      is_type_only: false,
    })

    // I-03: Capture external boundary metadata
    const { extractExternalPackageName, classifyBoundary } = require("@/lib/indexer/boundary-classifier") as typeof import("@/lib/indexer/boundary-classifier")
    const pkgName = extractExternalPackageName(importPath, "java")
    if (pkgName) {
      edges.push({
        from_id: fileId,
        to_id: `external:${pkgName}`,
        kind: "imports",
        imported_symbols: [className],
        import_type: isStatic ? "static" : "value",
        is_type_only: false,
        is_external: true,
        package_name: pkgName,
        boundary_category: classifyBoundary(pkgName, "java"),
      })
    }
  }
}

/** Count Java method parameters. */
function countJavaParams(params: string): number {
  if (!params.trim()) return 0
  // Handle generic types with commas inside angle brackets
  let depth = 0
  let count = 1
  for (const ch of params) {
    if (ch === "<") depth++
    else if (ch === ">") depth--
    else if (ch === "," && depth === 0) count++
  }
  return count
}

/** Estimate cyclomatic complexity for Java. Baseline = 1. */
function estimateJavaComplexity(body: string): number {
  let complexity = 1
  const pattern = /\b(if|else\s+if|for|while|do|case|catch|switch)\b|&&|\|\||\?/g
  let _match: RegExpExecArray | null
  while ((_match = pattern.exec(body)) !== null) {
    complexity++
  }
  return complexity
}
