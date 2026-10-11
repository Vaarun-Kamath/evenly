import { api, basePath } from "./api";

/** Calls to the auth library under `/api/auth` (ADR-0007). They set or clear the session cookie. */
export const auth = {
  signUp(input: { name: string; email: string; password: string; inviteToken?: string }) {
    const { inviteToken, ...body } = input;
    return api("POST", "/api/auth/sign-up/email", {
      body,
      // On an invite-only instance the invitation link is what allows the sign-up.
      ...(inviteToken !== undefined && { headers: { "x-evenly-invite": inviteToken } }),
    });
  },

  signIn(input: { email: string; password: string }) {
    return api("POST", "/api/auth/sign-in/email", { body: input });
  },

  signOut() {
    return api("POST", "/api/auth/sign-out", { body: {} });
  },

  /** Ends every session on every device, this one included. */
  signOutEverywhere() {
    return api("POST", "/api/auth/revoke-sessions", { body: {} });
  },

  requestPasswordReset(email: string) {
    return api("POST", "/api/auth/request-password-reset", {
      body: { email, redirectTo: `${window.location.origin}${basePath}/reset` },
    });
  },

  resetPassword(input: { token: string; newPassword: string }) {
    return api("POST", "/api/auth/reset-password", { body: input });
  },

  changePassword(input: { currentPassword: string; newPassword: string }) {
    return api("POST", "/api/auth/change-password", {
      body: { ...input, revokeOtherSessions: true },
    });
  },
};

/** Only paths inside the app are allowed as a place to go after signing in (no open redirects). */
export function safeNext(next: unknown): string | undefined {
  return typeof next === "string" && next.startsWith("/") && !next.startsWith("//")
    ? next
    : undefined;
}
