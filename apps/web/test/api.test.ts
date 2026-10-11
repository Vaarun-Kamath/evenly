import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiError, NetworkError, UNAUTHENTICATED_EVENT, api, errorMessage } from "../src/lib/api";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const problem = (code: string, status: number, extra: object = {}) =>
  json(
    {
      type: `urn:evenly:problem:${code}`,
      title: "Nope",
      status,
      detail: "Something specific.",
      ...extra,
    },
    status,
  );

function stubFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const fetchMock = vi.fn((url: string, init: RequestInit) => Promise.resolve(handler(url, init)));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("api", () => {
  it("sends JSON with the session cookie and validates the answer against the schema", async () => {
    const fetchMock = stubFetch(() => json({ id: "g1" }));
    const result = await api("POST", "/api/v1/groups", {
      body: { name: "Trip" },
      schema: z.object({ id: z.string() }),
    });
    expect(result).toEqual({ id: "g1" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/groups");
    expect(init).toMatchObject({
      method: "POST",
      credentials: "same-origin",
      body: '{"name":"Trip"}',
    });
    expect(init.headers).toMatchObject({
      accept: "application/json",
      "content-type": "application/json",
    });
  });

  it("does not claim a content type when there is no body", async () => {
    const fetchMock = stubFetch(() => new Response(null, { status: 204 }));
    expect(await api("DELETE", "/api/v1/groups/g1")).toBeUndefined();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.headers).not.toHaveProperty("content-type");
  });

  it("rejects an answer that does not match the schema", async () => {
    stubFetch(() => json({ id: 7 }));
    await expect(api("GET", "/api/v1/x", { schema: z.object({ id: z.string() }) })).rejects.toThrow(
      z.ZodError,
    );
  });

  it("turns problem+json into an ApiError with its code and extra members", async () => {
    stubFetch(() => problem("version-conflict", 409, { current: { version: 4 } }));
    const error = await api("PATCH", "/api/v1/x", { body: {} }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.status).toBe(409);
    expect(apiError.code).toBe("version-conflict");
    expect(apiError.message).toBe("Something specific.");
    expect(apiError.problem?.current).toEqual({ version: 4 });
  });

  it("reads the auth library's own error shape", async () => {
    stubFetch(() => json({ message: "Invalid email or password", code: "INVALID" }, 401));
    const error = (await api("POST", "/api/auth/sign-in/email", { body: {} }).catch(
      (e: unknown) => e,
    )) as ApiError;
    expect(error.message).toBe("Invalid email or password");
    expect(error.code).toBeUndefined();
  });

  it("falls back to the status text when the body is not JSON", async () => {
    stubFetch(() => new Response("<html>", { status: 502, statusText: "Bad Gateway" }));
    const error = (await api("GET", "/api/v1/x").catch((e: unknown) => e)) as ApiError;
    expect(error.message).toBe("Bad Gateway");
  });

  it("announces a lost session, except while signing in", async () => {
    const heard = vi.fn();
    window.addEventListener(UNAUTHENTICATED_EVENT, heard);
    try {
      stubFetch(() => problem("unauthenticated", 401));
      await api("GET", "/api/v1/me").catch(() => undefined);
      expect(heard).toHaveBeenCalledTimes(1);

      await api("POST", "/api/auth/sign-in/email", { body: {} }).catch(() => undefined);
      expect(heard).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(UNAUTHENTICATED_EVENT, heard);
    }
  });

  it("reports a network failure as a NetworkError", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("Failed to fetch")));
    await expect(api("GET", "/api/v1/me")).rejects.toBeInstanceOf(NetworkError);
  });
});

describe("errorMessage", () => {
  it("shows the message of errors meant for people, and a generic one for anything else", () => {
    expect(errorMessage(new ApiError(422, "Amount too large.", null))).toBe("Amount too large.");
    expect(errorMessage(new NetworkError())).toMatch(/Could not reach the server/);
    expect(errorMessage(new Error("TypeError: x is undefined"))).toBe(
      "Something went wrong. Please try again.",
    );
  });
});
