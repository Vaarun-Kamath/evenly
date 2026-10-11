import { meResponseSchema, problemSchema } from "@evenly/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startHarness, type Harness, type Session } from "./harness";

describe("GET and PATCH /api/v1/me", () => {
  let h: Harness;
  let session: Session;
  beforeAll(async () => {
    h = await startHarness();
    session = await h.signUp({ name: "Original Name" });
  });
  afterAll(async () => {
    await h.close();
  });

  const patch = (payload: unknown, cookie: string | null = session.cookie) =>
    h.request({
      method: "PATCH",
      url: "/api/v1/me",
      headers: cookie === null ? {} : { cookie },
      payload: payload as object,
    });

  it("requires a session", async () => {
    expect((await patch({ name: "x" }, null)).statusCode).toBe(401);
  });

  it("changes the display name and the default currency, and keeps them", async () => {
    const response = await patch({ name: "  New Name ", defaultCurrency: "INR" });
    expect(response.statusCode).toBe(200);
    expect(meResponseSchema.parse(response.json())).toMatchObject({
      id: session.userId,
      name: "New Name",
      defaultCurrency: "INR",
    });

    const me = await h.request({ url: "/api/v1/me", headers: { cookie: session.cookie } });
    expect(me.json()).toMatchObject({ name: "New Name", defaultCurrency: "INR" });
  });

  it("changes one field at a time and can clear the currency", async () => {
    await patch({ defaultCurrency: "JPY" });
    expect((await patch({ name: "Only Name" })).json()).toMatchObject({
      name: "Only Name",
      defaultCurrency: "JPY",
    });
    expect((await patch({ defaultCurrency: null })).json()).toMatchObject({
      defaultCurrency: null,
    });
  });

  it.each([
    ["an unsupported currency", { defaultCurrency: "BTC" }],
    ["a lower-case currency", { defaultCurrency: "inr" }],
    ["an empty body", {}],
    ["an unknown field", { name: "Ok", isAdmin: true }],
    ["a blank name", { name: "   " }],
    ["an over-long name", { name: "x".repeat(101) }],
    ["a name that is not text", { name: 5 }],
  ])("rejects %s with a 400 problem", async (_label, body) => {
    const response = await patch(body);
    expect(response.statusCode).toBe(400);
    expect(response.headers["content-type"]).toContain("application/problem+json");
    expect(problemSchema.parse(response.json()).errors?.length).toBeGreaterThan(0);
  });

  it("cannot be used to change someone else's account, or the email", async () => {
    const other = await h.signUp({ name: "Other Person" });
    await patch({ name: "Changed Mine" });
    const otherMe = await h.request({ url: "/api/v1/me", headers: { cookie: other.cookie } });
    expect(otherMe.json()).toMatchObject({ name: "Other Person" });
    expect((await patch({ email: "new@example.com" })).statusCode).toBe(400);
  });

  it("the auth library's own update endpoint cannot set the currency", async () => {
    const response = await h.request({
      method: "POST",
      url: "/api/auth/update-user",
      headers: { cookie: session.cookie },
      payload: { defaultCurrency: "ZZZ" },
    });
    const me = await h.request({ url: "/api/v1/me", headers: { cookie: session.cookie } });
    expect(me.json<{ defaultCurrency: string | null }>().defaultCurrency).not.toBe("ZZZ");
    // Either refused outright or ignored; never applied.
    expect([200, 400, 422]).toContain(response.statusCode);
  });
});
