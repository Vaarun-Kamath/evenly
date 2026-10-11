import { z } from "zod";

/** Response of `GET /api/v1/ping`. */
export const pingResponseSchema = z.object({
  status: z.literal("ok"),
  name: z.literal("evenly"),
});
export type PingResponse = z.infer<typeof pingResponseSchema>;

/** Response of `GET /healthz` and `GET /readyz`. */
export const probeResponseSchema = z.object({
  status: z.enum(["ok", "ready", "unavailable"]),
});
export type ProbeResponse = z.infer<typeof probeResponseSchema>;
