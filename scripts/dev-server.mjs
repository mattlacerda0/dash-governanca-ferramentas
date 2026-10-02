import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { handleGovernanceApi } from "../lib/api/governance-handler.mjs";
import { handleCronSync, handleToolsApi } from "../lib/api/tools-handler.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

function loadEnv(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || match[2].startsWith("#")) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[match[1]]) process.env[match[1]] = value;
  }
}

loadEnv(join(ROOT, ".env"));
loadEnv(join(ROOT, ".env.local"));
const PORT = Number(process.env.PORT || 3012);
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://localhost:${PORT}`);
  if (url.pathname === "/api/governance") {
    await handleGovernanceApi(req, res);
    return;
  }
  const toolsResource = {
    "/api/auth-config": "auth-config", "/api/session": "session", "/api/catalog": "catalog", "/api/areas": "areas", "/api/categories": "categories",
    "/api/usage": "usage", "/api/usage-template": "usage-template", "/api/usage-import": "usage-import", "/api/access": "access", "/api/reimbursements": "reimbursements", "/api/reimbursement-decision": "reimbursement-decision", "/api/sync": "sync",
  }[url.pathname];
  if (toolsResource) {
    await handleToolsApi(req, res, toolsResource);
    return;
  }
  if (url.pathname === "/api/cron-sync") {
    await handleCronSync(req, res);
    return;
  }
  if (url.pathname === "/api/health") {
    res.writeHead(200, { "Content-Type": MIME[".json"], "Cache-Control": "no-store" });
    res.end(JSON.stringify({ ok: true, service: "dash-governanca-ferramentas" }));
    return;
  }
  const relative = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname).replace(/^\/+/, "");
  let filePath = resolve(ROOT, "public", relative);
  const publicRoot = resolve(ROOT, "public");
  if (!filePath.startsWith(publicRoot) || !existsSync(filePath) || !statSync(filePath).isFile()) {
    filePath = join(publicRoot, "index.html");
  }
  const contentType = MIME[extname(filePath).toLowerCase()] || "application/octet-stream";
  res.writeHead(200, { "Content-Type": contentType, "Cache-Control": "no-cache" });
  res.end(readFileSync(filePath));
});

server.listen(PORT, () => {
  console.log(`Governança de ferramentas em http://localhost:${PORT}`);
  console.log(process.env.CLARA_CLIENT_ID ? "Clara configurada" : "Clara ausente — usando seed");
});
