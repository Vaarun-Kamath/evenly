import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createResetLink } from "../../src/cli/reset-password";
import {
  cookieHeaderOf,
  SECRET,
  startHarness,
  TEST_PASSWORD,
  uniqueEmail,
  type Harness,
} from "./harness";

const NEW_PASSWORD = "a brand new passphrase";

function tokenOf(link: string): string {
  const token = new URL(link).searchParams.get("token");
  if (token === null) throw new Error(`no token in ${link}`);
  return token;
}

describe("password reset by the instance administrator (no SMTP)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(async () => {
    await h.close();
  });

  const resetWith = (token: string, newPassword = NEW_PASSWORD) =>
    h.request({ method: "POST", url: "/api/auth/reset-password", payload: { newPassword, token } });

  it("prints a link that sets a new password once and signs everyone out", async () => {
    const session = await h.signUp();
    const link = await createResetLink(
      { env: h.env, orm: h.db.orm, secret: SECRET },
      session.email,
    );
    expect(link).toMatch(/^http:\/\/localhost:3000\/reset\?token=[\w-]+$/);

    expect((await resetWith(tokenOf(link!))).statusCode).toBe(200);
    expect((await h.signIn(session.email, TEST_PASSWORD)).statusCode).toBe(401);
    const login = await h.signIn(session.email, NEW_PASSWORD);
    expect(login.statusCode).toBe(200);

    // The session from before the reset no longer works; the new login does.
    const old = await h.request({ url: "/api/v1/me", headers: { cookie: session.cookie } });
    expect(old.statusCode).toBe(401);
    const fresh = await h.request({
      url: "/api/v1/me",
      headers: { cookie: cookieHeaderOf(login) },
    });
    expect(fresh.statusCode).toBe(200);

    // Single use.
    expect((await resetWith(tokenOf(link!), "yet another passphrase")).statusCode).toBe(400);
    expect((await h.signIn(session.email, NEW_PASSWORD)).statusCode).toBe(200);
  });

  it("accepts the email in any case and reports an unknown email", async () => {
    const { email } = await h.signUp();
    const deps = { env: h.env, orm: h.db.orm, secret: SECRET };
    expect(await createResetLink(deps, email.toUpperCase())).toBeDefined();
    expect(await createResetLink(deps, uniqueEmail())).toBeUndefined();
  });

  it("refuses a new password that is too short, and keeps the token usable", async () => {
    const { email } = await h.signUp();
    const link = (await createResetLink({ env: h.env, orm: h.db.orm, secret: SECRET }, email))!;
    expect((await resetWith(tokenOf(link), "short")).statusCode).toBe(400);
    expect((await resetWith(tokenOf(link))).statusCode).toBe(200);
  });

  it("is not available over HTTP without SMTP", async () => {
    const { email } = await h.signUp();
    const response = await h.request({
      method: "POST",
      url: "/api/auth/request-password-reset",
      payload: { email, redirectTo: "/reset" },
    });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(h.mail).toHaveLength(0);
  });

  it("builds the link from PUBLIC_URL, including the base path", async () => {
    const sub = await startHarness({ publicUrl: "https://example.com/evenly/" });
    try {
      const { email } = await sub.signUp();
      const link = await createResetLink({ env: sub.env, orm: sub.db.orm, secret: SECRET }, email);
      expect(link).toMatch(/^https:\/\/example\.com\/evenly\/reset\?token=/);
    } finally {
      await sub.close();
    }
  });
});

describe("password reset by email (SMTP configured)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness({ withMailer: true });
  });
  afterAll(async () => {
    await h.close();
  });

  const request = (email: string) =>
    h.request({
      method: "POST",
      url: "/api/auth/request-password-reset",
      payload: { email, redirectTo: "/reset" },
    });

  it("emails a working link", async () => {
    const { email } = await h.signUp();
    h.mail.length = 0;
    expect((await request(email)).statusCode).toBe(200);
    await expect.poll(() => h.mail.length).toBe(1);

    const [mail] = h.mail;
    expect(mail?.to).toBe(email);
    expect(mail?.subject).toContain("Reset your Evenly password");
    const link = /https?:\/\/\S+\/reset\?token=\S+/.exec(mail?.text ?? "")?.[0];
    expect(link).toBeDefined();

    const reset = await h.request({
      method: "POST",
      url: "/api/auth/reset-password",
      payload: { newPassword: NEW_PASSWORD, token: tokenOf(link!) },
    });
    expect(reset.statusCode).toBe(200);
    expect((await h.signIn(email, NEW_PASSWORD)).statusCode).toBe(200);
  });

  it("answers the same for an unknown email and sends nothing", async () => {
    const { email } = await h.signUp();
    const known = await request(email);
    h.mail.length = 0;
    const unknown = await request(uniqueEmail());
    expect(unknown.statusCode).toBe(known.statusCode);
    expect(unknown.json<{ message: string }>().message).toBe(
      known.json<{ message: string }>().message,
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(h.mail).toHaveLength(0);
  });
});
