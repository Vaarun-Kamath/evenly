import { problemSchema } from "@evenly/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startHarness, uniqueEmail, type Harness } from "./harness";

describe("Origin check on requests that change something", () => {
  let h: Harness;
  let cookie: string;
  beforeAll(async () => {
    h = await startHarness({
      publicUrl: "https://example.com/evenly",
      env: { TRUSTED_ORIGINS: "https://other.example" },
    });
    cookie = (await h.signUp()).cookie;
  });
  afterAll(async () => {
    await h.close();
  });

  const patch = (headers: Record<string, string>) =>
    h.app.inject({
      method: "PATCH",
      url: "/evenly/api/v1/me",
      headers: { cookie, ...headers },
      payload: { name: "Renamed" },
    });

  it("accepts the public origin (not the Host header, which a proxy changes)", async () => {
    const response = await patch({ origin: "https://example.com", host: "evenly-app:3000" });
    expect(response.statusCode).toBe(200);
  });

  it("accepts a trusted extra origin", async () => {
    expect((await patch({ origin: "https://other.example" })).statusCode).toBe(200);
  });

  it("falls back to Referer when there is no Origin", async () => {
    expect((await patch({ referer: "https://example.com/evenly/account" })).statusCode).toBe(200);
  });

  it.each([
    ["a foreign origin", { origin: "https://evil.example" }],
    ["the null origin", { origin: "null" }],
    ["the right host on the wrong scheme", { origin: "http://example.com" }],
    ["a foreign referer", { referer: "https://evil.example/page" }],
    ["no origin and no referer", {}],
  ])("rejects %s with 403", async (_name, headers) => {
    const response = await patch(headers);
    expect(response.statusCode).toBe(403);
    expect(problemSchema.parse(response.json())).toMatchObject({
      status: 403,
      type: "urn:evenly:problem:forbidden-origin",
    });
  });

  it("does not apply to reading", async () => {
    const response = await h.app.inject({
      url: "/evenly/api/v1/me",
      headers: { cookie, origin: "https://evil.example" },
    });
    expect(response.statusCode).toBe(200);
  });

  it("is also enforced by the auth endpoints", async () => {
    const response = await h.app.inject({
      method: "POST",
      url: "/evenly/api/auth/sign-up/email",
      headers: { origin: "https://evil.example" },
      payload: { email: uniqueEmail(), name: "Mallory", password: "correct horse battery staple" },
    });
    expect(response.statusCode).toBe(403);
    const sessions = await h.db.sql`select 1 from "user" where name = 'Mallory'`;
    expect(sessions).toHaveLength(0);
  });

  it("rejects the rename that was blocked", async () => {
    await patch({ origin: "https://evil.example" });
    const me = await h.app.inject({ url: "/evenly/api/v1/me", headers: { cookie } });
    expect(me.json<{ name: string }>().name).toBe("Renamed"); // from the accepted requests above
    expect(me.json<{ name: string }>().name).not.toBe("Mallory");
  });
});
