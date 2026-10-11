import { meResponseSchema, problemSchema } from "@evenly/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cookieHeaderOf, startHarness, TEST_PASSWORD, uniqueEmail, type Harness } from "./harness";

describe("sign up, log in, GET /me, log out", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(async () => {
    await h.close();
  });

  it("walks the whole flow", async () => {
    const email = uniqueEmail();

    // Not signed in yet.
    const anonymous = await h.request({ url: "/api/v1/me" });
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.headers["content-type"]).toContain("application/problem+json");
    expect(problemSchema.parse(anonymous.json())).toMatchObject({
      status: 401,
      type: "urn:evenly:problem:unauthenticated",
    });

    // Sign up: signs the new user in.
    const session = await h.signUp({ email, name: "  Asha Rao " });
    expect(session.cookie).toContain("evenly.session_token=");
    const me = await h.request({ url: "/api/v1/me", headers: { cookie: session.cookie } });
    expect(me.statusCode).toBe(200);
    expect(meResponseSchema.parse(me.json())).toMatchObject({
      id: session.userId,
      email,
      defaultCurrency: null,
    });

    // Log out: the cookie stops working.
    const out = await h.request({
      method: "POST",
      url: "/api/auth/sign-out",
      headers: { cookie: session.cookie },
      payload: {},
    });
    expect(out.statusCode).toBe(200);
    const afterLogout = await h.request({ url: "/api/v1/me", headers: { cookie: session.cookie } });
    expect(afterLogout.statusCode).toBe(401);

    // Log in again with the password.
    const login = await h.signIn(email);
    expect(login.statusCode).toBe(200);
    const again = await h.request({
      url: "/api/v1/me",
      headers: { cookie: cookieHeaderOf(login) },
    });
    expect(again.statusCode).toBe(200);
    expect(again.json<{ email: string }>().email).toBe(email);
  });

  it("refuses a wrong password and an unknown account the same way", async () => {
    const { email } = await h.signUp();
    const wrong = await h.signIn(email, "not the right password");
    const unknown = await h.signIn(uniqueEmail());
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json<{ message: string }>().message).toBe(
      unknown.json<{ message: string }>().message,
    );
  });

  it("refuses a duplicate email, a short password and a bad name", async () => {
    const { email } = await h.signUp();
    const post = (payload: object) =>
      h.request({ method: "POST", url: "/api/auth/sign-up/email", payload });

    expect((await post({ email, name: "Again", password: TEST_PASSWORD })).statusCode).toBe(422);
    expect(
      (await post({ email: uniqueEmail(), name: "Short", password: "tooshort" })).statusCode,
    ).toBe(400);
    expect(
      (await post({ email: uniqueEmail(), name: "   ", password: TEST_PASSWORD })).statusCode,
    ).toBe(400);
    expect(
      (await post({ email: uniqueEmail(), name: "x".repeat(101), password: TEST_PASSWORD }))
        .statusCode,
    ).toBe(400);
  });

  it("treats the email case-insensitively", async () => {
    const email = uniqueEmail();
    await h.signUp({ email });
    expect((await h.signIn(email.toUpperCase())).statusCode).toBe(200);
  });

  it("logs out of all sessions at once", async () => {
    const first = await h.signUp();
    const second = cookieHeaderOf(await h.signIn(first.email));
    const check = (cookie: string) => h.request({ url: "/api/v1/me", headers: { cookie } });
    expect((await check(first.cookie)).statusCode).toBe(200);
    expect((await check(second)).statusCode).toBe(200);

    const revoke = await h.request({
      method: "POST",
      url: "/api/auth/revoke-sessions",
      headers: { cookie: second },
      payload: {},
    });
    expect(revoke.statusCode).toBe(200);
    expect((await check(first.cookie)).statusCode).toBe(401);
    expect((await check(second)).statusCode).toBe(401);
  });

  it("never stores the password itself", async () => {
    const { userId } = await h.signUp();
    const [account] = await h.db.sql<{ password: string }[]>`
      select password from account where user_id = ${userId}
    `;
    expect(account?.password).toBeTruthy();
    expect(account?.password).not.toContain(TEST_PASSWORD);
  });
});

describe("session cookie", () => {
  it("at the site root over http: HttpOnly, SameSite=Lax, Path=/, not Secure", async () => {
    const h = await startHarness({ publicUrl: "http://localhost:3000" });
    try {
      const response = await h.signIn((await h.signUp()).email);
      const cookie = response.cookies.find((c) => c.name === "evenly.session_token");
      expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Lax", path: "/" });
      expect(cookie?.secure).toBeFalsy();
    } finally {
      await h.close();
    }
  });

  it("under /evenly over https: Path=/evenly and Secure; the whole flow works there", async () => {
    const h = await startHarness({ publicUrl: "https://example.com/evenly" });
    try {
      expect(h.base).toBe("/evenly");
      const session = await h.signUp();
      const response = await h.signIn(session.email);
      const cookie = response.cookies.find((c) => c.name === "__Secure-evenly.session_token");
      expect(cookie).toMatchObject({
        httpOnly: true,
        sameSite: "Lax",
        path: "/evenly",
        secure: true,
      });

      const me = await h.request({ url: "/evenly/api/v1/me", headers: { cookie: session.cookie } });
      expect(me.statusCode).toBe(200);
      // The auth library is not reachable outside the base path.
      const outside = await h.request({ method: "POST", url: "/api/auth/sign-out", payload: {} });
      expect(outside.statusCode).toBe(404);
    } finally {
      await h.close();
    }
  });
});
