/**
 * An error that services throw to answer with a specific problem+json response. `code` becomes the
 * problem `type` (`urn:evenly:problem:<code>`).
 */
export class ProblemError extends Error {
  override name = "ProblemError";

  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

/** The one answer for "no such group, or you are not in it": group ids must not be probeable. */
export const notFound = () => new ProblemError(404, "not-found", "Not found.");
export const forbidden = (message: string) => new ProblemError(403, "forbidden", message);
export const conflict = (code: string, message: string) => new ProblemError(409, code, message);
export const gone = (code: string, message: string) => new ProblemError(410, code, message);
