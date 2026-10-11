const raw = process.env.E2E_BASE_URL ?? "http://localhost:3000";

/**
 * Where the app under test lives: the site root (`http://localhost:3000`) or a sub-path
 * (`http://localhost:3000/evenly`). The trailing slash matters: relative URLs such as `"login"`
 * resolve under it, so the same tests run at both.
 */
export const baseURL = raw.endsWith("/") ? raw : `${raw}/`;

export const origin = new URL(baseURL).origin;

/** `""` at the site root, `"/evenly"` under a sub-path. */
export const basePath = new URL(baseURL).pathname.replace(/\/$/, "");
