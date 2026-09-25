import { createPrivateKey, createSign } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const cache = new Map();

const CATEGORY_RULES = [
  [/anthropic|claude|openai|chatgpt|gemini|cursor|manus|lovable|antonella|davinci|tactiq|vidow|deemos|turbo.?scribe/i, "Inteligência artificial"],
  [/aws|amazon|digitalocean|cloudflare|supabase|firebase|vercel|uptimerobot|baserow|github|expo/i, "Infraestrutura e desenvolvimento"],
  [/slack|zoom|calendly|clickup|atlassian|jira|wrike|notion|google workspace|clicksign|d4sign/i, "Produtividade e colaboração"],
  [/adobe|figma|canva|artlist|vimeo|veed|capcut|mobbin|webinarjam|vturb/i, "Design e conteúdo"],
  [/activecampaign|adheart|vidiq|utmify|typeform|google analytics|olx|zap|watii|z-api|unnichat/i, "Marketing, vendas e atendimento"],
  [/clara|asaas|vindi|paddle|apple/i, "Financeiro e pagamentos"],
];

function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}

export function normalizeGooglePrivateKey(value) {
  let key = String(value || "").trim();
  if (key.startsWith("{")) {
    try {
      key = JSON.parse(key).private_key || key;
    } catch {
      // The crypto layer reports an actionable error for an invalid JSON value.
    }
  }
  key = key.replace(/\\n/g, "\n");
  if (/^-----BEGIN [A-Z ]+-----/.test(key)) {
    key = key
      .replace(/(-----BEGIN [A-Z ]+-----)(?!\n)/, "$1\n")
      .replace(/(?<!\n)(-----END [A-Z ]+-----)/, "\n$1");
  }
  return key;
}

function normalize(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR").replace(/[^a-z0-9]+/g, " ").trim();
}

function slug(value) {
  return normalize(value).replace(/\s+/g, "-") || "sem-nome";
}

function parseNumber(value) {
  if (Number.isFinite(Number(value))) return Number(value);
  const parsed = Number(String(value || "").replace(/\./g, "").replace(",", ".").replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function normalizeSpreadsheetDate(value) {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) {
    return new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()));
  }
  const iso = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date;
}

function firstValue(row, names) {
  const wanted = new Set(names.map(normalize));
  for (const [key, value] of Object.entries(row)) if (wanted.has(normalize(key))) return value;
  return null;
}

function categoryFor(supplier, note) {
  const search = `${supplier} ${note}`;
  return CATEGORY_RULES.find(([pattern]) => pattern.test(search))?.[1] || "Outras plataformas";
}

function canonicalTool(supplier) {
  const name = String(supplier || "").trim();
  const found = CATEGORY_RULES.find(([pattern]) => pattern.test(name));
  if (/anthropic/i.test(name)) return "Claude AI";
  if (/cursor/i.test(name)) return "Cursor";
  if (/atlassian/i.test(name)) return "Atlassian / Jira";
  if (/adobe/i.test(name)) return "Adobe";
  if (/digitalocean/i.test(name)) return "DigitalOcean";
  if (/watii/i.test(name)) return "Wati";
  if (/z-?api/i.test(name)) return "Z-API";
  if (found) return name.replace(/\b\w/g, (char) => char.toUpperCase());
  return name || "Sem dado informado";
}

function findHeader(rows) {
  return rows.findIndex((row) => row.some((cell) => normalize(cell) === "fornecedor razao social")
    && row.some((cell) => normalize(cell) === "valor da conta"));
}

export function parseWorkbook(buffer, sourceFile = "") {
  const XLSX = require("xlsx");
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const records = [];
  for (const sheetName of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: null, raw: true });
    const headerIndex = findHeader(rows);
    if (headerIndex < 0) continue;
    const headers = rows[headerIndex].map((value) => String(value || ""));
    for (const values of rows.slice(headerIndex + 1)) {
      const row = Object.fromEntries(headers.map((header, index) => [header, values[index]]));
      const supplier = firstValue(row, ["Fornecedor (Razão Social)"]);
      const amount = parseNumber(firstValue(row, ["Valor da Conta"]));
      const date = normalizeSpreadsheetDate(firstValue(row, ["Data de Registro"]));
      if (!supplier || !date || !amount) continue;
      const note = firstValue(row, ["Observação"]);
      const status = firstValue(row, ["Situação"]);
      const includedAt = firstValue(row, ["Inclusão"]);
      const includedBy = firstValue(row, ["Incluído por"]);
      const tool = canonicalTool(supplier);
      records.push({
        toolId: slug(tool), tool, category: categoryFor(supplier, note), amount, date,
        supplier: String(supplier), note: String(note || ""), status: String(status || ""),
        includedAt: String(includedAt || ""), includedBy: String(includedBy || ""), sourceFile,
      });
    }
  }
  return records;
}

export function deduplicateRecords(records) {
  const unique = new Map();
  for (const record of records) {
    const key = [record.status, record.amount, record.date?.toISOString(), record.supplier, record.note, record.includedAt, record.includedBy]
      .map(normalize).join("|");
    if (!unique.has(key)) unique.set(key, record);
  }
  return [...unique.values()];
}

function createAssertion(config) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(JSON.stringify({ iss: config.email, scope: "https://www.googleapis.com/auth/drive.readonly", aud: TOKEN_URL, iat: now, exp: now + 3600 }));
  const input = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(input);
  signer.end();
  const signature = signer.sign(createPrivateKey(normalizeGooglePrivateKey(config.privateKey))).toString("base64url");
  return `${input}.${signature}`;
}

async function request(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`Google Drive respondeu HTTP ${response.status}.`);
  return response;
}

async function token(config) {
  if (config.oauthRefreshToken) {
    const body = new URLSearchParams({
      client_id: config.oauthClientId,
      client_secret: config.oauthClientSecret,
      refresh_token: config.oauthRefreshToken,
      grant_type: "refresh_token",
    });
    const response = await request(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
    const json = await response.json();
    return json.access_token;
  }
  const body = new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: createAssertion(config) });
  const response = await request(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  const json = await response.json();
  return json.access_token;
}

export function googleDriveConfigured(env = process.env) {
  const hasFolder = Boolean(env.GOOGLE_DRIVE_FOLDER_ID?.trim());
  const hasPersonalOAuth = Boolean(env.GOOGLE_OAUTH_CLIENT_ID?.trim() && env.GOOGLE_OAUTH_CLIENT_SECRET?.trim() && env.GOOGLE_OAUTH_REFRESH_TOKEN?.trim());
  const hasServiceAccount = Boolean(env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim() && env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.trim());
  return hasFolder && (hasPersonalOAuth || hasServiceAccount);
}

export async function fetchDriveSpend({ env = process.env } = {}) {
  const config = {
    folderId: env.GOOGLE_DRIVE_FOLDER_ID,
    email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    privateKey: env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
    oauthClientId: env.GOOGLE_OAUTH_CLIENT_ID,
    oauthClientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
    oauthRefreshToken: env.GOOGLE_OAUTH_REFRESH_TOKEN,
  };
  const ttl = Number(env.GOOGLE_DRIVE_CACHE_TTL_MS || 900000);
  const cached = cache.get(config.folderId);
  if (cached && Date.now() - cached.createdAt < ttl) return cached.value;
  const accessToken = await token(config);
  const params = new URLSearchParams({
    q: `'${config.folderId}' in parents and trashed = false and mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'`,
    orderBy: "createdTime", fields: "files(id,name,modifiedTime)", supportsAllDrives: "true", includeItemsFromAllDrives: "true", pageSize: "1000",
  });
  const listing = await request(`${DRIVE_API}/files?${params}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  const { files = [] } = await listing.json();
  const all = await Promise.all(files.map(async (file) => {
    const response = await request(`${DRIVE_API}/files/${file.id}?alt=media&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${accessToken}` } });
    return parseWorkbook(Buffer.from(await response.arrayBuffer()), file.name);
  }));
  const value = { files, records: deduplicateRecords(all.flat()) };
  cache.set(config.folderId, { createdAt: Date.now(), value });
  return value;
}
