/* eslint-disable @typescript-eslint/no-unused-vars */
import { beforeEach, describe, expect, it, vi } from "vitest"
import fs from "fs"
import yaml from "js-yaml"
import {
  getAllRoles,
  getRole,
  hasPermission,
  loadRoleConfig,
} from "../config/roles"

vi.mock("fs")
vi.mock("js-yaml")

describe("Role Configuration", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("loadRoleConfig", () => {
    it("should load role config from YAML", () => {
      const mockConfig = {
        roles: {
          admin: {
            name: "Admin",
            permissions: {
              project: ["create", "read"],
            },
            inherits: [],
          },
        },
        permissions: {},
      }

      vi.mocked(fs.readFileSync).mockReturnValue("yaml content")
      vi.mocked(yaml.load).mockReturnValue(mockConfig)

      const config = loadRoleConfig()

      expect(config).toEqual(mockConfig)
    })

    it("should return default config on error", () => {
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw new Error("File not found")
      })

      const config = loadRoleConfig()

      expect(config).toEqual({ roles: {}, permissions: {} })
    })
  })

  describe("hasPermission", () => {
    it("should check permission correctly", () => {
      const mockConfig = {
        roles: {
          admin: {
            name: "Admin",
            permissions: {
              project: ["create", "read", "update", "delete"],
            },
            inherits: [],
          },
        },
        permissions: {},
      }

      vi.mocked(fs.readFileSync).mockReturnValue("yaml content")
      vi.mocked(yaml.load).mockReturnValue(mockConfig)

      const canCreate = hasPermission("admin", "project", "create")
      expect(canCreate).toBe(true)

      const canDelete = hasPermission("admin", "project", "delete")
      expect(canDelete).toBe(true)
    })

    it("should return false for missing permission", () => {
      const mockConfig = {
        roles: {
          member: {
            name: "Member",
            permissions: {
              project: ["read"],
            },
            inherits: [],
          },
        },
        permissions: {},
      }

      vi.mocked(fs.readFileSync).mockReturnValue("yaml content")
      vi.mocked(yaml.load).mockReturnValue(mockConfig)

      const canDelete = hasPermission("member", "project", "delete")
      expect(canDelete).toBe(false)
    })

    it("should support wildcard permissions", () => {
      const mockConfig = {
        roles: {
          owner: {
            name: "Owner",
            permissions: {
              "*": ["*"],
            },
            inherits: [],
          },
        },
        permissions: {},
      }

      vi.mocked(fs.readFileSync).mockReturnValue("yaml content")
      vi.mocked(yaml.load).mockReturnValue(mockConfig)

      const hasAny = hasPermission("owner", "project", "delete")
      expect(hasAny).toBe(true)
    })
  })
})

