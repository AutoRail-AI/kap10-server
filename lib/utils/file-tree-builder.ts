/**
 * Build a nested tree from flat file paths (e.g. from ArangoDB files collection).
 */

export interface TreeNode {
  name: string
  path: string
  type: "file" | "dir"
  children?: TreeNode[]
}

export function buildFileTree(paths: { path: string }[]): TreeNode[] {
  const root: Map<string, TreeNode> = new Map()
  const sorted = [...paths].map((p) => p.path).sort()
  for (const filePath of sorted) {
    const parts = filePath.split("/").filter(Boolean)
    let currentPath = ""
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i]!
      const isFile = i === parts.length - 1
      currentPath = currentPath ? `${currentPath}/${name}` : name
      const key = currentPath
      if (!root.has(key)) {
        root.set(key, {
          name,
          path: key,
          type: isFile ? "file" : "dir",
          children: isFile ? undefined : [],
        })
      }
      if (!isFile && root.get(key)!.children === undefined) {
        root.get(key)!.children = []
      }
      if (i > 0) {
        const parentPath = parts.slice(0, i).join("/")
        const parent = root.get(parentPath)
        if (parent?.children && !parent.children.some((c) => c.path === key)) {
          parent.children.push(root.get(key)!)
        }
      }
    }
  }
  const topLevel = new Set<string>()
  for (const p of sorted) {
    const first = p.split("/")[0]
    if (first) topLevel.add(first)
  }
  return Array.from(topLevel)
    .sort()
    .map((name) => root.get(name)!)
    .filter(Boolean)
}
