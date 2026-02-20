import { describe, expect, it } from "vitest"
import { tokenize } from "../search-index.js"

describe("search-index", () => {
  describe("tokenize", () => {
    it("splits camelCase", () => {
      expect(tokenize("doSomething")).toEqual(["do", "something"])
    })

    it("splits PascalCase", () => {
      expect(tokenize("MyClassName")).toEqual(["my", "class", "name"])
    })

    it("splits snake_case", () => {
      expect(tokenize("get_user_name")).toEqual(["get", "user", "name"])
    })

    it("splits kebab-case", () => {
      expect(tokenize("my-component")).toEqual(["my", "component"])
    })

    it("handles mixed patterns", () => {
      const tokens = tokenize("getUserName_v2")
      expect(tokens).toContain("get")
      expect(tokens).toContain("user")
      expect(tokens).toContain("name")
      expect(tokens).toContain("v2")
    })

    it("deduplicates tokens", () => {
      const tokens = tokenize("test_test")
      expect(tokens).toEqual(["test"])
    })

    it("lowercases all tokens", () => {
      const tokens = tokenize("HTTPRequest")
      for (const t of tokens) {
        expect(t).toBe(t.toLowerCase())
      }
    })

    it("handles single word", () => {
      expect(tokenize("hello")).toEqual(["hello"])
    })

    it("handles empty string", () => {
      expect(tokenize("")).toEqual([])
    })

    it("splits consecutive uppercase (acronyms)", () => {
      const tokens = tokenize("XMLHTTPRequest")
      expect(tokens).toContain("request")
    })
  })
})
