import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  aggregateClaraTransactions,
  buildDriveGovernancePayload,
  buildGovernancePayload,
  filterTools,
  matchTool,
  periodRange,
} from "../lib/governance-metrics.mjs";
import { createClaraClient, createSpendCache } from "../lib/clara-client.mjs";
import { googleDriveConfigured, normalizeGooglePrivateKey, normalizeSpreadsheetDate } from "../lib/drive-spend.mjs";

const root = new URL("../", import.meta.url);
const readJson = async (path) => JSON.parse(await readFile(new URL(path, root), "utf8"));

test("inventário contém 23 ferramentas P&E e nove verticais", async () => {
  const inventory = await readJson("data/inventory.json");
  assert.equal(inventory.tools.length, 23);
  assert.equal(filterTools(inventory.tools, "all").length, 23);
  assert.deepEqual(
    [...new Set(inventory.tools.flatMap((tool) => tool.verticals))].sort(),
    ["Architecture", "CM", "CX", "Design", "Gestão", "Intelligence", "Operations", "Product", "Technology"].sort(),
  );
  assert.ok(inventory.tools.every((tool) => tool.approver === "Ana Gazzo"));
});

test("KPIs do briefing são calculados a partir do inventário", async () => {
  const [inventory, redundancies, headcount] = await Promise.all([
    readJson("data/inventory.json"),
    readJson("data/redundancies.json"),
    readJson("data/headcount.json"),
  ]);
  const payload = buildGovernancePayload({
    inventory, redundancies, headcount, now: new Date("2026-09-09T12:00:00Z"),
  });
  assert.equal(payload.kpis.totalTools, 85);
  assert.equal(payload.kpis.peTools, 23);
  assert.equal(Number(payload.kpis.redundancyRate.toFixed(3)), 0.482);
  assert.equal(payload.reimbursements.length, 4);
  assert.equal(Number(payload.kpis.reimbursementRate.toFixed(3)), 0.174);
  assert.ok(payload.kpis.monthlyEstimated > 7000);
  assert.equal(payload.kpis.headcount, 24);
});

test("filtro de vertical e matching Clara funcionam", async () => {
  const inventory = await readJson("data/inventory.json");
  const technology = filterTools(inventory.tools, "Technology");
  assert.ok(technology.length > 0);
  assert.ok(technology.every((tool) => tool.verticals.includes("Technology")));
  assert.equal(matchTool("Pagamento ATLASSIAN CLOUD", inventory.tools)?.id, "jira");
  assert.equal(matchTool("Amazon Web Services BR", inventory.tools)?.id, "aws");
});

test("períodos retornam janelas esperadas", () => {
  assert.equal(periodRange("last_month", new Date("2026-09-09T12:00:00Z")).months, 1);
  assert.equal(periodRange("quarter", new Date("2026-09-09T12:00:00Z")).months, 3);
  assert.equal(periodRange("year", new Date("2026-09-09T12:00:00Z")).months, 12);
});

test("transações Clara em USD são convertidas para BRL", async () => {
  const inventory = await readJson("data/inventory.json");
  const [transaction] = aggregateClaraTransactions([{
    merchant: { name: "Atlassian Cloud" },
    amountValue: { amount: 10, currency: "USD" },
    audit: { operationDate: "2026-09-01" },
  }], inventory.tools, 5.25);
  assert.equal(transaction.toolId, "jira");
  assert.equal(transaction.amount, 52.5);
});

test("cliente Clara pagina além do limite antigo de 50 páginas", async () => {
  const pages = [];
  const requestJson = async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname === "/oauth/token") return { access_token: "token", expires_in: 3600 };
    if (parsed.pathname.endsWith("/reimbursements")) return { content: [], totalPages: 0 };
    const page = Number(parsed.searchParams.get("page"));
    pages.push(page);
    return { content: Array.from({ length: 100 }, () => ({ page })), totalPages: 52 };
  };
  const client = createClaraClient({ requestJson });
  const spend = await client.fetchSpend({
    start: new Date("2026-01-01T00:00:00Z"),
    end: new Date("2026-01-31T23:59:59Z"),
    config: { baseUrl: "https://clara.test", clientId: "id", clientSecret: "secret", cert: "cert", key: "key" },
  });
  assert.equal(pages.length, 52);
  assert.equal(spend.transactions.length, 5200);
});

test("cliente Clara atualiza token após 401 e aplica retry após 429", async () => {
  const calls = [];
  const pauses = [];
  let tokenRequests = 0;
  let throttled = false;
  const requestJson = async (url, options) => {
    const parsed = new URL(url);
    calls.push({ path: parsed.pathname, authorization: options.headers?.Authorization });
    if (parsed.pathname === "/oauth/token") {
      tokenRequests += 1;
      return { access_token: `token-${tokenRequests}`, expires_in: 3600 };
    }
    if (options.headers.Authorization === "Bearer token-1") throw { status: 401 };
    if (parsed.pathname.endsWith("/transactions") && !throttled) {
      throttled = true;
      throw { status: 429, retryAfterMs: 12 };
    }
    return { content: [], totalPages: 0 };
  };
  const client = createClaraClient({ requestJson, sleep: async (duration) => pauses.push(duration) });
  await client.fetchSpend({
    start: new Date("2026-01-01T00:00:00Z"),
    end: new Date("2026-01-31T23:59:59Z"),
    config: { baseUrl: "https://clara.test", clientId: "id", clientSecret: "secret", cert: "cert", key: "key" },
  });
  assert.ok(tokenRequests >= 2);
  assert.deepEqual(pauses, [12]);
  assert.ok(calls.some((call) => call.authorization === "Bearer token-2"));
});

test("cache reutiliza a carga no TTL e expira depois dele", async () => {
  let currentTime = 0;
  let loads = 0;
  const cache = createSpendCache({ now: () => currentTime });
  const load = async () => ({ invocation: ++loads });
  assert.deepEqual(await cache.get("2026-09", 900, load), { invocation: 1 });
  assert.deepEqual(await cache.get("2026-09", 900, load), { invocation: 1 });
  currentTime = 901;
  assert.deepEqual(await cache.get("2026-09", 900, load), { invocation: 2 });
});

test("cache inicia a atualização Clara sem bloquear a resposta inicial", async () => {
  let resolveLoad;
  const cache = createSpendCache();
  const pendingLoad = new Promise((resolve) => { resolveLoad = resolve; });
  const first = cache.staleWhileRevalidate("2026-09", 900, () => pendingLoad, { source: "seed" });
  assert.equal(first.refreshing, true);
  assert.deepEqual(first.value, { source: "seed" });
  resolveLoad({ source: "clara" });
  await pendingLoad;
  await new Promise((resolve) => setImmediate(resolve));
  const second = cache.staleWhileRevalidate("2026-09", 900, () => ({ source: "new" }), { source: "seed" });
  assert.equal(second.refreshing, false);
  assert.deepEqual(second.value, { source: "clara" });
});

test("dados consolidados do Drive agrupam ferramentas e preservam campos sem origem", () => {
  const records = [
    { toolId: "cursor", tool: "Cursor", category: "Inteligência artificial", amount: 100, date: new Date("2026-09-04T00:00:00Z") },
    { toolId: "cursor", tool: "Cursor", category: "Inteligência artificial", amount: 80, date: new Date("2026-09-20T00:00:00Z") },
    { toolId: "vercel", tool: "Vercel", category: "Infraestrutura e desenvolvimento", amount: 50, date: new Date("2026-09-10T00:00:00Z") },
  ];
  const payload = buildDriveGovernancePayload({
    records,
    files: [{ name: "setembro.xlsx" }],
    period: "last_month",
    now: new Date("2026-09-24T12:00:00Z"),
  });
  assert.equal(payload.source, "google-drive");
  assert.equal(payload.kpis.totalTools, 2);
  assert.equal(payload.kpis.monthlyEstimated, 230);
  assert.equal(payload.tools.find((tool) => tool.id === "cursor").realizedBrl, 180);
  assert.equal(payload.tools.find((tool) => tool.id === "cursor").owner, "Sem dado informado");
  assert.equal(payload.kpis.redundancyRate, null);
});

test("dados consolidados do Drive filtram por ano e mês disponíveis", () => {
  const payload = buildDriveGovernancePayload({
    records: [
      { toolId: "a", tool: "A", category: "Categoria", amount: 10, date: new Date("2026-08-15T00:00:00Z") },
      { toolId: "b", tool: "B", category: "Categoria", amount: 20, date: new Date("2026-09-15T00:00:00Z") },
    ],
    year: 2026,
    month: 9,
    now: new Date("2026-09-24T12:00:00Z"),
  });
  assert.equal(payload.filters.year, 2026);
  assert.equal(payload.filters.month, 9);
  assert.equal(payload.kpis.monthlyEstimated, 20);
  assert.deepEqual(payload.availablePeriods, [{ year: 2026, months: Array.from({ length: 12 }, (_, index) => index + 1) }]);
});

test("datas do Excel preservam o mês informado no fuso local", () => {
  const excelDate = new Date(2026, 1, 1);
  assert.equal(normalizeSpreadsheetDate(excelDate).toISOString().slice(0, 10), "2026-02-01");
  assert.equal(normalizeSpreadsheetDate("2026-01-01 00:00:00").toISOString().slice(0, 10), "2026-01-01");
});

test("chave Google aceita quebras de linha codificadas ou coladas em uma linha", () => {
  const compact = "-----BEGIN PRIVATE KEY-----abc-----END PRIVATE KEY-----";
  assert.equal(normalizeGooglePrivateKey(compact), "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----");
  assert.equal(normalizeGooglePrivateKey("-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----"), "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----");
});

test("Drive aceita credenciais OAuth de conta pessoal", () => {
  assert.equal(googleDriveConfigured({
    GOOGLE_DRIVE_FOLDER_ID: "folder",
    GOOGLE_OAUTH_CLIENT_ID: "client",
    GOOGLE_OAUTH_CLIENT_SECRET: "secret",
    GOOGLE_OAUTH_REFRESH_TOKEN: "refresh",
  }), true);
});
