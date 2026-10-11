import { describe, expect, it } from "vitest";
import { EnvError, loadEnv } from "../src/env";

const base = { DATABASE_URL: "postgres://lib001:lib001@db:5432/lib001" };

describe("loadEnv", () => {
  it("applies defaults", () => {
    const env = loadEnv(base);
    expect(env).toMatchObject({
      PORT: 3000,
      HOST: "0.0.0.0",
      LOG_LEVEL: "info",
      PUBLIC_URL: "http://localhost:3000",
      TRUST_PROXY: false,
      basePath: "",
      publicOrigin: "http://localhost:3000",
    });
  });

  it("derives basePath and origin from PUBLIC_URL", () => {
    const env = loadEnv({ ...base, PUBLIC_URL: "https://example.com/evenly" });
    expect(env.basePath).toBe("/evenly");
    expect(env.publicOrigin).toBe("https://example.com");
  });

  it("treats empty strings as unset", () => {
    const env = loadEnv({ ...base, PORT: "", BASE_PATH: "", SESSION_SECRET: "" });
    expect(env.PORT).toBe(3000);
    expect(env.SESSION_SECRET).toBeUndefined();
  });

  it("requires DATABASE_URL", () => {
    expect(() => loadEnv({})).toThrow(EnvError);
    expect(() => loadEnv({})).toThrow(/DATABASE_URL/);
  });

  it("rejects a non-postgres DATABASE_URL", () => {
    expect(() => loadEnv({ DATABASE_URL: "mysql://u:p@h/db" })).toThrow(/DATABASE_URL/);
  });

  it("rejects an invalid PORT and PUBLIC_URL", () => {
    expect(() => loadEnv({ ...base, PORT: "99999" })).toThrow(/PORT/);
    expect(() => loadEnv({ ...base, PUBLIC_URL: "ftp://example.com" })).toThrow(/PUBLIC_URL/);
  });

  it("rejects a BASE_PATH that disagrees with PUBLIC_URL", () => {
    expect(() =>
      loadEnv({ ...base, PUBLIC_URL: "https://example.com/evenly", BASE_PATH: "/x" }),
    ).toThrow(/does not match/);
  });

  it("rejects a short SESSION_SECRET", () => {
    expect(() => loadEnv({ ...base, SESSION_SECRET: "short" })).toThrow(/SESSION_SECRET/);
    expect(loadEnv({ ...base, SESSION_SECRET: "x".repeat(32) }).SESSION_SECRET).toHaveLength(32);
  });

  describe("TRUST_PROXY", () => {
    it.each([
      ["false", false],
      ["true", true],
      ["2", 2],
      ["10.0.0.0/8", ["10.0.0.0/8"]],
      ["10.0.0.1, 192.168.0.0/16", ["10.0.0.1", "192.168.0.0/16"]],
      ["loopback", ["loopback"]],
      ["::1, fd00::/8", ["::1", "fd00::/8"]],
    ])("parses %j", (value, expected) => {
      expect(loadEnv({ ...base, TRUST_PROXY: value }).TRUST_PROXY).toEqual(expected);
    });

    it.each(["yes", "10.0.0.0/40", "300.1.1.1", "1.2.3.4/8/9", ","])("rejects %j", (value) => {
      expect(() => loadEnv({ ...base, TRUST_PROXY: value })).toThrow(/TRUST_PROXY/);
    });
  });
});
