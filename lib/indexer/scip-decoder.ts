/**
 * Shared SCIP protobuf decoder.
 *
 * Parses .scip files (Sourcegraph Code Intelligence Protocol) produced by
 * any SCIP indexer (scip-typescript, scip-python, scip-go, etc.) into
 * ParsedEntity[] and ParsedEdge[].
 *
 * The SCIP wire format is identical across languages — only the symbol
 * descriptors differ. This module extracts the decoder logic so all
 * language plugins share a single implementation.
 */
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"

import { entityHash } from "./entity-hash"
import { ALWAYS_IGNORE } from "./ignore"
import type { ParsedEdge, ParsedEntity } from "./types"

export interface SCIPDecodeResult {
  entities: ParsedEntity[]
  edges: ParsedEdge[]
  coveredFiles: string[]
}

/**
 * Parse a .scip protobuf file into entities and edges.
 *
 * @param scipFilePath - Absolute path to the .scip file
 * @param repoId - Repository ID for deterministic entity hashing
 * @param language - Language identifier (e.g., "typescript", "python", "go")
 * @param isIncluded - Optional filter: returns true if a relative path should be included
 */
export function parseSCIPOutput(
  scipFilePath: string,
  repoId: string,
  language: string,
  isIncluded?: (relativePath: string) => boolean,
): SCIPDecodeResult {
  const entities: ParsedEntity[] = []
  const edges: ParsedEdge[] = []
  const coveredFiles: string[] = []
  const seenIds = new Set<string>()

  try {
    const buffer = readFileSync(scipFilePath)
    const documents = decodeSCIPDocuments(buffer)

    // Resolve project package names from the language-appropriate manifest file.
    // Each SCIP indexer uses the project's own package/module name as the SCIP
    // package field. We allowlist these so only project-local symbols become entities.
    const projectPackageNames = resolveProjectPackageNames(scipFilePath, language)

    // Use the full ignore filter when provided; fall back to ALWAYS_IGNORE
    // directory matching for backward compat (tests, standalone usage).
    const shouldSkip = isIncluded
      ? (relPath: string) => !isIncluded(relPath)
      : (relPath: string) => relPath.split("/").some((segment) => ALWAYS_IGNORE.has(segment))
    const externalDocs = documents.filter((d) => shouldSkip(d.relativePath))
    const projectDocs = documents.length - externalDocs.length

    if (documents.length === 0) {
      console.warn(`[scip-${language}] Decoded 0 documents from ${buffer.length} byte SCIP file`)
    } else {
      const totalOccurrences = documents.reduce((s, d) => s + d.occurrences.length, 0)
      console.log(`[scip-${language}] Decoded ${documents.length} documents (${projectDocs} project, ${externalDocs.length} external/skipped), ${totalOccurrences} occurrences from ${buffer.length} bytes | Project packages: [${[...projectPackageNames].join(", ")}]`)
    }

    // Pass 1: Collect all definitions and build symbol→entity map
    const symbolToEntityId = new Map<string, string>()
    // L-18a: Per-file entity index for containment lookup in Pass 2
    const fileEntityIndex = new Map<string, Array<{ id: string; startLine: number; kind: string }>>()
    let externalSymbolsSkipped = 0

    for (const doc of documents) {
      const relPath = doc.relativePath
      if (!relPath) continue

      // Skip external/ignored files (node_modules, .yarn, .unerrignore patterns, etc.)
      if (shouldSkip(relPath)) continue

      coveredFiles.push(relPath)

      for (const occurrence of doc.occurrences) {
        if (!occurrence.symbol || occurrence.symbol.startsWith("local ")) continue

        // Skip external package symbols (stdlib, node_modules deps, @types, etc.)
        // Only keep symbols whose package name matches the project's own package(s)
        if (isExternalSymbol(occurrence.symbol, projectPackageNames)) {
          externalSymbolsSkipped++
          continue
        }

        const parsed = parseSCIPSymbol(occurrence.symbol)
        if (!parsed) continue

        // Skip module/namespace entities — these are import references, not code definitions.
        // They pollute entity counts, community detection, and embeddings.
        if (parsed.kind === "module" || parsed.kind === "namespace") continue

        const id = entityHash(repoId, relPath, parsed.kind, parsed.name, parsed.signature)

        // O(1) dedup via Set (fixes L-05)
        if (!seenIds.has(id)) {
          seenIds.add(id)
          const startLine = occurrence.range[0]! + 1
          entities.push({
            id,
            kind: parsed.kind,
            name: parsed.name,
            file_path: relPath,
            start_line: startLine,
            end_line: (occurrence.range[2] ?? occurrence.range[0]!) + 1,
            language,
            signature: parsed.signature,
          })

          // L-18a: Index entity by file for containment lookup
          let fileEntities = fileEntityIndex.get(relPath)
          if (!fileEntities) {
            fileEntities = []
            fileEntityIndex.set(relPath, fileEntities)
          }
          fileEntities.push({ id, startLine, kind: parsed.kind })
        }

        // Track symbol→entity mapping for reference resolution
        if (occurrence.isDefinition) {
          symbolToEntityId.set(occurrence.symbol, id)
        }
      }
    }

    // L-18a: Sort each file's entity list by startLine ascending for binary search
    for (const fileEntities of fileEntityIndex.values()) {
      fileEntities.sort((a, b) => a.startLine - b.startLine)
    }

    // Pass 2: Create reference/call edges using containment lookup
    const edgeDedup = new Set<string>()
    for (const doc of documents) {
      const relPath = doc.relativePath
      if (!relPath) continue
      if (shouldSkip(relPath)) continue

      for (const occurrence of doc.occurrences) {
        if (!occurrence.symbol || occurrence.symbol.startsWith("local ")) continue
        if (isExternalSymbol(occurrence.symbol, projectPackageNames)) continue
        if (occurrence.isDefinition) continue

        const parsed = parseSCIPSymbol(occurrence.symbol)
        if (!parsed) continue

        const defEntityId = symbolToEntityId.get(occurrence.symbol)
        if (!defEntityId) continue

        // L-18a: Find the containing entity using binary search.
        // The entity with the largest startLine <= referenceLine is the caller.
        const referenceLine = occurrence.range[0]! + 1
        const fileEntities = fileEntityIndex.get(relPath)
        if (!fileEntities || fileEntities.length === 0) continue

        let containingEntity: { id: string; kind: string } | null = null
        let lo = 0
        let hi = fileEntities.length - 1
        while (lo <= hi) {
          const mid = (lo + hi) >>> 1
          if (fileEntities[mid]!.startLine <= referenceLine) {
            containingEntity = fileEntities[mid]!
            lo = mid + 1
          } else {
            hi = mid - 1
          }
        }

        if (!containingEntity) continue
        const refId = containingEntity.id

        // Skip self-references
        if (refId === defEntityId) continue

        // Only create edges if both entities exist
        if (!seenIds.has(refId) || !seenIds.has(defEntityId)) continue

        // Deduplicate edges
        const edgeKey = `${refId}\0${defEntityId}`
        if (edgeDedup.has(edgeKey)) continue
        edgeDedup.add(edgeKey)

        // L-18a: Classify edge — function/method targets are calls, others are references
        const targetKind = parsed.kind
        const edgeKind = (targetKind === "function" || targetKind === "method") ? "calls" : "references"

        edges.push({
          from_id: refId,
          to_id: defEntityId,
          kind: edgeKind,
        })
      }
    }
    console.log(`[scip-${language}] Result: ${entities.length} entities, ${edges.length} edges, ${coveredFiles.length} files | ${externalSymbolsSkipped} external symbol occurrences skipped (stdlib/node_modules types)`)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[scip-${language}] Failed to parse SCIP output: ${message}`)
  }

  return { entities, edges, coveredFiles }
}

// ---------------------------------------------------------------------------
// Protobuf wire format decoder
// ---------------------------------------------------------------------------

/** Minimal SCIP protobuf document representation */
interface SCIPDocument {
  relativePath: string
  occurrences: SCIPOccurrence[]
}

interface SCIPOccurrence {
  range: number[]
  symbol: string
  isDefinition: boolean
}

/**
 * Decode SCIP protobuf documents using basic varint decoding.
 *
 * SCIP protobuf wire format:
 * - Message: Index { documents: repeated Document (field 2) }
 * - Document: { relative_path: string (field 1), occurrences: repeated Occurrence (field 2) }
 * - Occurrence: { range: repeated int32 (field 1), symbol: string (field 2), symbol_roles: int32 (field 4) }
 */
function decodeSCIPDocuments(buffer: Buffer): SCIPDocument[] {
  const documents: SCIPDocument[] = []
  let offset = 0

  while (offset < buffer.length) {
    const tagResult = readVarint(buffer, offset)
    if (!tagResult) break
    offset = tagResult.offset

    const fieldNumber = tagResult.value >>> 3
    const wireType = tagResult.value & 0x7

    if (wireType === 2) {
      // Length-delimited
      const lenResult = readVarint(buffer, offset)
      if (!lenResult) break
      offset = lenResult.offset
      const end = offset + lenResult.value

      // K-04: Bounds check — ensure length-delimited field doesn't exceed buffer
      if (end > buffer.length || end < offset) {
        break
      }

      if (fieldNumber === 2) {
        // Document field in Index message — wrap per-document decode in try-catch
        // so one corrupted document doesn't abort all remaining documents
        try {
          const doc = decodeDocument(buffer, offset, end)
          if (doc.relativePath) {
            documents.push(doc)
          }
        } catch {
          // K-04: Skip corrupted document, continue with next
        }
      }

      offset = end
    } else if (wireType === 0) {
      // Varint — skip
      const skip = readVarint(buffer, offset)
      if (!skip) break
      offset = skip.offset
    } else {
      // Unknown wire type — skip
      break
    }
  }

  return documents
}

function decodeDocument(buffer: Buffer, start: number, end: number): SCIPDocument {
  const doc: SCIPDocument = { relativePath: "", occurrences: [] }
  let offset = start

  while (offset < end) {
    const tagResult = readVarint(buffer, offset)
    if (!tagResult) break
    offset = tagResult.offset

    const fieldNumber = tagResult.value >>> 3
    const wireType = tagResult.value & 0x7

    if (wireType === 2) {
      const lenResult = readVarint(buffer, offset)
      if (!lenResult) break
      offset = lenResult.offset
      const fieldEnd = offset + lenResult.value

      // K-04: Bounds check
      if (fieldEnd > end || fieldEnd < offset) break

      if (fieldNumber === 1) {
        // relative_path (field 1 in SCIP proto)
        doc.relativePath = buffer.toString("utf-8", offset, fieldEnd)
      } else if (fieldNumber === 2) {
        // occurrence
        const occ = decodeOccurrence(buffer, offset, fieldEnd)
        if (occ.symbol) {
          doc.occurrences.push(occ)
        }
      }

      offset = fieldEnd
    } else if (wireType === 0) {
      const skip = readVarint(buffer, offset)
      if (!skip) break
      offset = skip.offset
    } else {
      break
    }
  }

  return doc
}

function decodeOccurrence(buffer: Buffer, start: number, end: number): SCIPOccurrence {
  const occ: SCIPOccurrence = { range: [], symbol: "", isDefinition: false }
  let offset = start

  while (offset < end) {
    const tagResult = readVarint(buffer, offset)
    if (!tagResult) break
    offset = tagResult.offset

    const fieldNumber = tagResult.value >>> 3
    const wireType = tagResult.value & 0x7

    if (wireType === 2) {
      const lenResult = readVarint(buffer, offset)
      if (!lenResult) break
      offset = lenResult.offset
      const fieldEnd = offset + lenResult.value

      // K-04: Bounds check
      if (fieldEnd > end || fieldEnd < offset) break

      if (fieldNumber === 1) {
        // range (packed repeated int32)
        let rangeOffset = offset
        while (rangeOffset < fieldEnd) {
          const val = readVarint(buffer, rangeOffset)
          if (!val) break
          rangeOffset = val.offset
          occ.range.push(val.value)
        }
      } else if (fieldNumber === 2) {
        // symbol
        occ.symbol = buffer.toString("utf-8", offset, fieldEnd)
      }

      offset = fieldEnd
    } else if (wireType === 0) {
      const valResult = readVarint(buffer, offset)
      if (!valResult) break
      offset = valResult.offset

      if (fieldNumber === 4) {
        // symbol_roles (bit field: 0x1 = Definition)
        occ.isDefinition = (valResult.value & 0x1) !== 0
      }
    } else {
      break
    }
  }

  return occ
}

/** Read a protobuf varint from buffer at offset. */
function readVarint(buffer: Buffer, offset: number): { value: number; offset: number } | null {
  let result = 0
  let shift = 0

  while (offset < buffer.length) {
    const byte = buffer[offset]!
    offset++
    result |= (byte & 0x7f) << shift
    if ((byte & 0x80) === 0) {
      return { value: result >>> 0, offset }
    }
    shift += 7
    if (shift > 35) return null // overflow protection
  }

  return null
}

// ---------------------------------------------------------------------------
// External symbol detection
// ---------------------------------------------------------------------------

/**
 * Resolve the project's own package name(s) from the language-appropriate
 * manifest file near the SCIP output.
 *
 * Each SCIP indexer embeds the project's package/module name into the symbol
 * string (position 2 in the space-delimited format). This function reads
 * the correct manifest for each language so `isExternalSymbol()` can filter
 * out stdlib and third-party references.
 *
 * Manifest files by language:
 *   TypeScript/JS → package.json "name"
 *   Python        → pyproject.toml [project].name or setup.cfg [metadata].name
 *   Go            → go.mod module line
 *   Rust          → Cargo.toml [package].name
 *   Java          → pom.xml <artifactId> or build.gradle rootProject.name
 *   PHP           → composer.json "name"
 *   Ruby          → *.gemspec name or Gemfile
 *   C#            → *.csproj <AssemblyName>/<RootNamespace>
 *   C/C++         → CMakeLists.txt project() name
 *
 * Returns a Set containing discovered names plus "." (anonymous fallback).
 */
export function resolveProjectPackageNames(scipFilePath: string, language: string): Set<string> {
  const names = new Set<string>()
  names.add(".")

  let dir = dirname(scipFilePath)

  // Walk up at most 10 levels to find a manifest file
  for (let i = 0; i < 10; i++) {
    const found = resolveNamesFromDir(dir, language, names)
    if (found) break
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }

  return names
}

/** Try to extract project name(s) from manifest files in a single directory. */
function resolveNamesFromDir(dir: string, language: string, names: Set<string>): boolean {
  switch (language) {
    case "typescript":
    case "javascript": {
      return tryReadPackageJson(dir, names)
    }

    case "python": {
      // scip-python uses --project-name; defaults to pyproject.toml [project].name
      const pyproject = join(dir, "pyproject.toml")
      if (existsSync(pyproject)) {
        try {
          const content = readFileSync(pyproject, "utf-8")
          // Match [project] section's name field (TOML basic parsing)
          const nameMatch = content.match(/\[project\]\s*[\s\S]*?name\s*=\s*"([^"]+)"/)
          if (nameMatch?.[1]) {
            names.add(nameMatch[1])
            return true
          }
        } catch { /* ignore */ }
      }
      // Fallback: setup.cfg [metadata] name
      const setupCfg = join(dir, "setup.cfg")
      if (existsSync(setupCfg)) {
        try {
          const content = readFileSync(setupCfg, "utf-8")
          const nameMatch = content.match(/\[metadata\]\s*[\s\S]*?name\s*=\s*(.+)/)
          if (nameMatch?.[1]) {
            names.add(nameMatch[1].trim())
            return true
          }
        } catch { /* ignore */ }
      }
      // scip-python with --project-name "project" uses literal "project" as package name
      if (existsSync(join(dir, "pyproject.toml")) || existsSync(join(dir, "setup.py")) || existsSync(join(dir, "requirements.txt"))) {
        names.add("project")
        return true
      }
      return false
    }

    case "go": {
      const goMod = join(dir, "go.mod")
      if (existsSync(goMod)) {
        try {
          const content = readFileSync(goMod, "utf-8")
          // First line: "module github.com/org/repo"
          const moduleMatch = content.match(/^module\s+(\S+)/m)
          if (moduleMatch?.[1]) {
            names.add(moduleMatch[1])
            return true
          }
        } catch { /* ignore */ }
      }
      return false
    }

    case "rust": {
      const cargoToml = join(dir, "Cargo.toml")
      if (existsSync(cargoToml)) {
        try {
          const content = readFileSync(cargoToml, "utf-8")
          const nameMatch = content.match(/\[package\]\s*[\s\S]*?name\s*=\s*"([^"]+)"/)
          if (nameMatch?.[1]) {
            names.add(nameMatch[1])
            return true
          }
        } catch { /* ignore */ }
      }
      return false
    }

    case "java": {
      // Maven: pom.xml <artifactId>
      const pomXml = join(dir, "pom.xml")
      if (existsSync(pomXml)) {
        try {
          const content = readFileSync(pomXml, "utf-8")
          const artifactMatch = content.match(/<artifactId>([^<]+)<\/artifactId>/)
          const groupMatch = content.match(/<groupId>([^<]+)<\/groupId>/)
          if (artifactMatch?.[1]) {
            names.add(artifactMatch[1])
            // scip-java may use "groupId:artifactId" format
            if (groupMatch?.[1]) {
              names.add(`${groupMatch[1]}:${artifactMatch[1]}`)
            }
            return true
          }
        } catch { /* ignore */ }
      }
      // Gradle: build.gradle
      const buildGradle = join(dir, "build.gradle")
      const buildGradleKts = join(dir, "build.gradle.kts")
      const gradleFile = existsSync(buildGradle) ? buildGradle : existsSync(buildGradleKts) ? buildGradleKts : null
      if (gradleFile) {
        try {
          const content = readFileSync(gradleFile, "utf-8")
          // Look for group and rootProject.name
          const groupMatch = content.match(/group\s*=?\s*['"]([^'"]+)['"]/)
          if (groupMatch?.[1]) {
            names.add(groupMatch[1])
          }
          // settings.gradle rootProject.name
          const settingsGradle = join(dir, "settings.gradle")
          const settingsGradleKts = join(dir, "settings.gradle.kts")
          const settingsFile = existsSync(settingsGradle) ? settingsGradle : existsSync(settingsGradleKts) ? settingsGradleKts : null
          if (settingsFile) {
            const settingsContent = readFileSync(settingsFile, "utf-8")
            const nameMatch = settingsContent.match(/rootProject\.name\s*=?\s*['"]([^'"]+)['"]/)
            if (nameMatch?.[1]) {
              names.add(nameMatch[1])
            }
          }
          return true
        } catch { /* ignore */ }
      }
      return false
    }

    case "php": {
      const composerJson = join(dir, "composer.json")
      if (existsSync(composerJson)) {
        try {
          const pkg = JSON.parse(readFileSync(composerJson, "utf-8")) as { name?: string }
          if (pkg.name) {
            names.add(pkg.name)
            return true
          }
        } catch { /* ignore */ }
      }
      return false
    }

    case "ruby": {
      // Look for *.gemspec first
      try {
        const { readdirSync } = require("node:fs") as typeof import("node:fs")
        const gemspec = readdirSync(dir).find((f: string) => f.endsWith(".gemspec"))
        if (gemspec) {
          const content = readFileSync(join(dir, gemspec), "utf-8")
          const nameMatch = content.match(/\.name\s*=\s*['"]([^'"]+)['"]/)
          if (nameMatch?.[1]) {
            names.add(nameMatch[1])
            return true
          }
        }
      } catch { /* ignore */ }
      // Gemfile presence — use directory name as fallback
      if (existsSync(join(dir, "Gemfile"))) {
        const dirName = dir.split("/").pop()
        if (dirName) names.add(dirName)
        return true
      }
      return false
    }

    case "csharp": {
      // Look for .csproj files
      try {
        const { readdirSync } = require("node:fs") as typeof import("node:fs")
        const csproj = readdirSync(dir).find((f: string) => f.endsWith(".csproj"))
        if (csproj) {
          const content = readFileSync(join(dir, csproj), "utf-8")
          const assemblyMatch = content.match(/<AssemblyName>([^<]+)<\/AssemblyName>/)
          const namespaceMatch = content.match(/<RootNamespace>([^<]+)<\/RootNamespace>/)
          if (assemblyMatch?.[1]) names.add(assemblyMatch[1])
          if (namespaceMatch?.[1]) names.add(namespaceMatch[1])
          if (assemblyMatch?.[1] || namespaceMatch?.[1]) return true
          // Fallback: use csproj filename without extension
          names.add(csproj.replace(".csproj", ""))
          return true
        }
      } catch { /* ignore */ }
      // Look for .sln files
      if (existsSync(join(dir, `${dir.split("/").pop()}.sln`))) {
        const dirName = dir.split("/").pop()
        if (dirName) names.add(dirName)
        return true
      }
      return false
    }

    case "c":
    case "cpp": {
      const cmakeLists = join(dir, "CMakeLists.txt")
      if (existsSync(cmakeLists)) {
        try {
          const content = readFileSync(cmakeLists, "utf-8")
          // project(name ...) or project(name)
          const projectMatch = content.match(/project\s*\(\s*(\S+)/i)
          if (projectMatch?.[1]) {
            names.add(projectMatch[1])
            return true
          }
        } catch { /* ignore */ }
      }
      // Fallback: compile_commands.json present means it's the project root
      if (existsSync(join(dir, "compile_commands.json"))) {
        const dirName = dir.split("/").pop()
        if (dirName) names.add(dirName)
        return true
      }
      return false
    }

    default: {
      // Unknown language — try package.json as generic fallback
      return tryReadPackageJson(dir, names)
    }
  }
}

function tryReadPackageJson(dir: string, names: Set<string>): boolean {
  const pkgPath = join(dir, "package.json")
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { name?: string }
      if (pkg.name) {
        names.add(pkg.name)
      }
    } catch { /* ignore */ }
    return true
  }
  return false
}

/**
 * Detect whether a SCIP symbol is from an external package.
 *
 * SCIP symbol format: `<scheme> <manager> <package-name> <package-version> <descriptor>...`
 *
 * Each SCIP indexer uses the project's own package/module name as position 2.
 * A symbol is external if its package name is NOT in the project's own package set.
 *
 * This filters stdlib, standard library types, and ALL third-party dependency
 * references — anything not defined in the project itself.
 */
export function isExternalSymbol(symbol: string, projectPackageNames: Set<string>): boolean {
  // Format: "scheme manager pkg-name pkg-version descriptor..."
  const parts = symbol.split(" ", 4)
  if (parts.length < 4) return false

  const pkgName = parts[2]!
  return !projectPackageNames.has(pkgName)
}

// ---------------------------------------------------------------------------
// SCIP symbol parser
// ---------------------------------------------------------------------------

/**
 * Parse a SCIP symbol string into kind and name.
 *
 * SCIP symbol format: `<scheme> <manager> <package> <descriptor>...`
 * Descriptor suffixes indicate kind (consistent across all SCIP indexers):
 *   `.` = term (variable/function), `#` = type (class/interface/struct),
 *   `()` = method, `/` = package/module
 */
export function parseSCIPSymbol(
  symbol: string,
): { kind: ParsedEntity["kind"]; name: string; signature?: string } | null {
  const parts = symbol.trim().split(" ")
  if (parts.length < 2) return null

  // Get the last descriptor
  const descriptor = parts[parts.length - 1]!

  if (descriptor.endsWith("().")) {
    const name = descriptor.slice(0, -3)
    if (!name) return null
    return { kind: "method", name, signature: `${name}()` }
  }
  if (descriptor.endsWith("()")) {
    const name = descriptor.slice(0, -2)
    if (!name) return null
    return { kind: "function", name, signature: `${name}()` }
  }
  if (descriptor.endsWith("#")) {
    const name = descriptor.slice(0, -1)
    if (!name) return null
    return { kind: "class", name }
  }
  if (descriptor.endsWith(".")) {
    const name = descriptor.slice(0, -1)
    if (!name) return null
    return { kind: "variable", name }
  }
  if (descriptor.endsWith("/")) {
    const name = descriptor.slice(0, -1)
    if (!name) return null
    return { kind: "module", name }
  }

  return null
}
