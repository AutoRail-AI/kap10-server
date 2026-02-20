/**
 * P1-TEST-06: TypeScript tree-sitter parsing → Entity extraction.
 */
import { describe, expect, it } from "vitest"

import { parseTypeScriptFile } from "../tree-sitter"

const SAMPLE_TS = `
import { something } from './module'

export function greet(name: string): string {
  return \`Hello, \${name}\`
}

export class UserService {
  private db: Database

  async getUser(id: string): Promise<User> {
    return this.db.findById(id)
  }

  async deleteUser(id: string): Promise<void> {
    await this.db.delete(id)
  }
}

export interface UserRepository {
  findById(id: string): Promise<User>
}

export type UserId = string

export const fetchUsers = async (limit: number) => {
  return []
}

export enum Role {
  Admin = 'admin',
  User = 'user',
}

function privateHelper() {
  return true
}
`

describe("parseTypeScriptFile", () => {
  const opts = {
    filePath: "src/user-service.ts",
    content: SAMPLE_TS,
    orgId: "org-1",
    repoId: "repo-1",
  }

  it("extracts exported functions", () => {
    const { entities } = parseTypeScriptFile(opts)
    const greet = entities.find((e) => e.name === "greet" && e.kind === "function")
    expect(greet).toBeDefined()
    expect(greet!.exported).toBe(true)
    expect(greet!.file_path).toBe("src/user-service.ts")
  })

  it("extracts private (non-exported) functions", () => {
    const { entities } = parseTypeScriptFile(opts)
    const helper = entities.find((e) => e.name === "privateHelper")
    expect(helper).toBeDefined()
    expect(helper!.exported).toBe(false)
  })

  it("extracts classes", () => {
    const { entities } = parseTypeScriptFile(opts)
    const userService = entities.find((e) => e.name === "UserService" && e.kind === "class")
    expect(userService).toBeDefined()
    expect(userService!.exported).toBe(true)
  })

  it("extracts methods within classes", () => {
    const { entities } = parseTypeScriptFile(opts)
    const getUser = entities.find((e) => e.name === "getUser" && e.kind === "method")
    expect(getUser).toBeDefined()
    expect(getUser!.parent).toBe("UserService")

    const deleteUser = entities.find((e) => e.name === "deleteUser" && e.kind === "method")
    expect(deleteUser).toBeDefined()
  })

  it("creates member_of edges for methods", () => {
    const { entities, edges } = parseTypeScriptFile(opts)
    const getUser = entities.find((e) => e.name === "getUser")
    const userService = entities.find((e) => e.name === "UserService")
    expect(getUser).toBeDefined()
    expect(userService).toBeDefined()

    const memberEdge = edges.find(
      (e) => e.from_id === getUser!.id && e.to_id === userService!.id && e.kind === "member_of",
    )
    expect(memberEdge).toBeDefined()
  })

  it("extracts interfaces", () => {
    const { entities } = parseTypeScriptFile(opts)
    const iface = entities.find((e) => e.name === "UserRepository" && e.kind === "interface")
    expect(iface).toBeDefined()
  })

  it("extracts type aliases", () => {
    const { entities } = parseTypeScriptFile(opts)
    const typeAlias = entities.find((e) => e.name === "UserId" && e.kind === "type")
    expect(typeAlias).toBeDefined()
  })

  it("extracts arrow function exports", () => {
    const { entities } = parseTypeScriptFile(opts)
    const fetchUsers = entities.find((e) => e.name === "fetchUsers")
    expect(fetchUsers).toBeDefined()
    expect(fetchUsers!.exported).toBe(true)
  })

  it("extracts enums", () => {
    const { entities } = parseTypeScriptFile(opts)
    const enumEntity = entities.find((e) => e.name === "Role" && e.kind === "enum")
    expect(enumEntity).toBeDefined()
  })

  it("assigns deterministic IDs via entityHash", () => {
    const result1 = parseTypeScriptFile(opts)
    const result2 = parseTypeScriptFile(opts)

    // Same input should produce same IDs
    const ids1 = result1.entities.map((e) => e.id).sort()
    const ids2 = result2.entities.map((e) => e.id).sort()
    expect(ids1).toEqual(ids2)
  })

  it("all IDs are 16-char hex strings", () => {
    const { entities } = parseTypeScriptFile(opts)
    for (const entity of entities) {
      expect(entity.id).toMatch(/^[0-9a-f]{16}$/)
    }
  })

  it("sets language to typescript for .ts files", () => {
    const { entities } = parseTypeScriptFile(opts)
    for (const entity of entities) {
      expect(entity.language).toBe("typescript")
    }
  })
})

describe("parseTypeScriptFile with class inheritance", () => {
  it("creates extends edges", () => {
    const content = `
export class Animal {
  name: string
}

export class Dog extends Animal {
  bark() {}
}
`
    const { edges } = parseTypeScriptFile({
      filePath: "src/animals.ts",
      content,
      orgId: "org-1",
      repoId: "repo-1",
    })

    const extendsEdge = edges.find((e) => e.kind === "extends")
    expect(extendsEdge).toBeDefined()
  })
})
