import { problemSchema, type Problem } from "@evenly/contracts";
import type { z } from "zod";
import { readBasePath, withBasePath } from "./basePath";

export const basePath = readBasePath(document);

/** A problem+json body, possibly with extra members such as `current` (a version conflict). */
export type ProblemBody = Problem & Record<string, unknown>;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly problem: ProblemBody | null,
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** The `urn:evenly:problem:<code>` code, such as `version-conflict`. */
  get code(): string | undefined {
    return this.problem?.type.replace("urn:evenly:problem:", "");
  }
}

export class NetworkError extends Error {
  constructor() {
    super("Could not reach the server. Check your connection and try again.");
    this.name = "NetworkError";
  }
}

/** Tells the app that a request was refused because the session ended. */
export const UNAUTHENTICATED_EVENT = "evenly:unauthenticated";

async function problemOf(
  response: Response,
): Promise<{ message: string; problem: ProblemBody | null }> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Not JSON.
  }
  const problem = problemSchema.safeParse(body);
  if (problem.success) {
    return {
      problem: body as ProblemBody,
      message: problem.data.detail ?? problem.data.title,
    };
  }
  // The auth library answers with { message, code } instead of problem+json.
  const message =
    typeof body === "object" &&
    body !== null &&
    "message" in body &&
    typeof body.message === "string"
      ? body.message
      : response.statusText || `Request failed (${String(response.status)})`;
  return { message, problem: null };
}

/**
 * Calls the API under the runtime base path. `path` starts with `/api/`. A response with a schema is
 * validated against it; errors come back as {@link ApiError} (or {@link NetworkError} offline).
 */
export async function api<S extends z.ZodType | undefined = undefined>(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  options: { body?: unknown; schema?: S; headers?: Record<string, string> } = {},
): Promise<S extends z.ZodType ? z.output<S> : undefined> {
  let response: Response;
  try {
    response = await fetch(withBasePath(basePath, path), {
      method,
      credentials: "same-origin",
      headers: {
        accept: "application/json",
        ...(options.body !== undefined && { "content-type": "application/json" }),
        ...options.headers,
      },
      ...(options.body !== undefined && { body: JSON.stringify(options.body) }),
    });
  } catch {
    throw new NetworkError();
  }

  if (!response.ok) {
    const { message, problem } = await problemOf(response);
    if (response.status === 401 && !path.startsWith("/api/auth/")) {
      window.dispatchEvent(new Event(UNAUTHENTICATED_EVENT));
    }
    throw new ApiError(response.status, message, problem);
  }
  if (response.status === 204 || options.schema === undefined) {
    return undefined as S extends z.ZodType ? z.output<S> : undefined;
  }
  return options.schema.parse(await response.json()) as S extends z.ZodType
    ? z.output<S>
    : undefined;
}

/** A message for a person, whatever went wrong. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError || error instanceof NetworkError) return error.message;
  return "Something went wrong. Please try again.";
}
