import { legacyColumns, migrateValues } from "./migration";
import { emptyTables, schema, tableNames, type Tables } from "./schema";
function spreadsheetId() {
  const id =
    PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID");
  if (!id) throw new Error("SPREADSHEET_ID missing");
  return id;
}
function api() {
  if (!Sheets?.Spreadsheets) throw new Error("Enable advanced Sheets service");
  return Sheets.Spreadsheets;
}
export function readDatabase(selected: (keyof Tables)[] = tableNames): Tables {
  const db = emptyTables();
  const result = api().Values!.batchGet(spreadsheetId(), {
    ranges: selected.map((k) => `'${k}'!A:Z`),
    valueRenderOption: "UNFORMATTED_VALUE",
  });
  for (const [index, table] of selected.entries()) {
    const values = result.valueRanges?.[index]?.values ?? [];
    const headers = schema[table] as string[];
    if (JSON.stringify(values[0]) !== JSON.stringify(headers))
      throw new Error(`Invalid sheet schema: ${table}`);
    const rows = values
      .slice(1)
      .filter((row) => row.some((v) => v !== "" && v !== null))
      .map((row) =>
        Object.fromEntries(
          headers.map((key, i) => [
            key,
            row[i] === undefined || row[i] === "" ? null : row[i],
          ]),
        ),
      );
    (db[table] as unknown[]).push(...rows);
  }
  return db;
}
export function commitDatabase(
  before: Tables,
  after: Tables,
  force: (keyof Tables)[] = [],
) {
  const changed = tableNames.filter(
    (k) =>
      force.includes(k) ||
      JSON.stringify(before[k]) !== JSON.stringify(after[k]),
  );
  if (!changed.length) return;
  const metadata = api().get(spreadsheetId(), { fields: "sheets.properties" });
  const requests: GoogleAppsScript.Sheets.Schema.Request[] = [];
  for (const table of changed) {
    const props = metadata.sheets?.find(
      (s) => s.properties?.title === table,
    )?.properties;
    if (props?.sheetId === undefined) throw new Error("Missing sheet");
    const headers = schema[table] as string[];
    const rows = [
      headers,
      ...after[table].map((row) =>
        headers.map((key) => (row as unknown as Record<string, unknown>)[key]),
      ),
    ];
    const count = Math.max(before[table].length + 1, rows.length);
    if ((props.gridProperties?.rowCount ?? 0) < count)
      requests.push({
        appendDimension: {
          sheetId: props.sheetId,
          dimension: "ROWS",
          length: count - (props.gridProperties?.rowCount ?? 0),
        },
      });
    requests.push({
      updateCells: {
        range: {
          sheetId: props.sheetId,
          startRowIndex: 0,
          endRowIndex: count,
          startColumnIndex: 0,
          endColumnIndex: headers.length,
        },
        rows: rows.map((row) => ({
          values: row.map((value) => ({
            userEnteredValue:
              typeof value === "number"
                ? { numberValue: value }
                : typeof value === "boolean"
                  ? { boolValue: value }
                  : value === null || value === undefined
                    ? {}
                    : { stringValue: String(value) },
          })),
        })),
        fields: "userEnteredValue",
      },
    });
  }
  // A single Sheets API batch is atomic, including completion + idempotency ledger + snapshots.
  api().batchUpdate({ requests }, spreadsheetId());
}
export function ensureSheets() {
  const ss = SpreadsheetApp.openById(spreadsheetId());
  ss.setSpreadsheetTimeZone("Europe/Moscow");
  for (const name of tableNames) {
    let sheet = ss.getSheetByName(name);
    const headers = schema[name] as string[];
    if (!sheet) sheet = ss.insertSheet(name);
    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.setFrozenRows(1);
    } else {
      const actual = sheet
        .getRange(1, 1, 1, sheet.getLastColumn())
        .getValues()[0];
      if (
        JSON.stringify(actual) !== JSON.stringify(headers) &&
        JSON.stringify(actual) !== JSON.stringify(legacyColumns[name])
      )
        throw new Error("Existing headers differ: " + name);
    }
  }
  SpreadsheetApp.flush();
}

// Called under the setup ScriptLock. Validate every sheet before a single atomic write.
export function migrateSheets() {
  const result = api().Values!.batchGet(spreadsheetId(), {
    ranges: tableNames.map((k) => `'${k}'!A:Z`),
    valueRenderOption: "UNFORMATTED_VALUE",
  });
  const { db, changed } = migrateValues(
    tableNames.map((_, i) => result.valueRanges?.[i]?.values ?? []),
  );
  commitDatabase(db, db, changed);
}
