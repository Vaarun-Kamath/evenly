import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_RATE_LIMITS } from "../../src/auth/auth";
import { startHarness, TEST_PASSWORD, uniqueEmail, type Harness } from "./harness";

/** These tests use the real default limits (ARCHITECTURE.md section 7). */
describe("rate limits", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness({ rateLimits: DEFAULT_RATE_LIMITS, withMailer: true });
  });
  afterAll(async () => {
    await h.close();
  });

  const attempt = (email: string, remoteAddress: string) =>
    h.request({
      method: "POST",
      url: "/api/auth/sign-in/email",
      remoteAddress,
      payload: { email, password: "wrong password here" },
    });

  it("limits sign-in to 10 a minute per client IP", async () => {
    // A different email each time, so only the per-IP limit can trigger.
    const statuses: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      statuses.push((await attempt(uniqueEmail(), "10.0.0.1")).statusCode);
    }
    expect(statuses.slice(0, 10)).toEqual(Array<number>(10).fill(401));
    expect(statuses.slice(10)).toEqual([429, 429]);

    // Another IP is not affected.
    expect((await attempt(uniqueEmail(), "10.0.0.2")).statusCode).toBe(401);
  });

  it("limits sign-in to 10 a minute per account, whatever the IP", async () => {
    const email = uniqueEmail();
    const statuses: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      // Each attempt comes from a new IP, so only the per-account limit can trigger.
      statuses.push((await attempt(email, `10.1.0.${String(i + 1)}`)).statusCode);
    }
    expect(statuses.slice(0, 10)).toEqual(Array<number>(10).fill(401));
    expect(statuses.slice(10)).toEqual([429, 429]);

    // The account limit does not lock out other accounts from the same address.
    expect((await attempt(uniqueEmail(), "10.1.0.1")).statusCode).toBe(401);
  });

  it("limits sign-up to 5 a minute per client IP", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 7; i += 1) {
      const response = await h.request({
        method: "POST",
        url: "/api/auth/sign-up/email",
        remoteAddress: "10.2.0.1",
        payload: { email: uniqueEmail(), name: "New Person", password: TEST_PASSWORD },
      });
      statuses.push(response.statusCode);
    }
    expect(statuses.slice(0, 5)).toEqual(Array<number>(5).fill(200));
    expect(statuses.slice(5)).toEqual([429, 429]);
  });

  it("limits password reset requests to 3 an hour per account", async () => {
    const { email } = await h.signUp({ email: uniqueEmail() });
    h.mail.length = 0;
    const statuses: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const response = await h.request({
        method: "POST",
        url: "/api/auth/request-password-reset",
        remoteAddress: `10.3.0.${String(i + 1)}`,
        payload: { email, redirectTo: "/reset" },
      });
      statuses.push(response.statusCode);
    }
    expect(statuses.slice(0, 3)).toEqual([200, 200, 200]);
    expect(statuses.slice(3)).toEqual([429, 429]);
    await expect.poll(() => h.mail.length).toBe(3);
  });

  it("does not trust X-Forwarded-For from a client", async () => {
    // Every request comes from 10.4.0.1, but claims a different address in X-Forwarded-For.
    const statuses: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      const response = await h.request({
        method: "POST",
        url: "/api/auth/sign-in/email",
        remoteAddress: "10.4.0.1",
        headers: { "x-forwarded-for": `203.0.113.${String(i + 1)}` },
        payload: { email: uniqueEmail(), password: "wrong password here" },
      });
      statuses.push(response.statusCode);
    }
    expect(statuses.slice(10)).toEqual([429, 429]);
  });
});
