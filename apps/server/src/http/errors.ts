import { STATUS_CODES } from "node:http";
import { hasZodFastifySchemaValidationErrors } from "@fastify/type-provider-zod";
import type { Problem } from "@evenly/contracts";
import type { FastifyInstance, FastifyReply } from "fastify";
import { CoreError } from "@evenly/core";
import { ProblemError } from "./problem";

interface ProblemOptions {
  type?: string;
  detail?: string;
  errors?: Problem["errors"];
  /** Extra members of the problem body. */
  extensions?: Record<string, unknown>;
}

/** Sends an RFC 9457 `application/problem+json` response. */
export function sendProblem(reply: FastifyReply, status: number, options: ProblemOptions = {}) {
  const body: Problem & Record<string, unknown> = {
    ...options.extensions,
    type: options.type ?? "about:blank",
    title: STATUS_CODES[status] ?? "Error",
    status,
    ...(options.detail !== undefined && { detail: options.detail }),
    ...(options.errors !== undefined && { errors: options.errors }),
  };
  return reply.code(status).type("application/problem+json").send(body);
}

/** Fastify attaches `statusCode` to the errors it raises (bad JSON, payload too large, ...). */
function statusOf(error: unknown): number {
  if (
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    typeof error.statusCode === "number" &&
    error.statusCode >= 400 &&
    error.statusCode <= 599
  ) {
    return error.statusCode;
  }
  return 500;
}

export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ProblemError) {
      return sendProblem(reply, error.status, {
        type: `urn:evenly:problem:${error.code}`,
        detail: error.message,
        ...(error.extensions !== undefined && { extensions: error.extensions }),
      });
    }
    if (error instanceof CoreError) {
      // The money rules of @evenly/core (a split that does not add up, an unknown member, ...).
      return sendProblem(reply, 422, {
        type: `urn:evenly:problem:${error.code.toLowerCase().replaceAll("_", "-")}`,
        detail: error.message,
        extensions: { code: error.code },
      });
    }
    if (hasZodFastifySchemaValidationErrors(error)) {
      return sendProblem(reply, 400, {
        type: "urn:evenly:problem:validation",
        detail: "The request did not pass validation.",
        errors: error.validation.map((issue) => ({
          path: issue.instancePath,
          message: issue.message ?? "invalid",
        })),
      });
    }
    const status = statusOf(error);
    if (status >= 500) {
      request.log.error({ err: error }, "unhandled error");
      return sendProblem(reply, 500);
    }
    return sendProblem(reply, status, {
      ...(error instanceof Error && { detail: error.message }),
    });
  });
}
