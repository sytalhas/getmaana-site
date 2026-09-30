// CSV writer for exports. RFC 4180 quoting, CRLF line ends, and a leading
// apostrophe on text that a spreadsheet would treat as a formula.

function cell(v) {
  if (v == null) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  if (typeof v === "boolean") return v ? "true" : "false";
  let s = typeof v === "object" ? JSON.stringify(v) : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** headers: column keys; rows: objects. Returns CSV text. */
export function toCSV(headers, rows) {
  const lines = [headers.map(cell).join(",")];
  for (const r of rows) lines.push(headers.map((k) => cell(r[k])).join(","));
  return lines.join("\r\n") + "\r\n";
}
