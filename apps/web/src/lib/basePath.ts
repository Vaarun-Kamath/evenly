/**
 * The server injects `<meta name="evenly-base-path" content="/evenly">` into index.html at request
 * time (ADR-0002, ADR-0005). It is the empty string at the site root and also in `vite dev`.
 */
export function readBasePath(doc: {
  querySelector(selector: string): { getAttribute(name: string): string | null } | null;
}): string {
  const content = doc.querySelector('meta[name="evenly-base-path"]')?.getAttribute("content") ?? "";
  const trimmed = content.replace(/\/+$/, "");
  return trimmed === "" || trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

/** Prefixes an app-relative path (starting with `/`) with the base path. */
export function withBasePath(basePath: string, path: string): string {
  return `${basePath}${path.startsWith("/") ? path : `/${path}`}`;
}
