import fs from "fs"
import path from "path"
import yaml from "js-yaml"

export interface RolePermission {
  [resource: string]: string[]
}

export interface Role {
  name: string
  description: string
  permissions: RolePermission
  inherits: string[]
}

export interface RoleConfig {
  roles: Record<string, Role>
  permissions: Record<string, string[]>
}

let cachedConfig: RoleConfig | null = null

export function loadRoleConfig(): RoleConfig {
  if (cachedConfig) return cachedConfig

  const configPath = path.join(process.cwd(), "config", "roles.yaml")
  
  try {
    const fileContents = fs.readFileSync(configPath, "utf8")
    const config = yaml.load(fileContents) as RoleConfig
    cachedConfig = config
    return config
  } catch (error) {
    console.error("Failed to load role config:", error)
    // Return default config
    return {
      roles: {},
      permissions: {},
    }
  }
}

export function getRole(name: string): Role | null {
  const config = loadRoleConfig()
  return config.roles[name] || null
}

export function getAllRoles(): Record<string, Role> {
  const config = loadRoleConfig()
  return config.roles
}

export function hasPermission(
  roleName: string,
  resource: string,
  action: string
): boolean {
  const role = getRole(roleName)
  if (!role) return false

  // Check for wildcard permission
  if (role.permissions["*"]) return true

  // Check specific resource permissions
  const resourcePerms = role.permissions[resource]
  if (!resourcePerms) {
    // Check inherited roles
    for (const inheritedRole of role.inherits) {
      if (hasPermission(inheritedRole, resource, action)) {
        return true
      }
    }
    return false
  }

  return resourcePerms.includes(action) || resourcePerms.includes("*")
}

export function reloadRoleConfig(): void {
  cachedConfig = null
  loadRoleConfig()
}

