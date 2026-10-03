// Minimal RFC 4180 CSV (comma, double quotes, header row) for the versioned data files.

type Cell = string | number | null | undefined;

function formatCell(value: Cell): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv<T extends Record<string, Cell>>(
  columns: (keyof T & string)[],
  rows: T[],
): string {
  const lines = [
    columns.join(","),
    ...rows.map((row) => columns.map((c) => formatCell(row[c])).join(",")),
  ];
  return `${lines.join("\n")}\n`;
}

/** Parses a CSV with a header row into records of strings (empty cells are ""). */
export function parseCsv(source: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (quoted) throw new Error("CSV invalide : guillemet non fermé.");
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  const [header, ...body] = rows.filter((r) => r.length > 1 || r[0] !== "");
  if (!header) return [];
  return body.map((values, index) => {
    if (values.length !== header.length) {
      throw new Error(
        `CSV invalide : la ligne ${index + 2} a ${values.length} colonnes au lieu de ${header.length}.`,
      );
    }
    return Object.fromEntries(header.map((name, i) => [name, values[i]]));
  });
}
