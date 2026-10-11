import { createHash, randomBytes } from "node:crypto";

const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** sha256 of the token's 32 raw bytes: all that is stored, so a database leak reveals no live link. */
export function hashInviteToken(token: string): Buffer {
  return createHash("sha256").update(Buffer.from(token, "base64url")).digest();
}

/** 32 random bytes, base64url in the link. */
export function newInviteToken(): { token: string; hash: Buffer } {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  return { token, hash: hashInviteToken(token) };
}

/** Rejects anything that cannot be a token before it reaches the database. */
export function isWellFormedToken(token: string): boolean {
  return TOKEN_PATTERN.test(token);
}
