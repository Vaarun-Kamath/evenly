import { problemSchema } from "@evenly/contracts";
import type { z } from "zod";
import { readBasePath, withBasePath } from "./basePath";

export const basePath = readBasePath(document);

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** GET `/api/v1<path>` under the runtime base path, validating the response with a contract schema. */
export async function apiGet<S extends z.ZodType>(path: string, schema: S): Promise<z.output<S>> {
  const response = await fetch(withBasePath(basePath, `/api/v1${path}`), {
    headers: { accept: "application/json" },
    credentials: "same-origin",
  });
  if (!response.ok) {
    const problem = problemSchema.safeParse(await response.json().catch(() => null));
    throw new ApiError(
      response.status,
      problem.success ? (problem.data.detail ?? problem.data.title) : response.statusText,
    );
  }
  return schema.parse(await response.json());
}
