import { describe, expect, it } from "vitest";
import { readBasePath, withBasePath } from "../src/lib/basePath";

function docWith(content: string | null) {
  return {
    querySelector: () => (content === null ? null : { getAttribute: () => content }),
  };
}

describe("readBasePath", () => {
  it("is empty without the meta tag (vite dev, tests)", () => {
    expect(readBasePath(docWith(null))).toBe("");
  });

  it.each([
    ["", ""],
    ["/evenly", "/evenly"],
    ["/evenly/", "/evenly"],
    ["evenly", "/evenly"],
    ["/a/b", "/a/b"],
  ])("reads %j as %j", (content, expected) => {
    expect(readBasePath(docWith(content))).toBe(expected);
  });
});

describe("withBasePath", () => {
  it("prefixes app-relative paths", () => {
    expect(withBasePath("", "/api/v1/ping")).toBe("/api/v1/ping");
    expect(withBasePath("/evenly", "/api/v1/ping")).toBe("/evenly/api/v1/ping");
    expect(withBasePath("/evenly", "api/v1/ping")).toBe("/evenly/api/v1/ping");
  });
});
