import { createTransport } from "nodemailer";
import type { Env } from "../env";

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

/** Sends email. Only exists when SMTP is configured; features that need email check for it. */
export interface Mailer {
  send(mail: Mail): Promise<void>;
}

/** Builds the SMTP mailer from `SMTP_URL` and `SMTP_FROM`, or returns undefined when email is off. */
export function createMailer(env: Pick<Env, "SMTP_URL" | "SMTP_FROM">): Mailer | undefined {
  const { SMTP_URL: url, SMTP_FROM: from } = env;
  if (url === undefined || from === undefined) return undefined;
  const transport = createTransport(url);
  return {
    async send(mail) {
      await transport.sendMail({ from, ...mail });
    },
  };
}
