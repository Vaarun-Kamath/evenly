import { pingResponseSchema, problemSchema } from "@evenly/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeApp, makeStaticDir } from "./helpers";

let staticDir: string;
beforeAll(async () => {
  staticDir = await makeStaticDir();
});

const MOUNTS = [
  { name: "site root", publicUrl: "http://localhost:3000", base: "" },
  { name: "/evenly", publicUrl: "https://example.com/evenly", base: "/evenly" },
];

describe.each(MOUNTS)("mounted at $name", ({ publicUrl, base }) => {
  let app: Awaited<ReturnType<typeof makeApp>>;
  beforeAll(async () => {
    app = await makeApp({ publicUrl, staticDir });
  });
  afterAll(async () => {
    await app.close();
  });

  it("answers /healthz", async () => {
    const res = await app.inject({ url: `${base}/healthz` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
    expect(res.headers["x-request-id"]).toBeTruthy();
  });

  it("answers /readyz when the database is reachable", async () => {
    const res = await app.inject({ url: `${base}/readyz` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ready" });
  });

  it("serves the ping endpoint with the shared contract", async () => {
    const res = await app.inject({ url: `${base}/api/v1/ping` });
    expect(res.statusCode).toBe(200);
    expect(pingResponseSchema.parse(res.json())).toEqual({ status: "ok", name: "evenly" });
  });

  it("serves index.html with the base path injected", async () => {
    const res = await app.inject({ url: `${base}/` });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.headers["cache-control"]).toBe("no-cache");
    expect(res.body).toContain(`<base href="${base}/">`);
    expect(res.body).toContain(`<meta name="evenly-base-path" content="${base}">`);
    // <base> must come before the script that uses a relative URL.
    expect(res.body.indexOf("<base")).toBeLessThan(res.body.indexOf("<script"));
  });

  it("serves a deep client route with the same injection (reload on a nested URL)", async () => {
    const res = await app.inject({ url: `${base}/g/0192f0c4/expenses/new?x=1` });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain(`<base href="${base}/">`);
  });

  it("serves hashed assets as immutable and other files as no-cache", async () => {
    const asset = await app.inject({ url: `${base}/assets/app-abc123.js` });
    expect(asset.statusCode).toBe(200);
    expect(asset.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    const icon = await app.inject({ url: `${base}/favicon.svg` });
    expect(icon.statusCode).toBe(200);
    expect(icon.headers["cache-control"]).toBe("no-cache");
  });

  it("returns a real 404 problem for a missing file", async () => {
    const res = await app.inject({ url: `${base}/assets/missing.js` });
    expect(res.statusCode).toBe(404);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    expect(problemSchema.parse(res.json())).toMatchObject({ status: 404, title: "Not Found" });
  });

  it("returns a 404 problem for an unknown API route instead of the SPA", async () => {
    const res = await app.inject({ url: `${base}/api/v1/nope` });
    expect(res.statusCode).toBe(404);
    expect(res.headers["content-type"]).toContain("application/problem+json");
  });

  it("sends security headers without upgrade-insecure-requests", async () => {
    const res = await app.inject({ url: `${base}/` });
    const csp = String(res.headers["content-security-policy"]);
    expect(csp).toContain("default-src 'self'");
    expect(csp).not.toContain("upgrade-insecure-requests");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });
});

describe("mounted at /evenly", () => {
  let app: Awaited<ReturnType<typeof makeApp>>;
  beforeAll(async () => {
    app = await makeApp({ publicUrl: "https://example.com/evenly", staticDir });
  });
  afterAll(async () => {
    await app.close();
  });

  it("serves the app at /evenly without a trailing slash", async () => {
    const res = await app.inject({ url: "/evenly" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<base href="/evenly/">');
  });

  it("does not answer outside the base path", async () => {
    for (const url of ["/healthz", "/api/v1/ping", "/"]) {
      const res = await app.inject({ url });
      expect(res.statusCode, url).toBe(404);
    }
  });
});

describe("database down", () => {
  it("reports 503 on /readyz but keeps /healthz up", async () => {
    const app = await makeApp({ staticDir, dbReachable: false });
    const ready = await app.inject({ url: "/readyz" });
    expect(ready.statusCode).toBe(503);
    expect(ready.json()).toEqual({ status: "unavailable" });
    const health = await app.inject({ url: "/healthz" });
    expect(health.statusCode).toBe(200);
    await app.close();
  });
});

describe("without a built web app", () => {
  it("fails fast when STATIC_DIR points at a missing build", async () => {
    const app = await makeApp({ staticDir: "/definitely/not/here" }).catch(
      (error: unknown) => error,
    );
    // An explicit STATIC_DIR that does not exist is a configuration error, not a silent skip.
    expect(app).toBeInstanceOf(Error);
    expect(String(app)).toContain("Cannot serve the web app");
  });
});
