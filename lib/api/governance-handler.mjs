import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { claraConfigured, fetchClaraSpend } from "../clara-client.mjs";
import { fetchDriveSpend, googleDriveConfigured } from "../drive-spend.mjs";
import { getUsdBrl } from "../fx.mjs";
import { applyUsageGovernance, buildDriveGovernancePayload, buildGovernancePayload, periodRange } from "../governance-metrics.mjs";
import { listCatalog, loadStoredSpend, toolsStoreConfigured } from "../tools-store.mjs";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));

async function readJson(relativePath) {
  return JSON.parse(await readFile(resolve(ROOT, relativePath), "utf8"));
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

export async function governancePayload({ period = "year", year = null, month = null, vertical = "all", now = new Date() } = {}) {
  let driveError = null;
  if (toolsStoreConfigured()) {
    try {
      const [stored, catalog] = await Promise.all([loadStoredSpend(), listCatalog()]);
      if (stored.records.length) {
        const payload = buildDriveGovernancePayload({ ...stored, year, month, vertical, now });
        return applyUsageGovernance({ ...payload, source: "supabase+drive", warning: `Supabase: ${stored.files.length} planilha(s), ${stored.records.length} lançamento(s) único(s).` }, catalog);
      }
    } catch (error) {
      console.error("[supabase-tools]", error);
      driveError = error;
    }
  }
  if (googleDriveConfigured()) {
    try {
      const drive = await fetchDriveSpend();
      return buildDriveGovernancePayload({ ...drive, year, month, vertical, now });
    } catch (error) {
      console.error("[google-drive]", error);
      driveError = error;
    }
  }
  const [inventory, redundancies, headcount, fxRate] = await Promise.all([
    readJson("data/inventory.json"),
    readJson("data/redundancies.json"),
    readJson("data/headcount.json"),
    getUsdBrl(),
  ]);
  let spend = { transactions: [], reimbursements: [] };
  let source = "seed";
  let warning = driveError
    ? `Google Drive indisponível; exibindo inventário seed. ${driveError.message}`
    : "Clara não configurada; exibindo custos estimados do inventário.";
  if (claraConfigured()) {
    try {
      const range = periodRange(period, now);
      spend = await fetchClaraSpend({ ...range, root: ROOT, waitForFresh: false });
      source = spend.claraRefreshing && !spend.transactions.length && !spend.reimbursements.length ? "seed" : "clara+seed";
      warning = spend.claraRefreshing
        ? "Atualizando dados da Clara em segundo plano; exibindo o último inventário disponível."
        : spend.claraPartialError
          ? `Clara parcialmente disponível. ${spend.claraPartialError}`
          : null;
    } catch (error) {
      warning = `Clara indisponível; exibindo seed. ${error.message}`;
    }
  }
  const payload = buildGovernancePayload({
    inventory, redundancies, headcount, fxRate, period, vertical, now, source, warning, ...spend,
  });
  const selectedYear = Number(year) || now.getUTCFullYear();
  const selectedMonth = Number(month) || null;
  return {
    ...payload,
    filters: { ...payload.filters, year: selectedYear, month: selectedMonth },
    availablePeriods: [{ year: selectedYear, months: Array.from({ length: 12 }, (_, index) => index + 1) }],
  };
}

export async function handleGovernanceApi(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    sendJson(res, 405, { error: "Método não permitido." });
    return;
  }
  try {
    const url = new URL(req.url || "/api/governance", "http://localhost");
    const payload = await governancePayload({
      period: url.searchParams.get("period") || "year",
      year: url.searchParams.get("year"),
      month: url.searchParams.get("month"),
      vertical: url.searchParams.get("vertical") || "all",
    });
    sendJson(res, 200, payload);
  } catch (error) {
    console.error("[governance]", error);
    sendJson(res, 500, { error: "Falha ao carregar o dashboard.", code: "GOVERNANCE_LOAD_FAILED" });
  }
}
