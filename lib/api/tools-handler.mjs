import { fetchDriveSpend } from "../drive-spend.mjs";
import {
  createReimbursement, decideReimbursement, listCatalog, listReimbursements, saveArea, saveCatalogTool,
  saveUsagePeriod, syncDriveRecords, toolsStoreConfigured, verifySession,
} from "../tools-store.mjs";

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

async function bodyOf(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new Error("JSON inválido."); }
}

async function sessionOf(req) {
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  return verifySession(token);
}

async function requireSession(req, res, admin = false) {
  const session = await sessionOf(req);
  if (!session) { send(res, 401, { error: "Faça login corporativo para continuar." }); return null; }
  if (admin && !session.isAdmin) { send(res, 403, { error: "Acesso disponível apenas para administradores." }); return null; }
  return session;
}

export function authConfig() {
  return {
    configured: toolsStoreConfigured(),
    supabaseUrl: process.env.TOOLS_SUPABASE_URL || null,
    anonKey: process.env.TOOLS_SUPABASE_ANON_KEY || null,
  };
}

export async function handleToolsApi(req, res, resource) {
  try {
    if (resource === "auth-config" && req.method === "GET") { send(res, 200, authConfig()); return; }
    if (!toolsStoreConfigured()) { send(res, 503, { error: "Integração Supabase ainda não configurada." }); return; }
    if (resource === "session" && req.method === "GET") {
      const session = await sessionOf(req);
      if (!session) { send(res, 401, { error: "Sessão inválida." }); return; }
      send(res, 200, session); return;
    }
    if (resource === "catalog") {
      const session = await requireSession(req, res, req.method !== "GET");
      if (!session) return;
      if (req.method === "GET") { send(res, 200, await listCatalog()); return; }
      if (req.method === "POST") { send(res, 201, await saveCatalogTool(await bodyOf(req))); return; }
    }
    if (resource === "areas" && req.method === "POST") {
      if (!await requireSession(req, res, true)) return;
      send(res, 201, await saveArea((await bodyOf(req)).name)); return;
    }
    if (resource === "usage" && req.method === "POST") {
      if (!await requireSession(req, res, true)) return;
      send(res, 201, await saveUsagePeriod(await bodyOf(req))); return;
    }
    if (resource === "reimbursements") {
      const session = await requireSession(req, res);
      if (!session) return;
      if (req.method === "GET") { send(res, 200, await listReimbursements(session)); return; }
      if (req.method === "POST") { send(res, 201, await createReimbursement(await bodyOf(req), session)); return; }
    }
    if (resource === "reimbursement-decision" && req.method === "PATCH") {
      const session = await requireSession(req, res, true);
      if (!session) return;
      const input = await bodyOf(req);
      send(res, 200, await decideReimbursement(input.id, input, session)); return;
    }
    if (resource === "sync" && req.method === "POST") {
      if (!await requireSession(req, res, true)) return;
      send(res, 200, await syncDriveRecords(await fetchDriveSpend())); return;
    }
    send(res, 405, { error: "Método não permitido." });
  } catch (error) {
    const status = /sobrep|duplicate|conflict/i.test(error.message) ? 409 : 400;
    send(res, status, { error: error.message || "Falha ao processar solicitação." });
  }
}

export function toolsHandler(resource) {
  return (req, res) => handleToolsApi(req, res, resource);
}

export async function handleCronSync(req, res) {
  const expected = process.env.TOOLS_CRON_SECRET;
  const provided = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!expected || provided !== expected) { send(res, 401, { error: "Não autorizado." }); return; }
  try { send(res, 200, await syncDriveRecords(await fetchDriveSpend())); }
  catch (error) { send(res, 500, { error: error.message || "Falha na sincronização." }); }
}
