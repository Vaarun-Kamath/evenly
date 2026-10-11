import { describe, expect, it } from "vitest";
import { pingResponseSchema, problemSchema } from "../src";

describe("pingResponseSchema", () => {
  it("accepts the ping body and rejects anything else", () => {
    expect(pingResponseSchema.parse({ status: "ok", name: "evenly" })).toEqual({
      status: "ok",
      name: "evenly",
    });
    expect(pingResponseSchema.safeParse({ status: "ok" }).success).toBe(false);
    expect(pingResponseSchema.safeParse({ status: "down", name: "evenly" }).success).toBe(false);
  });
});

describe("problemSchema", () => {
  it("accepts an RFC 9457 body with and without field errors", () => {
    expect(
      problemSchema.safeParse({ type: "about:blank", title: "Not Found", status: 404 }).success,
    ).toBe(true);
    expect(
      problemSchema.safeParse({
        type: "urn:evenly:problem:validation",
        title: "Bad Request",
        status: 400,
        errors: [{ path: "/amountMinor", message: "must be positive" }],
      }).success,
    ).toBe(true);
  });

  it("rejects a non-error status", () => {
    expect(problemSchema.safeParse({ type: "about:blank", title: "OK", status: 200 }).success).toBe(
      false,
    );
  });
});
