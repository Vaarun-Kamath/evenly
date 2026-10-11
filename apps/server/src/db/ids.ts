import { v7 as uuidv7 } from "uuid";

/** A new time-ordered identifier (UUIDv7), generated in the application (ARCHITECTURE.md section 4). */
export function newId(): string {
  return uuidv7();
}
