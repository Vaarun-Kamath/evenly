import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startHarness, TEST_PASSWORD, uniqueEmail, type Harness } from "./harness";

async function signUpStatus(h: Harness, headers: Record<string, string> = {}) {
  const response = await h.request({
    method: "POST",
    url: "/api/auth/sign-up/email",
    headers,
    payload: { email: uniqueEmail(), name: "Person", password: TEST_PASSWORD },
  });
  return { status: response.statusCode, message: response.body };
}

async function userCount(h: Harness): Promise<number> {
  const [row] = await h.db.sql<{ count: string }[]>`select count(*)::text as count from "user"`;
  return Number(row?.count);
}

describe("ALLOW_SIGNUPS=true", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness({ env: { ALLOW_SIGNUPS: "true" } });
  });
  afterAll(async () => {
    await h.close();
  });

  it("lets anyone sign up", async () => {
    expect((await signUpStatus(h)).status).toBe(200);
    expect((await signUpStatus(h)).status).toBe(200);
    expect(await userCount(h)).toBe(2);
  });
});

describe("ALLOW_SIGNUPS=false", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness({ env: { ALLOW_SIGNUPS: "false" } });
  });
  afterAll(async () => {
    await h.close();
  });

  it("lets the first account be created (so the instance can be set up), then refuses", async () => {
    const owner = await h.signUp();
    const refused = await signUpStatus(h);
    expect(refused.status).toBe(403);
    expect(refused.message).toContain("disabled");
    expect(await userCount(h)).toBe(1);

    // Existing users can still sign in.
    expect((await h.signIn(owner.email)).statusCode).toBe(200);
  });
});

describe("ALLOW_SIGNUPS=invite-only", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness({ env: { ALLOW_SIGNUPS: "invite-only" } });
  });
  afterAll(async () => {
    await h.close();
  });

  it("refuses sign-ups without a valid invitation, after the first account", async () => {
    await h.signUp();
    const refused = await signUpStatus(h);
    expect(refused.status).toBe(403);
    expect(refused.message).toContain("invitation");
    expect((await signUpStatus(h, { "x-evenly-invite": "not-a-token" })).status).toBe(403);
    expect(await userCount(h)).toBe(1);
  });
});
