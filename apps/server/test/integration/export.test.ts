import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId } from "../../src/db/ids";
import { startHarness, type Harness } from "./harness";
import { parseCsv, toMinor, stripBom } from "./csv";
import { addExpense, addSettlement, netsOf, startTrip, type Trip } from "./trip";

describe("GET /groups/:gid/export.csv", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(async () => {
    await h.close();
  });

  const download = async (g: Trip, who = g.alice) => {
    const response = await h.as(who).get(`/groups/${g.groupId}/export.csv`);
    return { response, text: response.body, rows: parseCsv(stripBom(response.body)) };
  };

  /** Split a parsed CSV into the table of expenses and settlements, and the balances section. */
  function sections(rows: string[][]) {
    const blank = rows.findIndex((row) => row.length === 1 && row[0] === "");
    const table = rows.slice(0, blank === -1 ? rows.length : blank);
    const rest = blank === -1 ? [] : rows.slice(blank + 1);
    const header = table[0]!;
    const balancesAt = rest.findIndex((row) => row[0] === "Balances");
    return { header, data: table.slice(1), balances: rest.slice(balancesAt + 2) };
  }

  it("downloads as a UTF-8 CSV attachment named after the group", async () => {
    const g = await startTrip(h);
    const { response, text } = await download(g);
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("text/csv; charset=utf-8");
    expect(response.headers["content-disposition"]).toMatch(
      /^attachment; filename="goa-trip-\d{4}-\d{2}-\d{2}\.csv"$/,
    );
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(text.startsWith("﻿")).toBe(true);
    expect(text.endsWith("\r\n")).toBe(true);
  });

  it("lists every expense and settlement with each member's share, and totals that match the app (SPEC scenario 9)", async () => {
    const g = await startTrip(h);
    await addExpense(h, g.alice, g, { description: "Dinner" });
    await addExpense(h, g.bob, g, {
      description: "Cab",
      amountMinor: 60000,
      payers: [{ memberId: g.bId, amountMinor: 60000 }],
      split: {
        method: "shares",
        entries: [
          { memberId: g.aId, value: "1" },
          { memberId: g.bId, value: "1" },
          { memberId: g.cId, value: "2" },
        ],
      },
    });
    const removed = await addExpense(h, g.alice, g, {
      description: "Deleted one",
      amountMinor: 999,
    });
    await h.as(g.alice).delete(`/groups/${g.groupId}/expenses/${removed.id}`);
    await addSettlement(h, g.bob, g, g.cId, g.bId, 11667);

    const { rows } = await download(g);
    const { header, data, balances } = sections(rows);
    expect(header.slice(0, 9)).toEqual([
      "Type",
      "Date",
      "Description",
      "Category",
      "Amount",
      "Currency",
      "Paid by",
      "Split",
      "Notes",
    ]);
    expect(header.slice(9)).toEqual([
      "Share - Alice",
      "Share - Bob",
      "Share - Cara",
      "Net effect - Alice",
      "Net effect - Bob",
      "Net effect - Cara",
    ]);

    expect(data.map((r) => [r[0], r[2], r[4]])).toEqual([
      ["Expense", "Dinner", "1000.00"],
      ["Expense", "Cab", "600.00"],
      ["Settlement", "Cara paid Bob", "116.67"],
    ]);
    // Dinner: paid by Alice, shares 333.34 / 333.33 / 333.33.
    expect(data[0]?.slice(6, 8)).toEqual(["Alice: 1000.00", "equal"]);
    expect(data[0]?.slice(9, 12)).toEqual(["333.34", "333.33", "333.33"]);
    expect(data[1]?.slice(9, 12)).toEqual(["150.00", "150.00", "300.00"]);
    // Settlements have no shares, only a net effect: Cara paid, so hers goes up and Bob's down.
    expect(data[2]?.slice(9, 12)).toEqual(["", "", ""]);
    expect(data[2]?.slice(12, 15)).toEqual(
      ["", "-116.67", "116.67"].map((v, i) => (i === 0 ? "" : i === 1 ? "-116.67" : "116.67")),
    );

    // The net-effect columns add up to the balances below the table, and those to the API's balances.
    const columnSums = [0, 1, 2].map((i) =>
      data.reduce((sum, r) => sum + toMinor(r[12 + i]!, 2), 0),
    );
    const listed = balances.filter((r) => r[0] !== "Total").map((r) => toMinor(r[1]!, 2));
    expect(listed).toEqual(columnSums);
    const api = await netsOf(h, g.alice, g.groupId);
    expect(listed).toEqual([api[g.aId], api[g.bId], api[g.cId]]);
    expect(balances.at(-1)).toEqual(["Total", "0.00", "INR"]);
    expect(balances.slice(0, 3).map((r) => r[0])).toEqual(["Alice", "Bob", "Cara"]);
  });

  it("quotes commas, quotes and line breaks, and defuses spreadsheet formulas", async () => {
    const g = await startTrip(h);
    const names: [string, string][] = [
      ['Dinner, drinks and "dessert"', "plain"],
      ['=HYPERLINK("http://evil.example","click")', "=1+1"],
      ["+cmd|' /C calc'!A0", "@SUM(A1)"],
      ["-2+3", "line one\nline two"],
      ["\tTabbed", "\rReturn"],
      ["  =spaced", "ok"],
    ];
    for (const [description, notes] of names)
      await addExpense(h, g.alice, g, { description, notes, amountMinor: 300 });

    const { rows, text } = await download(g);
    const { data } = sections(rows);
    const byDescription = (d: string) => data.find((r) => r[2] === d)!;
    // Free text that could be read as a formula gets a leading apostrophe; ordinary text is untouched.
    expect(byDescription('Dinner, drinks and "dessert"')[8]).toBe("plain");
    expect(byDescription('\'=HYPERLINK("http://evil.example","click")')[8]).toBe("'=1+1");
    expect(byDescription("'+cmd|' /C calc'!A0")[8]).toBe("'@SUM(A1)");
    expect(byDescription("'-2+3")[8]).toBe("line one\nline two");
    // Whitespace around a description or note is trimmed on the way in, so a leading tab never gets here.
    expect(byDescription("Tabbed")[8]).toBe("Return");
    expect(byDescription("'=spaced")[8]).toBe("ok");
    // No data row holds a cell that starts a formula.
    for (const row of data) {
      for (const cell of row) expect(cell, JSON.stringify(row)).not.toMatch(/^\s*[=+@]/);
    }
    // Numbers the server writes stay numbers: negative amounts are not guarded.
    expect(text).toMatch(/,-\d+\.\d\d(,|\r\n)/);
    expect(data.every((r) => r.length === data[0]?.length)).toBe(true);
  });

  it("guards member names too, and marks people who left", async () => {
    const g = await startTrip(h);
    await h.as(g.alice).post(`/groups/${g.groupId}/members`, { displayName: "=Mallory" });
    const leaver = await h
      .as(g.alice)
      .post(`/groups/${g.groupId}/members`, { displayName: "Gone Gary" });
    await h.as(g.alice).delete(`/groups/${g.groupId}/members/${leaver.json<{ id: string }>().id}`);
    await addExpense(h, g.alice, g);
    const { rows } = await download(g);
    const { header, balances } = sections(rows);
    expect(header).toContain("Share - =Mallory"); // starts with "Share", so it is not a formula
    expect(balances.map((r) => r[0])).toContain("'=Mallory");
    expect(header.some((c) => c.includes("Gone Gary (left)"))).toBe(true);
    // A person who left at zero is not listed among the balances.
    expect(balances.map((r) => r[0]).join("|")).not.toContain("Gone Gary");
  });

  it("uses each currency's own number of decimals", async () => {
    const yen = await startTrip(h, { currency: "JPY" });
    await addExpense(h, yen.alice, yen, {
      currency: "JPY",
      amountMinor: 1000,
      split: { method: "equal", entries: [yen.aId, yen.bId].map((memberId) => ({ memberId })) },
    });
    expect(sections((await download(yen)).rows).data[0]?.slice(4, 6)).toEqual(["1000", "JPY"]);

    const dinar = await startTrip(h, { currency: "KWD" });
    await addExpense(h, dinar.alice, dinar, { currency: "KWD", amountMinor: 1234 });
    expect(sections((await download(dinar)).rows).data[0]?.slice(4, 6)).toEqual(["1.234", "KWD"]);
  });

  it("streams a large group in pages, in order, with the right totals", async () => {
    const g = await startTrip(h);
    const count = 1250; // more than two pages of 500
    // One transaction, as the totals check runs at commit.
    await h.db.sql.begin(async (tx) => {
      await tx`
        insert into expenses (id, group_id, description, amount_minor, currency, expense_date, split_method, created_by)
        select (substr(md5(i::text), 1, 8) || '-' || substr(md5(i::text), 9, 4) || '-7' || substr(md5(i::text), 14, 3) || '-8' || substr(md5(i::text), 18, 3) || '-' || substr(md5(i::text), 21, 12))::uuid,
               ${g.groupId}::uuid, 'Bulk ' || lpad(i::text, 5, '0'), 100, 'INR', date '2026-01-01' + (i % 28), 'equal', ${g.aId}::uuid
        from generate_series(1, ${count}) as i`;
      await tx`insert into expense_payers (expense_id, member_id, amount_minor) select id, ${g.aId}::uuid, 100 from expenses where group_id = ${g.groupId}`;
      await tx`insert into expense_shares (expense_id, member_id, amount_minor) select id, ${g.bId}::uuid, 100 from expenses where group_id = ${g.groupId}`;
    });

    const { rows } = await download(g);
    const { data, balances } = sections(rows);
    expect(data).toHaveLength(count);
    const dates = data.map((r) => r[1]!);
    expect([...dates].sort()).toEqual(dates);
    expect(new Set(data.map((r) => r[2])).size).toBe(count);
    // Alice paid 100 x 1250 that Bob owes.
    expect(balances.slice(0, 3).map((r) => r[1])).toEqual(["1250.00", "-1250.00", "0.00"]);
  });

  it("is for members only", async () => {
    const g = await startTrip(h);
    expect((await h.as(await h.signUp()).get(`/groups/${g.groupId}/export.csv`)).statusCode).toBe(
      404,
    );
    expect((await h.as(null).get(`/groups/${g.groupId}/export.csv`)).statusCode).toBe(401);
    expect((await download(g, g.bob)).response.statusCode).toBe(200);
  });

  void newId;
});
