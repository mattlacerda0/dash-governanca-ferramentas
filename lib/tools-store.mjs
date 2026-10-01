import { createHash } from "node:crypto";

const DEFAULT_SCHEMA = "_dashboard_ferramentas";

function trim(value) { return String(value || "").trim(); }
function normalize(value) {
  return trim(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function toolsStoreConfigured(env = process.env) {
  return Boolean(trim(env.TOOLS_SUPABASE_URL) && trim(env.TOOLS_SUPABASE_SERVICE_ROLE_KEY));
}

function config(env = process.env) {
  return {
    url: trim(env.TOOLS_SUPABASE_URL).replace(/\/$/, ""),
    key: trim(env.TOOLS_SUPABASE_SERVICE_ROLE_KEY),
    anonKey: trim(env.TOOLS_SUPABASE_ANON_KEY),
    schema: trim(env.TOOLS_SUPABASE_SCHEMA) || DEFAULT_SCHEMA,
  };
}

async function request(path, { method = "GET", body, query, env, headers = {} } = {}) {
  const current = config(env);
  if (!current.url || !current.key) throw new Error("Supabase de ferramentas não configurado.");
  const url = new URL(path, `${current.url}/`);
  for (const [key, value] of Object.entries(query || {})) if (value !== undefined && value !== null) url.searchParams.set(key, value);
  const response = await fetch(url, {
    method,
    headers: {
      apikey: current.key,
      Authorization: `Bearer ${current.key}`,
      "Content-Type": "application/json",
      "Accept-Profile": current.schema,
      "Content-Profile": current.schema,
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(payload?.message || payload?.hint || `Supabase respondeu HTTP ${response.status}.`);
  return payload;
}

export async function verifySession(token, { env = process.env } = {}) {
  const current = config(env);
  if (!token || !current.url || !current.key) return null;
  const response = await fetch(`${current.url}/auth/v1/user`, {
    headers: { apikey: current.key, Authorization: `Bearer ${token}` },
  });
  if (!response.ok) return null;
  const user = await response.json();
  const email = trim(user.email).toLocaleLowerCase("pt-BR");
  if (!email) return null;
  const roles = await request("rest/v1/user_roles", { env, query: { select: "role", email: `eq.${email}`, limit: "1" } });
  return { id: user.id, email, role: roles?.[0]?.role || "member", isAdmin: roles?.[0]?.role === "admin" };
}

export function financialFingerprint(record) {
  const values = [record.status, record.amount, record.date?.toISOString().slice(0, 10), record.supplier, record.note, record.includedAt, record.includedBy]
    .map((value) => trim(value).toLocaleLowerCase("pt-BR"));
  return createHash("sha256").update(values.join("|")).digest("hex");
}

async function fetchRows(table, query, env) {
  return request(`rest/v1/${table}`, { env, query: { select: "*", ...query } });
}

export async function listCatalog({ env = process.env } = {}) {
  const [tools, areas, categories, periods] = await Promise.all([
    fetchRows("tools", { order: "name.asc" }, env), fetchRows("areas", { order: "name.asc" }, env),
    fetchRows("tool_functional_categories", { order: "name.asc" }, env), fetchRows("tool_area_usage_periods", { order: "starts_on.desc" }, env),
  ]);
  return { tools, areas, categories, periods };
}

export async function loadStoredSpend({ env = process.env } = {}) {
  const [tools, categories, entries, files] = await Promise.all([
    fetchRows("tools", {}, env), fetchRows("tool_functional_categories", {}, env),
    fetchRows("financial_entries", {}, env), fetchRows("drive_files", {}, env),
  ]);
  const category = new Map(categories.map((item) => [item.id, item.name]));
  const tool = new Map(tools.map((item) => [item.id, item]));
  return {
    files: files.map((item) => ({ id: item.drive_file_id, name: item.name, modifiedTime: item.modified_at })),
    records: entries.map((entry) => {
      const current = tool.get(entry.tool_id);
      return {
        toolId: current?.normalized_name || entry.tool_id, tool: current?.name || entry.supplier,
        category: category.get(current?.functional_category_id) || "Sem dado informado", amount: Number(entry.amount),
        date: new Date(`${entry.occurred_on}T00:00:00Z`), supplier: entry.supplier, note: entry.note || "", status: entry.status || "",
        includedAt: entry.included_at || "", includedBy: entry.included_by || "", sourceFile: entry.drive_file_id || "",
      };
    }),
  };
}

export async function saveCatalogTool(input, { env = process.env } = {}) {
  const body = {
    name: trim(input.name), normalized_name: normalize(input.name), functional_category_id: input.functionalCategoryId || null,
    tool_type: input.toolType === "structural" ? "structural" : "optional", category_source: "manual", active: input.active !== false,
  };
  if (!body.name) throw new Error("Informe o nome da ferramenta.");
  return request("rest/v1/tools", { method: "POST", env, headers: { Prefer: "resolution=merge-duplicates,return=representation" }, body: [body] });
}

export async function saveArea(name, { env = process.env } = {}) {
  const clean = trim(name);
  if (!clean) throw new Error("Informe o nome da área.");
  return request("rest/v1/areas", { method: "POST", env, headers: { Prefer: "resolution=merge-duplicates,return=representation" }, body: [{ name: clean }] });
}

export async function saveUsagePeriod(input, { env = process.env } = {}) {
  const body = {
    tool_id: input.toolId, area_id: input.areaId, users_count: Number(input.usersCount), starts_on: input.startsOn, ends_on: input.endsOn || null,
  };
  if (!body.tool_id || !body.area_id || !Number.isInteger(body.users_count) || body.users_count < 1 || !body.starts_on) throw new Error("Preencha ferramenta, área, usuários e início.");
  return request("rest/v1/tool_area_usage_periods", { method: "POST", env, headers: { Prefer: "return=representation" }, body: [body] });
}

export async function createReimbursement(input, session, { env = process.env } = {}) {
  const body = {
    requester_id: session.id, requester_email: session.email, tool_id: input.toolId || null, tool_name: trim(input.toolName),
    amount: Number(input.amount), expense_date: input.expenseDate, justification: trim(input.justification),
  };
  if (!body.tool_name || !Number.isFinite(body.amount) || body.amount <= 0 || !body.expense_date || !body.justification) throw new Error("Preencha ferramenta, valor, data e justificativa.");
  return request("rest/v1/reimbursement_requests", { method: "POST", env, headers: { Prefer: "return=representation" }, body: [body] });
}

export async function listReimbursements(session, { env = process.env } = {}) {
  const query = session.isAdmin ? { order: "created_at.desc" } : { requester_id: `eq.${session.id}`, order: "created_at.desc" };
  return fetchRows("reimbursement_requests", query, env);
}

export async function decideReimbursement(id, input, session, { env = process.env } = {}) {
  if (!session.isAdmin) throw new Error("Acesso administrativo necessário.");
  const status = input.status === "approved" ? "approved" : "rejected";
  return request(`rest/v1/reimbursement_requests?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH", env, headers: { Prefer: "return=representation" },
    body: { status, decision_comment: trim(input.comment) || null, decided_by: session.id, decided_by_email: session.email, decided_at: new Date().toISOString() },
  });
}

export async function syncDriveRecords({ files, records }, { env = process.env } = {}) {
  if (!toolsStoreConfigured(env)) throw new Error("Supabase de ferramentas não configurado.");
  const categories = [...new Set(records.map((record) => record.category).filter(Boolean))];
  if (categories.length) await request("rest/v1/tool_functional_categories", {
    method: "POST", env, headers: { Prefer: "resolution=merge-duplicates" }, body: categories.map((name) => ({ name })),
  });
  const savedCategories = await fetchRows("tool_functional_categories", {}, env);
  const categoryId = new Map(savedCategories.map((item) => [item.name, item.id]));
  const existingTools = await fetchRows("tools", {}, env);
  const existingNames = new Set(existingTools.map((item) => item.normalized_name));
  const incomingTools = [...new Map(records.map((record) => [record.toolId, record])).values()]
    .filter((record) => !existingNames.has(record.toolId)).map((record) => ({
    name: record.tool, normalized_name: record.toolId, functional_category_id: categoryId.get(record.category) || null, tool_type: "optional", category_source: "import",
  }));
  if (incomingTools.length) await request("rest/v1/tools", { method: "POST", env, headers: { Prefer: "return=minimal" }, body: incomingTools });
  const tools = await fetchRows("tools", {}, env);
  const toolId = new Map(tools.map((item) => [item.normalized_name, item.id]));
  const fileId = new Map((files || []).map((file) => [file.name, file.id]));
  if (files?.length) await request("rest/v1/drive_files", {
    method: "POST", env, headers: { Prefer: "resolution=merge-duplicates" },
    body: files.map((file) => ({ drive_file_id: file.id, name: file.name, modified_at: file.modifiedTime || null })),
  });
  const entries = records.map((record) => ({
    fingerprint: financialFingerprint(record), tool_id: toolId.get(record.toolId), drive_file_id: fileId.get(record.sourceFile) || null,
    supplier: record.supplier, amount: record.amount, occurred_on: record.date.toISOString().slice(0, 10), status: record.status || null,
    note: record.note || null, included_at: record.includedAt || null, included_by: record.includedBy || null,
  })).filter((entry) => entry.tool_id);
  if (entries.length) await request("rest/v1/financial_entries", { method: "POST", env, headers: { Prefer: "resolution=ignore-duplicates" }, body: entries });
  return { files: files?.length || 0, records: entries.length };
}
