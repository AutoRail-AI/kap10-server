/**
 * L-02: Cross-file call edge resolution.
 *
 * Post-processing step that runs after all tree-sitter parsing is complete.
 * Resolves imported symbols to target entities and creates cross-file "calls"
 * edges by scanning function/method bodies for call patterns.
 *
 * This complements:
 * - Same-file call detection in individual language parsers (TS/Python/Go/Java)
 * - SCIP-based cross-file references (which use symbol identity, not imports)
 */
import type { ParsedEdge, ParsedEntity } from "./types"

/**
 * Resolve cross-file call edges using import metadata.
 *
 * Algorithm:
 * 1. Build entity lookup maps (by ID and by file+name)
 * 2. Resolve import edges to target entity IDs
 * 3. Scan function/method bodies for calls to imported symbols
 * 4. Create "calls" edges from caller to target entity
 *
 * @returns Array of new cross-file "calls" edges to append
 */
export function resolveCrossFileCalls(
  entities: ParsedEntity[],
  edges: ParsedEdge[],
  _repoId: string,
): ParsedEdge[] {
  const newEdges: ParsedEdge[] = []

  // Step 1: Build file→entities map (name→entity for callable entities)
  // Key: entityId → entity
  const entityById = new Map<string, ParsedEntity>()
  // Key: filePath → Map<entityName, entityId>
  const fileCallables = new Map<string, Map<string, string>>()

  for (const entity of entities) {
    entityById.set(entity.id, entity)

    if (entity.kind === "function" || entity.kind === "method" || entity.kind === "class") {
      let nameMap = fileCallables.get(entity.file_path)
      if (!nameMap) {
        nameMap = new Map()
        fileCallables.set(entity.file_path, nameMap)
      }
      nameMap.set(entity.name, entity.id)
    }
  }

  // Step 2: Build import resolution map
  // Key: (sourceFilePath, importedSymbolName) → targetEntityId
  // We need to find which file the import edge points to, then look up
  // the named symbol in that file's callable map
  const importEdges = edges.filter((e) => e.kind === "imports" && !e.is_external)

  // Build a reverse lookup: entityId → filePath for file entities
  const fileIdToPath = new Map<string, string>()
  for (const entity of entities) {
    if (entity.kind === "file") {
      fileIdToPath.set(entity.id, entity.file_path)
    }
  }

  // Resolve imports: (importerFilePath, symbolName) → targetEntityId
  type ImportResolution = { importerFile: string; symbolName: string; targetEntityId: string }
  const resolvedImports: ImportResolution[] = []

  for (const edge of importEdges) {
    const importedSymbols = edge.imported_symbols as string[] | undefined
    if (!importedSymbols || importedSymbols.length === 0) continue

    // edge.from_id is the importer file entity, edge.to_id is the target file entity
    const importerEntity = entityById.get(edge.from_id)
    const targetFilePath = fileIdToPath.get(edge.to_id)

    if (!importerEntity || !targetFilePath) continue

    const importerFile = importerEntity.file_path
    const targetCallables = fileCallables.get(targetFilePath)

    // Also check with common extensions appended (import resolution may omit extensions)
    const extensionVariants = [targetFilePath, `${targetFilePath}.ts`, `${targetFilePath}.tsx`, `${targetFilePath}.js`, `${targetFilePath}.jsx`]
    let resolvedCallables: Map<string, string> | undefined = targetCallables

    if (!resolvedCallables) {
      for (const variant of extensionVariants) {
        resolvedCallables = fileCallables.get(variant)
        if (resolvedCallables) break
      }
    }

    // Also try index file variants
    if (!resolvedCallables) {
      const indexVariants = [`${targetFilePath}/index.ts`, `${targetFilePath}/index.tsx`, `${targetFilePath}/index.js`]
      for (const variant of indexVariants) {
        resolvedCallables = fileCallables.get(variant)
        if (resolvedCallables) break
      }
    }

    if (!resolvedCallables) continue

    for (const symbolName of importedSymbols) {
      const targetEntityId = resolvedCallables.get(symbolName)
      if (targetEntityId) {
        resolvedImports.push({ importerFile, symbolName, targetEntityId })
      }
    }
  }

  if (resolvedImports.length === 0) return newEdges

  // Step 3: Group resolved imports by importer file for efficient body scanning
  const importsByFile = new Map<string, ImportResolution[]>()
  for (const imp of resolvedImports) {
    let fileImports = importsByFile.get(imp.importerFile)
    if (!fileImports) {
      fileImports = []
      importsByFile.set(imp.importerFile, fileImports)
    }
    fileImports.push(imp)
  }

  // Step 4: Scan function/method bodies for calls to imported symbols
  const edgeDedup = new Set<string>()

  for (const entity of entities) {
    if (entity.kind !== "function" && entity.kind !== "method") continue
    if (!entity.body) continue

    const fileImports = importsByFile.get(entity.file_path)
    if (!fileImports || fileImports.length === 0) continue

    // Build regex for this file's imported symbols
    const symbolNames = fileImports
      .map((imp) => imp.symbolName)
      .filter((n) => n.length > 1)
    if (symbolNames.length === 0) continue

    const escapedNames = symbolNames.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    // Match function calls: name( and constructor calls: new Name(
    const callPattern = new RegExp(`(?:(?:new\\s+)|\\b)(${escapedNames.join("|")})\\s*\\(`, "g")

    // Build quick lookup for this file's imports
    const symbolToTarget = new Map<string, string>()
    for (const imp of fileImports) {
      symbolToTarget.set(imp.symbolName, imp.targetEntityId)
    }

    let match: RegExpExecArray | null
    while ((match = callPattern.exec(entity.body)) !== null) {
      const calledName = match[1]!
      const targetId = symbolToTarget.get(calledName)
      if (targetId && targetId !== entity.id) {
        const edgeKey = `${entity.id}\0${targetId}`
        if (!edgeDedup.has(edgeKey)) {
          edgeDedup.add(edgeKey)
          newEdges.push({ from_id: entity.id, to_id: targetId, kind: "calls" })
        }
      }
    }
  }

  return newEdges
}
