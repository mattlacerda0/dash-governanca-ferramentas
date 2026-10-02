import { handleGovernanceApi } from "../lib/api/governance-handler.mjs";
import { handleCronSync, handleToolsApi } from "../lib/api/tools-handler.mjs";

const TOOL_RESOURCES = {
  "/api/auth-config": "auth-config",
  "/api/session": "session",
  "/api/catalog": "catalog",
  "/api/areas": "areas",
  "/api/categories": "categories",
  "/api/usage": "usage",
  "/api/usage-template": "usage-template",
  "/api/usage-import": "usage-import",
  "/api/access": "access",
  "/api/reimbursements": "reimbursements",
  "/api/reimbursement-decision": "reimbursement-decision",
  "/api/sync": "sync",
};

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  const pathname = new URL(req.url || "/api", "http://localhost").pathname;

  if (pathname === "/api/governance") return handleGovernanceApi(req, res);
  if (pathname === "/api/cron-sync") return handleCronSync(req, res);
  if (pathname === "/api/health") return send(res, 200, { ok: true, service: "dash-governanca-ferramentas" });

  const resource = TOOL_RESOURCES[pathname];
  if (resource) return handleToolsApi(req, res, resource);

  return send(res, 404, { error: "Endpoint não encontrado." });
}
