/**
 * Unit tests for Go regex-based parser.
 *
 * Tests extraction of functions, structs, interfaces, methods,
 * type aliases, and exported detection from Go source files.
 */
import { describe, expect, it } from "vitest"

import { parseGoFile } from "../tree-sitter"

const OPTS = {
  orgId: "org-1",
  repoId: "repo-1",
}

describe("parseGoFile", () => {
  it("extracts top-level functions", () => {
    const content = `package main

func Hello(name string) string {
	return "Hello, " + name
}

func goodbye(name string) string {
	return "Goodbye, " + name
}
`
    const result = parseGoFile({ filePath: "main.go", content, ...OPTS })

    const funcs = result.entities.filter((e) => e.kind === "function")
    expect(funcs).toHaveLength(2)
    expect(funcs[0]!.name).toBe("Hello")
    expect(funcs[0]!.language).toBe("go")
    expect(funcs[0]!.start_line).toBe(3)
    expect(funcs[0]!.signature).toContain("func Hello(")
    expect(funcs[0]!.exported).toBe(true)
    expect(funcs[1]!.name).toBe("goodbye")
    expect(funcs[1]!.exported).toBe(false)
  })

  it("extracts struct declarations", () => {
    const content = `package models

type User struct {
	Name  string
	Email string
}

type adminUser struct {
	role string
}
`
    const result = parseGoFile({ filePath: "models.go", content, ...OPTS })

    const structs = result.entities.filter((e) => e.kind === "struct")
    expect(structs).toHaveLength(2)
    expect(structs[0]!.name).toBe("User")
    expect(structs[0]!.exported).toBe(true)
    expect(structs[0]!.start_line).toBe(3)
    expect(structs[1]!.name).toBe("adminUser")
    expect(structs[1]!.exported).toBe(false)
  })

  it("extracts interface declarations", () => {
    const content = `package service

type Repository interface {
	Find(id string) (*User, error)
	Save(user *User) error
}

type handler interface {
	Handle() error
}
`
    const result = parseGoFile({ filePath: "service.go", content, ...OPTS })

    const ifaces = result.entities.filter((e) => e.kind === "interface")
    expect(ifaces).toHaveLength(2)
    expect(ifaces[0]!.name).toBe("Repository")
    expect(ifaces[0]!.exported).toBe(true)
    expect(ifaces[1]!.name).toBe("handler")
    expect(ifaces[1]!.exported).toBe(false)
  })

  it("extracts methods with receiver types", () => {
    const content = `package models

type User struct {
	Name string
}

func (u *User) Greet() string {
	return "Hello, " + u.Name
}

func (u User) String() string {
	return u.Name
}
`
    const result = parseGoFile({ filePath: "user.go", content, ...OPTS })

    const methods = result.entities.filter((e) => e.kind === "method")
    expect(methods).toHaveLength(2)
    expect(methods[0]!.name).toBe("Greet")
    expect(methods[0]!.parent).toBe("User")
    expect(methods[0]!.signature).toContain("(User).Greet(")
    expect(methods[0]!.exported).toBe(true)
  })

  it("creates member_of edges for methods", () => {
    const content = `package calc

type Calculator struct{}

func (c *Calculator) Add(a, b int) int {
	return a + b
}
`
    const result = parseGoFile({ filePath: "calc.go", content, ...OPTS })

    const memberEdges = result.edges.filter((e) => e.kind === "member_of")
    expect(memberEdges).toHaveLength(1)

    const method = result.entities.find((e) => e.name === "Add")
    const structEntity = result.entities.find((e) => e.name === "Calculator")
    expect(memberEdges[0]!.from_id).toBe(method!.id)
    expect(memberEdges[0]!.to_id).toBe(structEntity!.id)
  })

  it("extracts type aliases", () => {
    const content = `package types

type ID string

type Handler func(w http.ResponseWriter, r *http.Request)
`
    const result = parseGoFile({ filePath: "types.go", content, ...OPTS })

    const types = result.entities.filter((e) => e.kind === "type")
    expect(types).toHaveLength(2)
    expect(types[0]!.name).toBe("ID")
    expect(types[0]!.exported).toBe(true)
    expect(types[1]!.name).toBe("Handler")
  })

  it("generates deterministic entity IDs", () => {
    const content = `package main

func Process() {
}
`
    const r1 = parseGoFile({ filePath: "det.go", content, ...OPTS })
    const r2 = parseGoFile({ filePath: "det.go", content, ...OPTS })

    expect(r1.entities[0]!.id).toBe(r2.entities[0]!.id)
  })

  it("handles empty files", () => {
    const result = parseGoFile({ filePath: "empty.go", content: "", ...OPTS })

    expect(result.entities).toHaveLength(0)
    expect(result.edges).toHaveLength(0)
  })

  it("handles comment-only files", () => {
    const content = `// Package main is the entry point.
// This file has no code.
`
    const result = parseGoFile({ filePath: "comments.go", content, ...OPTS })

    expect(result.entities).toHaveLength(0)
  })

  it("detects exported vs unexported correctly", () => {
    const content = `package pkg

func PublicFunc() {}
func privateFunc() {}

type PublicStruct struct {}
type privateStruct struct {}

type PublicInterface interface {}
type privateInterface interface {}
`
    const result = parseGoFile({ filePath: "export.go", content, ...OPTS })

    const byName = new Map(result.entities.map((e) => [e.name, e]))
    expect(byName.get("PublicFunc")!.exported).toBe(true)
    expect(byName.get("privateFunc")!.exported).toBe(false)
    expect(byName.get("PublicStruct")!.exported).toBe(true)
    expect(byName.get("privateStruct")!.exported).toBe(false)
    expect(byName.get("PublicInterface")!.exported).toBe(true)
    expect(byName.get("privateInterface")!.exported).toBe(false)
  })

  it("handles functions with multiple parameters and return types", () => {
    const content = `package main

func Process(ctx context.Context, data []byte, opts ...Option) (Result, error) {
	return Result{}, nil
}
`
    const result = parseGoFile({ filePath: "complex.go", content, ...OPTS })

    const funcs = result.entities.filter((e) => e.kind === "function")
    expect(funcs).toHaveLength(1)
    expect(funcs[0]!.name).toBe("Process")
    expect(funcs[0]!.signature).toContain("ctx context.Context")
  })

  it("handles mixed entity types in one file", () => {
    const content = `package api

type Service struct {
	db Database
}

type Database interface {
	Query(sql string) error
}

type Config map[string]string

func NewService(db Database) *Service {
	return &Service{db: db}
}

func (s *Service) Handle() error {
	return nil
}
`
    const result = parseGoFile({ filePath: "api.go", content, ...OPTS })

    expect(result.entities.filter((e) => e.kind === "struct")).toHaveLength(1)
    expect(result.entities.filter((e) => e.kind === "interface")).toHaveLength(1)
    expect(result.entities.filter((e) => e.kind === "type")).toHaveLength(1)
    expect(result.entities.filter((e) => e.kind === "function")).toHaveLength(1)
    expect(result.entities.filter((e) => e.kind === "method")).toHaveLength(1)
  })
})
