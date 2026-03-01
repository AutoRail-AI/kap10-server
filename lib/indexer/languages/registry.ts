/**
 * Language plugin registry.
 *
 * Maps file extensions to language plugins. Plugins are statically imported
 * but SCIP/tree-sitter only executes when plugin methods are called.
 */
import type { LanguagePlugin } from "./types"

/** All registered language plugins, keyed by plugin ID. */
const plugins = new Map<string, LanguagePlugin>()

/** Extension → plugin ID mapping. */
const extensionMap = new Map<string, string>()

let initialized = false

/** Register a language plugin. */
export function registerPlugin(plugin: LanguagePlugin): void {
  plugins.set(plugin.id, plugin)
  for (const ext of plugin.extensions) {
    extensionMap.set(ext.toLowerCase(), plugin.id)
  }
}

/** Get the language plugin for a file extension, or undefined. */
export function getPluginForExtension(ext: string): LanguagePlugin | undefined {
  const pluginId = extensionMap.get(ext.toLowerCase())
  if (!pluginId) return undefined
  return plugins.get(pluginId)
}

/** Get all registered plugins. */
export function getAllPlugins(): LanguagePlugin[] {
  return Array.from(plugins.values())
}

/**
 * Get the set of unique plugins needed for a list of file extensions.
 */
export function getPluginsForExtensions(extensions: string[]): LanguagePlugin[] {
  const seen = new Set<string>()
  const result: LanguagePlugin[] = []

  for (const ext of extensions) {
    const pluginId = extensionMap.get(ext.toLowerCase())
    if (pluginId && !seen.has(pluginId)) {
      seen.add(pluginId)
      const plugin = plugins.get(pluginId)
      if (plugin) result.push(plugin)
    }
  }

  return result
}

/** Initialize registry with all built-in language plugins. */
export async function initializeRegistry(): Promise<void> {
  if (initialized) return
  initialized = true

  const [ts, py, go, java, c, cpp, csharp, php, ruby, rust] = await Promise.all([
    import("./typescript/index"),
    import("./python/index"),
    import("./go/index"),
    import("./java/index"),
    import("./c/index"),
    import("./cpp/index"),
    import("./csharp/index"),
    import("./php/index"),
    import("./ruby/index"),
    import("./rust/index"),
  ])

  registerPlugin(ts.typescriptPlugin)
  registerPlugin(py.pythonPlugin)
  registerPlugin(go.goPlugin)
  registerPlugin(java.javaPlugin)
  registerPlugin(c.cPlugin)
  registerPlugin(cpp.cppPlugin)
  registerPlugin(csharp.csharpPlugin)
  registerPlugin(php.phpPlugin)
  registerPlugin(ruby.rubyPlugin)
  registerPlugin(rust.rustPlugin)
}

/** Reset registry state (for testing). */
export function _resetRegistry(): void {
  plugins.clear()
  extensionMap.clear()
  initialized = false
}
