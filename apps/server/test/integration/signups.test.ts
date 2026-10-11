import { describe, expect, it } from "vitest";
import { startHarness, TEST_PASSWORD, uniqueEmail } from "./harness";

async function trySignUp(allow: string) {
  const h = await startHarness({ env: { ALLOW_SIGNUPS: allow } });
  try {
    const response = await h.request({
      method: "POST",
      url: "/api/auth/sign-up/email",
      payload: { email: uniqueEmail(), name: "Person", password: TEST_PASSWORD },
    });
    const [{ count } = { count: "missing" }] = await h.db.sql<
      { count: string }[]
    >`select count(*)::text as count from "user"`;
    return { status: response.statusCode, users: Number(count), message: response.body };
  } finally {
    await h.close();
  }
}

describe("ALLOW_SIGNUPS", () => {
  it("true: anyone can sign up", async () => {
    expect(await trySignUp("true")).toMatchObject({ status: 200, users: 1 });
  });

  it("false: sign-ups are refused", async () => {
    const result = await trySignUp("false");
    expect(result).toMatchObject({ status: 403, users: 0 });
    expect(result.message).toContain("disabled");
  });

  it("invite-only: refused without a valid invitation (invites arrive in M3)", async () => {
    const result = await trySignUp("invite-only");
    expect(result).toMatchObject({ status: 403, users: 0 });
    expect(result.message).toContain("invitation");
  });

  it("false: existing users can still sign in", async () => {
    const open = await startHarness();
    try {
      const { email } = await open.signUp();
      // Same database, now with sign-ups closed.
      const closed = await startHarnessOn(open);
      expect((await closed.signIn(email)).statusCode).toBe(200);
      await closed.app.close();
    } finally {
      await open.close();
    }
  });
});

/** A second app instance (sign-ups closed) on the first harness's database. */
async function startHarnessOn(open: Awaited<ReturnType<typeof startHarness>>) {
  const { buildApp } = await import("../../src/app");
  const { loadEnv } = await import("../../src/env");
  const { SECRET, HIGH_RATE_LIMITS } = await import("./harness");
  const env = loadEnv({
    DATABASE_URL: open.database.url,
    LOG_LEVEL: "silent",
    NODE_ENV: "test",
    ALLOW_SIGNUPS: "false",
  });
  const app = await buildApp({ env, db: open.db, secret: SECRET, rateLimits: HIGH_RATE_LIMITS });
  await app.ready();
  return {
    app,
    signIn: (email: string) =>
      app.inject({
        method: "POST",
        url: "/api/auth/sign-in/email",
        headers: { origin: env.publicOrigin },
        payload: { email, password: TEST_PASSWORD },
      }),
  };
}
