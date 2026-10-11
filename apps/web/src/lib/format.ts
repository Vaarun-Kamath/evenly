import { formatMinor } from "@evenly/core";

/** The viewer's own locale decides grouping and symbols; amounts always show the currency's own decimals. */
const locale = typeof navigator === "undefined" ? undefined : navigator.language;

export function money(amountMinor: number, currency: string): string {
  return formatMinor(amountMinor, currency, locale);
}

/** "+₹10.00" or "−₹10.00": the sign is spelled out, so colour is never the only signal. */
export function signedMoney(amountMinor: number, currency: string): string {
  const text = money(Math.abs(amountMinor), currency);
  if (amountMinor > 0) return `+${text}`;
  if (amountMinor < 0) return `−${text}`;
  return text;
}

/** Spoken-style balance: "you are owed ₹10.00", "you owe ₹10.00" or "settled up". */
export function balanceSentence(netMinor: number, currency: string): string {
  if (netMinor > 0) return `you are owed ${money(netMinor, currency)}`;
  if (netMinor < 0) return `you owe ${money(-netMinor, currency)}`;
  return "settled up";
}

/** Today as `YYYY-MM-DD`, in the viewer's own calendar. */
export function todayIso(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** A calendar date (`YYYY-MM-DD`) for display; no time zone shifts it. */
export function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number) as [number, number, number];
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
    new Date(year, month - 1, day),
  );
}

/** A moment (an ISO timestamp) for display, in the viewer's time zone. */
export function formatDateTime(isoTimestamp: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(isoTimestamp),
  );
}

/** "Rupee (INR)" for a currency code, in the viewer's language. */
export function currencyLabel(code: string): string {
  try {
    const name = new Intl.DisplayNames(locale, { type: "currency" }).of(code);
    return name === undefined || name === code ? code : `${code} – ${name}`;
  } catch {
    return code;
  }
}
