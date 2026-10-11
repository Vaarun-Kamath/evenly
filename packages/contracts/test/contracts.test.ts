import { describe, expect, it } from "vitest";
import { meResponseSchema, pingResponseSchema, problemSchema, updateMeRequestSchema } from "../src";

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

describe("updateMeRequestSchema", () => {
  it("accepts a name and/or a supported currency, or null to clear it", () => {
    expect(updateMeRequestSchema.parse({ name: "  Asha " })).toEqual({ name: "Asha" });
    expect(updateMeRequestSchema.parse({ defaultCurrency: "INR" })).toEqual({
      defaultCurrency: "INR",
    });
    expect(updateMeRequestSchema.parse({ defaultCurrency: null })).toEqual({
      defaultCurrency: null,
    });
    expect(updateMeRequestSchema.parse({ name: "A", defaultCurrency: "JPY" })).toEqual({
      name: "A",
      defaultCurrency: "JPY",
    });
  });

  it.each([
    ["an empty body", {}],
    ["an unknown field", { name: "A", email: "x@example.com" }],
    ["a blank name", { name: "   " }],
    ["a name over 100 characters", { name: "x".repeat(101) }],
    ["an unsupported currency", { defaultCurrency: "BTC" }],
    ["a lower-case currency", { defaultCurrency: "inr" }],
  ])("rejects %s", (_label, body) => {
    expect(updateMeRequestSchema.safeParse(body).success).toBe(false);
  });
});

describe("meResponseSchema", () => {
  it("needs an ISO timestamp and allows a null currency", () => {
    const me = { id: "u1", name: "A", email: "a@example.com", defaultCurrency: null };
    expect(
      meResponseSchema.safeParse({ ...me, createdAt: "2026-10-11T10:00:00.000Z" }).success,
    ).toBe(true);
    expect(meResponseSchema.safeParse({ ...me, createdAt: "yesterday" }).success).toBe(false);
  });
});
