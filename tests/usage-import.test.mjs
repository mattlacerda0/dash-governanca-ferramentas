import assert from "node:assert/strict";
import test from "node:test";
import { createUsageTemplate, readUsageSpreadsheet, validateUsageRows } from "../lib/usage-import.mjs";

const tools = [{ id: "tool-figma", nome: "Figma" }, { id: "tool-cursor", nome: "Cursor" }];
const areas = [{ id: "area-marketing", nome: "Marketing" }];

test("gera o modelo com todas as ferramentas cadastradas", () => {
  const rows = readUsageSpreadsheet(createUsageTemplate(tools));
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.values[0]), ["Figma", "Cursor"]);
});

test("valida linhas válidas, áreas novas e fim opcional", () => {
  const result = validateUsageRows([
    { line: 2, values: ["Figma", "Marketing", 4, "01/01/2026", "30/04/2026"] },
    { line: 3, values: ["Cursor", "Produto", 2, new Date("2026-08-01T00:00:00Z"), ""] },
  ], { tools, areas, periods: [] });

  assert.deepEqual(result.errors, []);
  assert.equal(result.entries.length, 2);
  assert.deepEqual(result.newAreas, ["Produto"]);
  assert.equal(result.entries[1].endsOn, null);
});

test("rejeita a carga inteira para dados inválidos", () => {
  const result = validateUsageRows([
    { line: 2, values: ["Ferramenta desconhecida", "Marketing", 1, "01/01/2026", ""] },
    { line: 3, values: ["Figma", "", 0, "data", ""] },
  ], { tools, areas, periods: [] });

  assert.equal(result.entries.length, 0);
  assert.equal(result.newAreas.length, 0);
  assert.equal(result.errors.length, 4);
});

test("bloqueia sobreposições existentes e dentro do mesmo arquivo", () => {
  const existing = [{ ferramenta_id: "tool-figma", area_id: "area-marketing", data_inicio: "2026-01-01", data_fim: "2026-03-31" }];
  const result = validateUsageRows([
    { line: 2, values: ["Figma", "Marketing", 3, "15/03/2026", "30/04/2026"] },
    { line: 3, values: ["Cursor", "Produto", 2, "01/08/2026", ""] },
    { line: 4, values: ["Cursor", "Produto", 2, "15/08/2026", ""] },
  ], { tools, areas, periods: existing });

  assert.equal(result.entries.length, 0);
  assert.equal(result.errors.length, 2);
});
