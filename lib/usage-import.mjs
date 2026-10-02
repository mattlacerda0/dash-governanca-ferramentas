import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const HEADERS = ["Ferramenta", "Área", "Quantidade de usuários", "Data de início", "Data de fim"];

function clean(value) { return String(value ?? "").trim(); }
function key(value) {
  return clean(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR").replace(/\s+/g, " ");
}

function xlsx() { return require("xlsx"); }

export function dateFromSpreadsheet(value) {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()));
  if (typeof value === "number") {
    const parts = xlsx().SSF.parse_date_code(value);
    return parts ? new Date(Date.UTC(parts.y, parts.m - 1, parts.d)) : null;
  }
  const text = clean(value);
  const brazilian = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const parts = brazilian ? [brazilian[3], brazilian[2], brazilian[1]] : iso ? [iso[1], iso[2], iso[3]] : null;
  if (!parts) return null;
  const date = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])));
  return date.getUTCFullYear() === Number(parts[0]) && date.getUTCMonth() === Number(parts[1]) - 1 && date.getUTCDate() === Number(parts[2]) ? date : null;
}

function isoDate(value) { return value.toISOString().slice(0, 10); }
function blank(values) { return values.every((value) => !clean(value)); }

export function createUsageTemplate(tools) {
  const workbook = xlsx().utils.book_new();
  const rows = [HEADERS, ...(tools || []).map((tool) => [tool.nome, "", "", "", ""])];
  const sheet = xlsx().utils.aoa_to_sheet(rows);
  sheet["!cols"] = [{ wch: 42 }, { wch: 32 }, { wch: 24 }, { wch: 16 }, { wch: 16 }];
  xlsx().utils.book_append_sheet(workbook, sheet, "Uso por área");
  return xlsx().write(workbook, { bookType: "xlsx", type: "buffer" });
}

export function readUsageSpreadsheet(buffer) {
  const workbook = xlsx().read(buffer, { type: "buffer", cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error("A planilha não possui uma aba para importar.");
  const rows = xlsx().utils.sheet_to_json(sheet, { header: 1, defval: "", raw: true });
  const headers = (rows[0] || []).map(key);
  const expected = HEADERS.map(key);
  const missing = HEADERS.filter((_, index) => headers[index] !== expected[index]);
  if (missing.length) throw new Error(`Use o modelo com as colunas: ${HEADERS.join(", ")}.`);
  return rows.slice(1).map((values, index) => ({ line: index + 2, values: values.slice(0, HEADERS.length) })).filter((row) => !blank(row.values));
}

function overlaps(left, right) {
  const leftEnd = left.end || "9999-12-31";
  const rightEnd = right.end || "9999-12-31";
  return left.start <= rightEnd && right.start <= leftEnd;
}

export function validateUsageRows(rows, { tools, areas, periods }) {
  const toolsByName = new Map((tools || []).map((tool) => [key(tool.nome), tool]));
  const areasByName = new Map((areas || []).map((area) => [key(area.nome), area]));
  const knownPeriods = (periods || []).map((period) => ({ toolId: period.ferramenta_id, areaId: period.area_id, start: period.data_inicio, end: period.data_fim || null }));
  const errors = [];
  const entries = [];

  for (const row of rows) {
    const [toolName, areaName, userValue, startValue, endValue] = row.values;
    const tool = toolsByName.get(key(toolName));
    const areaLabel = clean(areaName).replace(/\s+/g, " ");
    const users = Number(userValue);
    const startsOn = dateFromSpreadsheet(startValue);
    const endsOn = clean(endValue) ? dateFromSpreadsheet(endValue) : null;
    if (!tool) errors.push(`Linha ${row.line}: ferramenta não cadastrada.`);
    if (!areaLabel) errors.push(`Linha ${row.line}: informe a área.`);
    if (!Number.isInteger(users) || users < 1) errors.push(`Linha ${row.line}: informe uma quantidade inteira de usuários maior que zero.`);
    if (!startsOn) errors.push(`Linha ${row.line}: informe uma data de início válida.`);
    if (clean(endValue) && !endsOn) errors.push(`Linha ${row.line}: informe uma data de fim válida.`);
    if (startsOn && endsOn && endsOn < startsOn) errors.push(`Linha ${row.line}: a data de fim não pode ser anterior ao início.`);
    if (tool && areaLabel && Number.isInteger(users) && users > 0 && startsOn && (!clean(endValue) || endsOn) && (!endsOn || endsOn >= startsOn)) {
      entries.push({ line: row.line, toolId: tool.id, areaKey: key(areaLabel), areaName: areaLabel, usersCount: users, startsOn: isoDate(startsOn), endsOn: endsOn ? isoDate(endsOn) : null });
    }
  }

  const pending = [];
  for (const entry of entries) {
    const area = areasByName.get(entry.areaKey);
    const areaId = area?.id || `novo:${entry.areaKey}`;
    const candidate = { toolId: entry.toolId, areaId, start: entry.startsOn, end: entry.endsOn };
    const conflict = [...knownPeriods, ...pending].some((period) => period.toolId === candidate.toolId && period.areaId === candidate.areaId && overlaps(period, candidate));
    if (conflict) errors.push(`Linha ${entry.line}: o período de uso se sobrepõe a um período já cadastrado ou informado neste arquivo.`);
    else pending.push(candidate);
  }
  if (errors.length) return { errors, entries: [], newAreas: [] };
  const newAreas = [...new Map(entries.filter((entry) => !areasByName.has(entry.areaKey)).map((entry) => [entry.areaKey, entry.areaName])).values()];
  return { errors: [], entries, newAreas };
}
