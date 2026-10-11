const SEGMENT = /^[A-Za-z0-9._~-]+$/;

/**
 * Normalises a URL path to the form used everywhere in the server: no trailing slash, and the
 * empty string for the site root. Rejects anything that is not a plain, safe path, because the
 * value is later written into HTML (see spa.ts).
 */
export function normalizeBasePath(input: string): string {
  const segments = input.split("/").filter((segment) => segment !== "");
  for (const segment of segments) {
    if (segment === "." || segment === ".." || !SEGMENT.test(segment)) {
      throw new Error(
        `"${input}" is not a valid base path: segments may only contain letters, digits and . _ ~ -`,
      );
    }
  }
  return segments.length === 0 ? "" : `/${segments.join("/")}`;
}

/**
 * The base path comes from the path of `PUBLIC_URL` (ADR-0002). `BASE_PATH` is optional and only
 * double-checks it: if both are given they must agree.
 */
export function deriveBasePath(publicUrl: string, explicit?: string): string {
  const url = new URL(publicUrl);
  const derived = normalizeBasePath(url.pathname);
  if (explicit !== undefined && explicit !== "") {
    const given = normalizeBasePath(explicit);
    if (given !== derived) {
      throw new Error(
        `BASE_PATH ("${explicit}") does not match the path of PUBLIC_URL ("${url.pathname}"). ` +
          "Remove BASE_PATH, or make them agree.",
      );
    }
  }
  return derived;
}
