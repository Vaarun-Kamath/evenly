import { instanceConfigSchema } from "@evenly/contracts";
import { describe, expect, it } from "vitest";
import { startHarness } from "./harness";

async function configOf(options: Parameters<typeof startHarness>[0], signUpFirst = false) {
  const h = await startHarness(options);
  try {
    if (signUpFirst) await h.signUp();
    const response = await h.as(null).get("/config");
    expect(response.statusCode).toBe(200);
    return instanceConfigSchema.parse(response.json());
  } finally {
    await h.close();
  }
}

describe("GET /api/v1/config (public)", () => {
  it("says whether email is set up", async () => {
    expect((await configOf({})).emailEnabled).toBe(false);
    expect((await configOf({ withMailer: true })).emailEnabled).toBe(true);
  });

  it("follows ALLOW_SIGNUPS once the instance has an account", async () => {
    expect((await configOf({ env: { ALLOW_SIGNUPS: "true" } }, true)).signups).toBe("open");
    expect((await configOf({ env: { ALLOW_SIGNUPS: "invite-only" } }, true)).signups).toBe(
      "invite-only",
    );
    expect((await configOf({ env: { ALLOW_SIGNUPS: "false" } }, true)).signups).toBe("closed");
  });

  it("is open on a fresh instance whatever ALLOW_SIGNUPS says, because the first account is always allowed", async () => {
    expect((await configOf({ env: { ALLOW_SIGNUPS: "false" } })).signups).toBe("open");
    expect((await configOf({ env: { ALLOW_SIGNUPS: "invite-only" } })).signups).toBe("open");
  });

  it("needs no session", async () => {
    const h = await startHarness();
    try {
      expect((await h.as(null).get("/config")).statusCode).toBe(200);
    } finally {
      await h.close();
    }
  });
});
