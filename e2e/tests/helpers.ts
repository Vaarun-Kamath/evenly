import type { Balances, Expense, Member } from "@evenly/contracts";
import {
  expect,
  type APIResponse,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { baseURL, origin } from "./env";

export const PASSWORD = "correct horse battery staple";

/** Makes the e-mail addresses unique, so the suite can run again against the same database. */
const runId = Math.random().toString(36).slice(2, 8);

/** One person, in their own browser context (their own cookies), as in real life. */
export interface User {
  readonly name: string;
  readonly email: string;
  readonly context: BrowserContext;
  readonly page: Page;
}

export async function newUser(browser: Browser, name: string): Promise<User> {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  return { name, email: `${name.toLowerCase()}-${runId}@example.com`, context, page };
}

/** Fills the sign-up form that is showing, and waits for the dashboard. */
export async function submitSignUp(user: User): Promise<void> {
  const { page } = user;
  await page.getByLabel("Your name").fill(user.name);
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
}

export async function signUp(user: User): Promise<void> {
  await user.page.goto("signup");
  await submitSignUp(user);
  await expect(user.page.getByRole("heading", { name: "Your groups" })).toBeVisible();
}

export function groupIdOf(url: string): string {
  const match = /\/g\/([^/?#]+)/.exec(url);
  if (match?.[1] === undefined) throw new Error(`no group id in ${url}`);
  return match[1];
}

/** Calls the JSON API as a person. Writes carry an Origin header, as a browser's would. */
export function apiAs(user: User) {
  const call = (method: string, path: string, body?: unknown): Promise<APIResponse> =>
    user.context.request.fetch(`api/v1/${path}`, {
      method,
      headers: { origin },
      ...(body !== undefined && { data: body }),
    });
  const json = async <T>(path: string): Promise<T> => {
    const response = await call("GET", path);
    expect(response.status(), `GET ${path}`).toBe(200);
    return (await response.json()) as T;
  };
  return {
    call,
    members: (gid: string) => json<Member[]>(`groups/${gid}/members`),
    balances: (gid: string) => json<Balances>(`groups/${gid}/balances`),
    expenses: async (gid: string) =>
      (await json<{ items: Expense[] }>(`groups/${gid}/expenses`)).items,
  };
}

/** Net balances by member id, in minor units. */
export function netsOf(balances: Balances): Map<string, number> {
  return new Map(balances.nets.map((n) => [n.memberId, n.net.amountMinor]));
}

/** Reads CSV (RFC 4180) into rows of cells. Blank lines are dropped. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        cell += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\r" || c === "\n") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else {
      cell += c;
    }
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** "-333.33" → -33333 (every currency in these tests has two decimals). */
export function toMinor(decimal: string): number {
  return Math.round(Number(decimal) * 100);
}

/** The export starts with a byte order mark, for Excel; a CSV reader here does not want it. */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
