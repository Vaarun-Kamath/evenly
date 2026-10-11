// Takes the README screenshots (docs/screenshots/*.png) from a running, empty Evenly instance:
//   APP_PORT=3300 docker compose -p evenly-shots up -d --build --wait
//   SHOTS_URL=http://localhost:3300 node e2e/screenshots/capture.mjs
// It signs up a demo person, fills a small trip with the API, and photographs the screens on a phone-sized screen.
/* global document, window -- used inside page.evaluate, which runs in the browser */
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const base = (process.env.SHOTS_URL ?? "http://localhost:3000").replace(/\/$/, "");
const origin = new URL(base).origin;
const out = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "docs", "screenshots");
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  baseURL: `${base}/`,
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  locale: "en-IN",
  timezoneId: "Asia/Kolkata",
});
const request = context.request;
const api = async (method, path, data) => {
  const response = await request.fetch(`api/v1/${path}`, {
    method,
    headers: { origin },
    ...(data !== undefined && { data }),
  });
  if (!response.ok())
    throw new Error(`${method} ${path}: ${response.status()} ${await response.text()}`);
  return response.status() === 204 ? undefined : await response.json();
};

const signup = await request.post("api/auth/sign-up/email", {
  headers: { origin },
  data: { name: "Asha Rao", email: "asha@example.com", password: "correct horse battery staple" },
});
if (!signup.ok()) throw new Error(`sign-up: ${signup.status()} ${await signup.text()}`);

const group = await api("POST", "groups", { name: "Goa Trip", emoji: "🏖️", currency: "INR" });
const asha = (await api("GET", `groups/${group.id}/members`)).find((m) => m.isYou);
const bob = await api("POST", `groups/${group.id}/members`, { displayName: "Bob" });
const cara = await api("POST", `groups/${group.id}/members`, { displayName: "Cara" });
const everyone = [asha, bob, cara].map((m) => ({ memberId: m.id }));
const expense = (body) =>
  api("POST", `groups/${group.id}/expenses`, {
    id: randomUUID(),
    currency: "INR",
    notes: null,
    ...body,
  });

await expense({
  description: "Dinner at the beach shack",
  amountMinor: 100000,
  category: "food",
  expenseDate: "2026-10-09",
  payers: [{ memberId: asha.id, amountMinor: 100000 }],
  split: { method: "equal", entries: everyone },
});
await expense({
  description: "Cab to the airport",
  amountMinor: 60000,
  category: "transport",
  expenseDate: "2026-10-10",
  payers: [{ memberId: bob.id, amountMinor: 60000 }],
  split: {
    method: "shares",
    entries: [
      { memberId: asha.id, value: "1" },
      { memberId: bob.id, value: "1" },
      { memberId: cara.id, value: "2" },
    ],
  },
});
await expense({
  description: "Scooter rental",
  amountMinor: 45050,
  category: "travel",
  expenseDate: "2026-10-10",
  payers: [{ memberId: cara.id, amountMinor: 45050 }],
  split: {
    method: "percent",
    entries: [
      { memberId: asha.id, value: "50" },
      { memberId: bob.id, value: "30" },
      { memberId: cara.id, value: "20" },
    ],
  },
});
await api("POST", `groups/${group.id}/settlements`, {
  id: randomUUID(),
  fromMemberId: cara.id,
  toMemberId: bob.id,
  amountMinor: 5000,
  currency: "INR",
  settledOn: "2026-10-11",
  note: "UPI",
});

const page = await context.newPage();

async function shoot(name, colorScheme, prepare) {
  await page.emulateMedia({ colorScheme });
  await prepare();
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(out, `${name}.png`) });
  console.log(`wrote docs/screenshots/${name}.png`);
}

await shoot("group", "light", async () => {
  await page.goto(`g/${group.id}`);
  await page.getByText("Dinner at the beach shack").waitFor();
});

await shoot("add-expense", "light", async () => {
  await page.goto(`g/${group.id}/expenses/new`);
  await page.getByLabel("What was it for?").fill("Snorkelling trip");
  await page.getByLabel("Amount (INR)").fill("1200");
  await page.locator("label", { hasText: /^Shares$/ }).click();
  await page.getByRole("textbox", { name: /^Cara:/ }).fill("2");
  await page.getByLabel("Asha Rao's share").waitFor();
  await page.getByText("Split between").evaluate((el) => el.scrollIntoView({ block: "start" }));
  await page.evaluate(() => window.scrollBy(0, -24));
});

await shoot("settle-up", "light", async () => {
  await page.goto(`g/${group.id}/settle`);
  await page
    .getByRole("button", { name: /^Record payment:/ })
    .first()
    .waitFor();
});

await shoot("group-dark", "dark", async () => {
  await page.goto(`g/${group.id}`);
  await page.getByText("Dinner at the beach shack").waitFor();
});

await browser.close();
