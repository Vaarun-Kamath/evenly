import { z } from "zod";

/** RFC 9457 `application/problem+json` body used for every API error. */
export const problemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int().min(400).max(599),
  detail: z.string().optional(),
  errors: z
    .array(
      z.object({
        path: z.string(),
        message: z.string(),
      }),
    )
    .optional(),
});
export type Problem = z.infer<typeof problemSchema>;

/** The 409 answer to an edit that started from an old version: the problem, plus the current row. */
export const versionConflictSchema = problemSchema.extend({ current: z.unknown() });
