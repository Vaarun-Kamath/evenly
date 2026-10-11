/** A small RFC 4180 parser for the tests: quoted fields, doubled quotes, commas and newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\r" && text[i + 1] === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += 1;
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** "-333.33" or "1000" as integer minor units, given the number of decimals. */
export function toMinor(value: string, decimals: number): number {
  if (value === "") return 0;
  const negative = value.startsWith("-");
  const [whole = "0", fraction = ""] = value.replace("-", "").split(".");
  const minor = Number(whole + fraction.padEnd(decimals, "0").slice(0, decimals));
  return negative ? -minor : minor;
}

/** The text without a leading UTF-8 byte order mark (the export starts with one for Excel). */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
