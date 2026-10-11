import { z } from "zod";
import { ProblemError } from "../../http/problem";

const dateCursorSchema = z.object({ d: z.iso.date(), i: z.uuid() });
export interface DateCursor {
  date: string;
  id: string;
}

/** A page position for lists ordered by date and id, as an opaque string for clients. */
export function encodeDateCursor(cursor: DateCursor): string {
  return Buffer.from(JSON.stringify({ d: cursor.date, i: cursor.id })).toString("base64url");
}

export function decodeDateCursor(value: string): DateCursor {
  try {
    const parsed = dateCursorSchema.parse(
      JSON.parse(Buffer.from(value, "base64url").toString("utf8")),
    );
    return { date: parsed.d, id: parsed.i };
  } catch {
    throw new ProblemError(400, "invalid-cursor", "That cursor is not valid.");
  }
}
