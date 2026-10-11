import { describe, expect, it } from "vitest";
import { deriveBasePath, normalizeBasePath } from "../src/basePath";

describe("normalizeBasePath", () => {
  it.each([
    ["", ""],
    ["/", ""],
    ["/evenly", "/evenly"],
    ["/evenly/", "/evenly"],
    ["//evenly//", "/evenly"],
    ["/a/b-c/d_e.f", "/a/b-c/d_e.f"],
  ])("normalises %j to %j", (input, expected) => {
    expect(normalizeBasePath(input)).toBe(expected);
  });

  it.each(["/a/../b", "/./x", '/"><script>', "/white space", "/ü"])("rejects %j", (input) => {
    expect(() => normalizeBasePath(input)).toThrow(/not a valid base path/);
  });
});

describe("deriveBasePath", () => {
  it("derives the path from PUBLIC_URL", () => {
    expect(deriveBasePath("http://localhost:3000")).toBe("");
    expect(deriveBasePath("https://example.com/evenly")).toBe("/evenly");
    expect(deriveBasePath("https://example.com/evenly/")).toBe("/evenly");
  });

  it("accepts an explicit BASE_PATH that agrees", () => {
    expect(deriveBasePath("https://example.com/evenly", "/evenly/")).toBe("/evenly");
    expect(deriveBasePath("https://example.com", "/")).toBe("");
  });

  it("treats an empty BASE_PATH as unset", () => {
    expect(deriveBasePath("https://example.com/evenly", "")).toBe("/evenly");
  });

  it("rejects an explicit BASE_PATH that disagrees", () => {
    expect(() => deriveBasePath("https://example.com/evenly", "/other")).toThrow(
      /does not match the path of PUBLIC_URL/,
    );
    expect(() => deriveBasePath("https://example.com", "/evenly")).toThrow(/does not match/);
  });
});
