/**
 * Minimal type declarations for @ast-grep/napi.
 * The actual package is lazily loaded at runtime via require().
 */
declare module "@ast-grep/napi" {
  interface SgNode {
    text(): string
    kind(): string
    children(): SgNode[]
  }

  interface SgRoot {
    root(): SgNode
  }

  interface Lang {
    parse(code: string): SgRoot
  }

  export const TypeScript: Lang
  export const JavaScript: Lang
  export const Tsx: Lang
  export const Python: Lang
  export const Go: Lang
  export const Rust: Lang
  export const Java: Lang
  export const Kotlin: Lang
  export const C: Lang
  export const Cpp: Lang
  export const CSharp: Lang
}
