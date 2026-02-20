/**
 * Unit tests for Python regex-based parser.
 *
 * Tests extraction of functions, classes, methods, decorators,
 * and class inheritance from Python source files.
 */
import { describe, expect, it } from "vitest"

import { parsePythonFile } from "../tree-sitter"

const OPTS = {
  orgId: "org-1",
  repoId: "repo-1",
}

describe("parsePythonFile", () => {
  it("extracts top-level functions", () => {
    const content = `
def hello(name: str) -> str:
    return f"Hello, {name}"

def goodbye(name):
    return f"Goodbye, {name}"
`
    const result = parsePythonFile({ filePath: "app.py", content, ...OPTS })

    const funcs = result.entities.filter((e) => e.kind === "function")
    expect(funcs).toHaveLength(2)
    expect(funcs.map((f) => f.name)).toEqual(["hello", "goodbye"])
    expect(funcs[0]!.language).toBe("python")
    expect(funcs[0]!.file_path).toBe("app.py")
    expect(funcs[0]!.start_line).toBe(2)
    expect(funcs[0]!.signature).toContain("def hello(")
  })

  it("extracts async functions", () => {
    const content = `
async def fetch_data(url: str):
    pass
`
    const result = parsePythonFile({ filePath: "async.py", content, ...OPTS })

    const funcs = result.entities.filter((e) => e.kind === "function")
    expect(funcs).toHaveLength(1)
    expect(funcs[0]!.name).toBe("fetch_data")
  })

  it("extracts classes", () => {
    const content = `
class UserService:
    pass

class AdminService(UserService):
    pass
`
    const result = parsePythonFile({ filePath: "services.py", content, ...OPTS })

    const classes = result.entities.filter((e) => e.kind === "class")
    expect(classes).toHaveLength(2)
    expect(classes[0]!.name).toBe("UserService")
    expect(classes[1]!.name).toBe("AdminService")
    expect(classes[0]!.start_line).toBe(2)
  })

  it("extracts methods within classes", () => {
    const content = `
class MyClass:
    def __init__(self, name):
        self.name = name

    def greet(self):
        return f"Hello, {self.name}"
`
    const result = parsePythonFile({ filePath: "cls.py", content, ...OPTS })

    const methods = result.entities.filter((e) => e.kind === "method")
    expect(methods).toHaveLength(2)
    expect(methods.map((m) => m.name)).toEqual(["__init__", "greet"])
    expect(methods[0]!.parent).toBe("MyClass")
    expect(methods[0]!.signature).toContain("MyClass.__init__")
  })

  it("creates member_of edges for methods", () => {
    const content = `
class Calculator:
    def add(self, a, b):
        return a + b
`
    const result = parsePythonFile({ filePath: "calc.py", content, ...OPTS })

    const memberEdges = result.edges.filter((e) => e.kind === "member_of")
    expect(memberEdges).toHaveLength(1)

    const method = result.entities.find((e) => e.name === "add")
    const cls = result.entities.find((e) => e.name === "Calculator")
    expect(memberEdges[0]!.from_id).toBe(method!.id)
    expect(memberEdges[0]!.to_id).toBe(cls!.id)
  })

  it("creates extends edges for class inheritance", () => {
    const content = `
class Base:
    pass

class Child(Base):
    pass
`
    const result = parsePythonFile({ filePath: "inherit.py", content, ...OPTS })

    const extendsEdges = result.edges.filter((e) => e.kind === "extends")
    expect(extendsEdges).toHaveLength(1)

    const child = result.entities.find((e) => e.name === "Child")
    expect(extendsEdges[0]!.from_id).toBe(child!.id)
  })

  it("skips object and ABC as base classes for extends edges", () => {
    const content = `
from abc import ABC

class MyAbstract(ABC):
    pass

class Plain(object):
    pass
`
    const result = parsePythonFile({ filePath: "abc_test.py", content, ...OPTS })

    const extendsEdges = result.edges.filter((e) => e.kind === "extends")
    expect(extendsEdges).toHaveLength(0)
  })

  it("extracts decorators", () => {
    const content = `
@property
def name(self):
    return self._name

@staticmethod
def create():
    pass

@app.route("/api")
def api_handler():
    pass
`
    const result = parsePythonFile({ filePath: "dec.py", content, ...OPTS })

    const decorators = result.entities.filter((e) => e.kind === "decorator")
    expect(decorators).toHaveLength(3)
    expect(decorators.map((d) => d.name)).toEqual(["property", "staticmethod", "app.route"])
  })

  it("generates deterministic entity IDs", () => {
    const content = `
def process():
    pass
`
    const r1 = parsePythonFile({ filePath: "det.py", content, ...OPTS })
    const r2 = parsePythonFile({ filePath: "det.py", content, ...OPTS })

    expect(r1.entities[0]!.id).toBe(r2.entities[0]!.id)
  })

  it("handles empty files", () => {
    const result = parsePythonFile({ filePath: "empty.py", content: "", ...OPTS })

    expect(result.entities).toHaveLength(0)
    expect(result.edges).toHaveLength(0)
  })

  it("handles comment-only files", () => {
    const content = `
# This is a comment
# Another comment
"""
Docstring module
"""
`
    const result = parsePythonFile({ filePath: "comments.py", content, ...OPTS })

    expect(result.entities).toHaveLength(0)
  })

  it("exits class scope when indentation decreases", () => {
    const content = `
class MyClass:
    def method(self):
        pass

def top_level():
    pass
`
    const result = parsePythonFile({ filePath: "scope.py", content, ...OPTS })

    const methods = result.entities.filter((e) => e.kind === "method")
    const funcs = result.entities.filter((e) => e.kind === "function")

    expect(methods).toHaveLength(1)
    expect(methods[0]!.name).toBe("method")
    expect(methods[0]!.parent).toBe("MyClass")

    expect(funcs).toHaveLength(1)
    expect(funcs[0]!.name).toBe("top_level")
  })

  it("handles multiple inheritance", () => {
    const content = `
class MultiChild(Base1, Base2, Base3):
    pass
`
    const result = parsePythonFile({ filePath: "multi.py", content, ...OPTS })

    const extendsEdges = result.edges.filter((e) => e.kind === "extends")
    expect(extendsEdges).toHaveLength(3)
  })
})
