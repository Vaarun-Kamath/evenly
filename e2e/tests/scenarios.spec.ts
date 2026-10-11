import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { basePath, origin } from "./env";
import {
  apiAs,
  groupIdOf,
  netsOf,
  newUser,
  parseCsv,
  stripBom,
  signUp,
  submitSignUp,
  toMinor,
  type User,
} from "./helpers";

/**
 * SPEC.md section 7, end to end, against the built image. The scenarios build on each other (one
 * group, three people, a few expenses), so they run in order and stop at the first failure.
 */
test.describe.serial(`acceptance scenarios (base path "${basePath}")`, () => {
  let asha: User;
  let bob: User;
  let cara: User;
  let dave: User;
  let gid = "";
  const member: Record<"asha" | "bob" | "cara", string> = { asha: "", bob: "", cara: "" };

  test.beforeAll(async ({ browser }) => {
    [asha, bob, cara, dave] = (await Promise.all(
      ["Asha", "Bob", "Cara", "Dave"].map((name) => newUser(browser, name)),
    )) as [User, User, User, User];
  });

  test.afterAll(async () => {
    await Promise.all([asha, bob, cara, dave].map((user) => user?.context.close()));
  });

  /** Opens the invitation dialog's link and closes the dialog. */
  async function readInviteLink(page: Page): Promise<string> {
    const link = await page.getByRole("textbox", { name: "Invitation link" }).inputValue();
    await page.getByRole("button", { name: "Done" }).click();
    return link;
  }

  async function addExpense(
    page: Page,
    expense: {
      description: string;
      amount: string;
      method?: "Shares";
      shares?: Record<string, string>;
    },
  ) {
    await page.goto(`g/${gid}/expenses/new`);
    await page.getByLabel("What was it for?").fill(expense.description);
    await page.getByLabel("Amount (INR)").fill(expense.amount);
    if (expense.method !== undefined) {
      await page.locator("label", { hasText: new RegExp(`^${expense.method}$`) }).click();
      for (const [name, value] of Object.entries(expense.shares ?? {})) {
        await page.getByRole("textbox", { name: new RegExp(`^${name}:`) }).fill(value);
      }
    }
  }

  test("1. A signs up, creates Goa Trip, invites B with a link, and B joins through it", async () => {
    await signUp(asha);
    await asha.page.getByRole("link", { name: "New group" }).first().click();
    await asha.page.getByLabel("Group name").fill("Goa Trip");
    await asha.page.getByLabel("Currency").selectOption("INR");
    await asha.page.getByRole("button", { name: "Create group" }).click();
    await expect(asha.page.getByRole("heading", { level: 1, name: /Goa Trip/ })).toBeVisible();
    gid = groupIdOf(asha.page.url());

    await asha.page.goto(`g/${gid}/settings`);
    await asha.page.getByRole("button", { name: "Create invitation link" }).click();
    const link = await readInviteLink(asha.page);
    expect(link).toContain(`${origin}${basePath}/invite/`);

    await bob.page.goto(link);
    await expect(bob.page.getByRole("heading", { name: /Goa Trip/ })).toBeVisible();
    await bob.page.getByRole("link", { name: "Create an account" }).click();
    await submitSignUp(bob);
    await bob.page.getByRole("button", { name: "Join group" }).click();
    await expect(bob.page).toHaveURL(new RegExp(`/g/${gid}$`));
    await expect(bob.page.getByRole("heading", { level: 1, name: /Goa Trip/ })).toBeVisible();
  });

  test("2. A adds placeholder C, and a ₹1,000 dinner splits as 333.34 / 333.33 / 333.33", async () => {
    await asha.page.goto(`g/${gid}/settings`);
    const form = asha.page.locator("form", {
      hasText: "Add someone who does not have an account yet",
    });
    await form.getByLabel("Name").fill("Cara");
    await form.getByRole("button", { name: "Add person" }).click();
    await expect(asha.page.getByText(/Cara added/)).toBeVisible();

    for (const m of await apiAs(asha).members(gid)) {
      if (m.displayName === "Asha") member.asha = m.id;
      if (m.displayName === "Bob") member.bob = m.id;
      if (m.displayName === "Cara") member.cara = m.id;
    }
    expect(Object.values(member).every((id) => id !== "")).toBe(true);

    await addExpense(asha.page, { description: "Dinner", amount: "1000" });
    await expect(asha.page.getByLabel("Asha's share")).toHaveText(/333\.34/);
    await expect(asha.page.getByLabel("Bob's share")).toHaveText(/333\.33/);
    await expect(asha.page.getByLabel("Cara's share")).toHaveText(/333\.33/);
    await asha.page.getByRole("button", { name: "Add expense" }).click();
    await expect(asha.page).toHaveURL(new RegExp(`/g/${gid}$`));
    await expect(asha.page.getByText("Dinner").first()).toBeVisible();

    const nets = netsOf(await apiAs(asha).balances(gid));
    expect(nets.get(member.asha)).toBe(66666);
    expect(nets.get(member.bob)).toBe(-33333);
    expect(nets.get(member.cara)).toBe(-33333);
    await expect(asha.page.getByTestId("my-balance")).toHaveText(/666\.66/);
  });

  test("3. B adds a ₹600 cab split by shares 1:1:2; balances move and still sum to zero", async () => {
    await addExpense(bob.page, {
      description: "Cab",
      amount: "600",
      method: "Shares",
      shares: { Cara: "2" },
    });
    await expect(bob.page.getByLabel("Asha's share")).toHaveText(/150\.00/);
    await expect(bob.page.getByLabel("Bob's share")).toHaveText(/150\.00/);
    await expect(bob.page.getByLabel("Cara's share")).toHaveText(/300\.00/);
    await bob.page.getByRole("button", { name: "Add expense" }).click();
    await expect(bob.page).toHaveURL(new RegExp(`/g/${gid}$`));
    await expect(bob.page.getByText("Cab").first()).toBeVisible();

    const nets = netsOf(await apiAs(bob).balances(gid));
    expect(nets.get(member.asha)).toBe(51666);
    expect(nets.get(member.bob)).toBe(11667);
    expect(nets.get(member.cara)).toBe(-63333);
    expect([...nets.values()].reduce((a, b) => a + b, 0)).toBe(0);
  });

  test("4. with simplify debts on, the plan has at most two payments and settles everyone to zero", async () => {
    const balances = await apiAs(asha).balances(gid);
    expect(balances.simplifyDebts).toBe(true);
    expect(balances.simplified.length).toBeLessThanOrEqual(2);

    const nets = netsOf(balances);
    for (const p of balances.simplified) {
      nets.set(p.fromMemberId, (nets.get(p.fromMemberId) ?? 0) + p.amount.amountMinor);
      nets.set(p.toMemberId, (nets.get(p.toMemberId) ?? 0) - p.amount.amountMinor);
    }
    expect([...nets.values()]).toEqual([0, 0, 0]);

    await asha.page.goto(`g/${gid}/settle`);
    await expect(asha.page.getByRole("button", { name: /^Record payment:/ })).toHaveCount(
      balances.simplified.length,
    );
  });

  test("5. C accepts a claim link: the placeholder becomes a real account with the same history", async () => {
    await asha.page.goto(`g/${gid}/settings`);
    await asha.page
      .getByRole("listitem")
      .filter({ hasText: "No account yet" })
      .filter({ hasText: "Cara" })
      .getByRole("button", { name: "Invite them to take this place" })
      .click();
    const link = await readInviteLink(asha.page);

    await cara.page.goto(link);
    await expect(cara.page.getByText("This link is for")).toBeVisible();
    await cara.page.getByRole("link", { name: "Create an account" }).click();
    await submitSignUp(cara);
    await cara.page.getByRole("button", { name: /Take Cara.s place/ }).click();
    await expect(cara.page).toHaveURL(new RegExp(`/g/${gid}$`));

    const members = await apiAs(cara).members(gid);
    const me = members.find((m) => m.isYou);
    expect(me?.id).toBe(member.cara);
    expect(me?.isPlaceholder).toBe(false);
    expect(members).toHaveLength(3);

    const expenses = await apiAs(cara).expenses(gid);
    expect(expenses.map((e) => e.description).sort()).toEqual(["Cab", "Dinner"]);
    expect(netsOf(await apiAs(cara).balances(gid)).get(member.cara)).toBe(-63333);
    await expect(cara.page.getByTestId("my-balance")).toHaveText(/633\.33/);
  });

  test("6. B records a suggested payment: B's balance becomes zero and the feed shows it", async () => {
    await bob.page.goto(`g/${gid}/settle`);
    await bob.page.getByRole("button", { name: /^Record payment: Cara pays you/ }).click();
    await expect(bob.page.getByText(/Cara paid/)).toBeVisible();

    expect(netsOf(await apiAs(bob).balances(gid)).get(member.bob)).toBe(0);

    await bob.page.goto(`g/${gid}?tab=activity`);
    await expect(bob.page.getByText(/recorded a payment from Cara to Bob/)).toBeVisible();
  });

  test("a reload on a deep link serves the app, with every asset and API call succeeding", async () => {
    const failures: string[] = [];
    bob.page.on("response", (response) => {
      if (response.status() >= 400 && new URL(response.url()).origin === origin) {
        failures.push(`${response.status()} ${response.url()}`);
      }
    });
    await bob.page.goto(`g/${gid}/settle`);
    await bob.page.reload();
    await expect(bob.page.getByRole("heading", { level: 1, name: "Settle up" })).toBeVisible();
    expect(failures).toEqual([]);
  });

  test("with simplify debts off, the settle-up screen suggests the pairwise debts instead", async () => {
    const setSimplify = async (on: boolean) => {
      await asha.page.goto(`g/${gid}/settings`);
      const box = asha.page.getByLabel("Simplify debts");
      await (on ? box.check() : box.uncheck());
      await asha.page.getByRole("button", { name: "Save settings" }).click();
      await expect.poll(async () => (await apiAs(asha).balances(gid)).simplifyDebts).toBe(on);
    };

    await setSimplify(false);
    try {
      const balances = await apiAs(asha).balances(gid);
      expect(balances.suggested).toEqual(
        balances.pairwise.map((p) => ({
          fromMemberId: p.debtorId,
          toMemberId: p.creditorId,
          amount: p.amount,
        })),
      );
      expect(balances.pairwise.length).toBeGreaterThan(balances.simplified.length);

      await asha.page.goto(`g/${gid}/settle`);
      await expect(asha.page.getByRole("button", { name: /^Record payment:/ })).toHaveCount(
        balances.pairwise.length,
      );
    } finally {
      await setSimplify(true);
    }
  });

  test("7. two people editing the same expense: the second save gets a conflict and sees the latest", async () => {
    const dinner = (await apiAs(asha).expenses(gid)).find((e) => e.description === "Dinner");
    expect(dinner).toBeDefined();
    const editPath = `g/${gid}/expenses/${dinner?.id ?? ""}`;

    await asha.page.goto(editPath);
    await bob.page.goto(editPath);
    await expect(asha.page.getByLabel("What was it for?")).toHaveValue("Dinner");
    await expect(bob.page.getByLabel("What was it for?")).toHaveValue("Dinner");

    await asha.page.getByLabel("What was it for?").fill("Dinner at the shack");
    await asha.page.getByRole("button", { name: "Save changes" }).click();
    await expect(asha.page).toHaveURL(new RegExp(`/g/${gid}$`));

    await bob.page.getByLabel("Amount (INR)").fill("1200");
    await bob.page.getByRole("button", { name: "Save changes" }).click();
    const dialog = bob.page.getByRole("dialog", { name: "Someone else changed this expense" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Dinner at the shack");

    await dialog.getByRole("button", { name: "Use their version" }).click();
    await expect(bob.page.getByLabel("What was it for?")).toHaveValue("Dinner at the shack");
    await expect(bob.page.getByLabel("Amount (INR)")).toHaveValue(/^1000(\.00)?$/);

    // Bob's rejected edit changed nothing.
    const after = (await apiAs(bob).expenses(gid)).find((e) => e.id === dinner?.id);
    expect(after?.amount.amountMinor).toBe(100000);
  });

  test("8. leaving the group with a balance is refused, with an explanation", async () => {
    await cara.page.goto(`g/${gid}/settings`);
    await cara.page.getByRole("button", { name: "Leave group" }).click();
    const dialog = cara.page.getByRole("dialog", { name: "Leave this group?" });
    await dialog.getByRole("button", { name: "Leave group" }).click();
    await expect(dialog.getByText(/unsettled balance of/)).toBeVisible();
    await expect(dialog.getByText(/Settle up before leaving/)).toBeVisible();

    const group = await apiAs(cara).call("GET", `groups/${gid}`);
    expect(group.status()).toBe(200);
  });

  test("9. the CSV export's totals match the balances in the app", async () => {
    const response = await asha.context.request.get(`api/v1/groups/${gid}/export.csv`);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toMatch(/text\/csv/);
    const rows = parseCsv(stripBom(await response.text()));

    const header = rows[0] ?? [];
    expect(header.slice(0, 5)).toEqual(["Type", "Date", "Description", "Category", "Amount"]);
    const expenses = rows.filter((r) => r[0] === "Expense");
    expect(expenses.map((r) => r[2]).sort()).toEqual(["Cab", "Dinner at the shack"]);
    const col = (name: string) => header.indexOf(name);
    expect(expenses.reduce((sum, r) => sum + toMinor(r[col("Amount")] ?? "0"), 0)).toBe(160000);

    const nets = netsOf(await apiAs(asha).balances(gid));
    const names = { Asha: member.asha, Bob: member.bob, Cara: member.cara };

    // The summary block at the end ...
    const summaryAt = rows.findIndex((r) => r[0] === "Member");
    expect(summaryAt).toBeGreaterThan(0);
    for (const [name, id] of Object.entries(names)) {
      const row = rows.slice(summaryAt + 1).find((r) => r[0] === name);
      expect(toMinor(row?.[1] ?? "x"), `${name}'s net balance`).toBe(nets.get(id));
    }
    // ... and the per-row net effects, which a spreadsheet would add up.
    for (const [name, id] of Object.entries(names)) {
      const at = col(`Net effect - ${name}`);
      expect(at).toBeGreaterThan(0);
      const total = rows
        .slice(1, summaryAt)
        .reduce((sum, r) => sum + toMinor(r[at] === undefined || r[at] === "" ? "0" : r[at]), 0);
      expect(total, `${name}'s net effects`).toBe(nets.get(id));
    }
  });

  test("10. someone who is not a member gets 404 for every route of the group", async () => {
    const signup = await dave.context.request.post("api/auth/sign-up/email", {
      headers: { origin },
      data: { name: dave.name, email: dave.email, password: "correct horse battery staple" },
    });
    expect(signup.status()).toBe(200);

    const eid = (await apiAs(asha).expenses(gid))[0]?.id ?? "";
    const api = apiAs(dave);
    const unknown = "0192f0c4-0000-7000-8000-000000000000";
    const body = {
      id: unknown,
      description: "x",
      amountMinor: 100,
      currency: "INR",
      expenseDate: "2026-10-10",
      payers: [{ memberId: member.asha, amountMinor: 100 }],
      split: { method: "equal", entries: [{ memberId: member.asha }] },
    };
    const routes: [string, string, unknown?][] = [
      ["GET", `groups/${gid}`],
      ["PATCH", `groups/${gid}`, { name: "Mine now" }],
      ["DELETE", `groups/${gid}`],
      ["GET", `groups/${gid}/members`],
      ["POST", `groups/${gid}/members`, { displayName: "Intruder" }],
      ["GET", `groups/${gid}/invites`],
      ["POST", `groups/${gid}/invites`, {}],
      ["GET", `groups/${gid}/activity`],
      ["GET", `groups/${gid}/expenses`],
      ["POST", `groups/${gid}/expenses`, body],
      ["GET", `groups/${gid}/expenses/${eid}`],
      ["DELETE", `groups/${gid}/expenses/${eid}`],
      ["GET", `groups/${gid}/settlements`],
      ["GET", `groups/${gid}/balances`],
      ["GET", `groups/${gid}/export.csv`],
    ];
    // What a group that does not exist answers, so a member-only group must answer the same.
    const missing = await api.call("GET", `groups/${unknown}`);
    expect(missing.status()).toBe(404);
    const missingType = ((await missing.json()) as { type: string }).type;

    for (const [method, path, payload] of routes) {
      const response = await api.call(method, path, payload);
      expect(response.status(), `${method} ${path}`).toBe(404);
      expect(((await response.json()) as { type: string }).type, `${method} ${path}`).toBe(
        missingType,
      );
    }

    const groups = await api.call("GET", "groups");
    expect(await groups.json()).toEqual([]);
    // ... and nothing was changed by those writes.
    expect(await apiAs(asha).members(gid)).toHaveLength(3);
  });

  test("keyboard: the skip link works on a nested page, and focused controls show it", async () => {
    const { page } = asha;
    await page.goto(`g/${gid}/settle`);
    await expect(page.getByRole("heading", { level: 1, name: "Settle up" })).toBeVisible();
    const here = page.url();
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to content" });
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page.locator("#content")).toBeFocused();
    // The <base href> must not turn the in-page link into a trip to the site root.
    expect(page.url().replace(/#.*$/, "")).toBe(here);

    await page.goto(`g/${gid}`);
    await expect(page.getByRole("heading", { level: 1, name: /Goa Trip/ })).toBeVisible();
    for (let presses = 0; presses < 10; presses++) {
      await page.keyboard.press("Tab");
      const shown = await page.evaluate(() => {
        const el = document.activeElement;
        if (el === null || el === document.body) return true;
        const style = getComputedStyle(el);
        const outlined = style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0;
        // The method radios are visually hidden; their label shows the ring.
        const label = el.closest("label");
        const labelStyle = label === null ? null : getComputedStyle(label);
        return (
          outlined ||
          style.boxShadow !== "none" ||
          (labelStyle !== null && labelStyle.outlineStyle !== "none")
        );
      });
      expect(shown, `focus ring after ${String(presses + 1)} Tab presses`).toBe(true);
    }
  });

  test("accessibility: no WCAG A or AA violations on the main screens, in light and dark", async ({
    browser,
  }) => {
    // Signed out, for the public screens.
    const visitor = await newUser(browser, "Visitor");
    const screens: [User, string][] = [
      [visitor, "login"],
      [visitor, "signup"],
      [visitor, "reset"],
      [asha, ""],
      [asha, "groups/new"],
      [asha, `g/${gid}`],
      [asha, `g/${gid}?tab=activity`],
      [asha, `g/${gid}/expenses/new`],
      [asha, `g/${gid}/settle`],
      [asha, `g/${gid}/settings`],
      [asha, "account"],
    ];
    try {
      for (const scheme of ["light", "dark"] as const) {
        for (const [user, path] of screens) {
          await user.page.emulateMedia({ colorScheme: scheme });
          await user.page.goto(path);
          await expect(user.page.locator("main")).toBeVisible();
          await user.page.waitForLoadState("networkidle");
          const { violations } = await new AxeBuilder({ page: user.page })
            .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
            .analyze();
          expect(
            violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`),
            `${scheme} /${path}`,
          ).toEqual([]);
        }
      }
    } finally {
      await visitor.context.close();
    }
  });

  test("phones: no screen needs sideways scrolling at 375px", async () => {
    await asha.page.setViewportSize({ width: 375, height: 812 });
    const paths = [
      "",
      "groups/new",
      `g/${gid}`,
      `g/${gid}?tab=activity`,
      `g/${gid}/expenses/new`,
      `g/${gid}/settle`,
      `g/${gid}/settings`,
      "account",
    ];
    for (const path of paths) {
      await asha.page.goto(path);
      await expect(asha.page.locator("main")).toBeVisible();
      await asha.page.waitForLoadState("networkidle");
      const overflow = await asha.page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow, `horizontal overflow on /${path}`).toBeLessThanOrEqual(0);
    }
  });
});
