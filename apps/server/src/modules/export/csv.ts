/**
 * CSV for spreadsheets (RFC 4180, CRLF line ends). Two kinds of cell, because they need different care:
 *  - text typed by people (descriptions, notes, names) can start with `=`, `+`, `-`, `@`, a tab or a
 *    carriage return, which a spreadsheet would run as a formula; those get a leading `'` (ADR-0004);
 *  - numbers the server formats itself (`-333.33`) must stay numbers, so they are never guarded.
 */
const FORMULA_START = /^(?:[\t\r]|\s*[=+\-@])/;

function quote(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/** A cell of free text. */
export function csvText(value: string): string {
  return quote(FORMULA_START.test(value) ? `'${value}` : value);
}

/** A cell the server formatted as a plain decimal number (or empty). */
export function csvNumber(value: string): string {
  return quote(value);
}

export function csvRow(cells: readonly string[]): string {
  return `${cells.join(",")}\r\n`;
}

/** UTF-8 byte order mark, so that Excel reads non-ASCII names correctly. */
export const BOM = "﻿";
