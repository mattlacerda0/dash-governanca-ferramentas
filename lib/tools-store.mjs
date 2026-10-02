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
  const profiles = await request("rest/v1/perfis_acesso", { env, query: { select: "perfil", email: `eq.${email}`, limit: "1" } });
  return { id: user.id, email, perfil: profiles?.[0]?.perfil || "membro", isAdmin: profiles?.[0]?.perfil === "administrador" };
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
    fetchRows("ferramentas", { order: "nome.asc" }, env), fetchRows("areas", { order: "nome.asc" }, env),
    fetchRows("categorias_funcionais", { order: "nome.asc" }, env), fetchRows("periodos_uso_ferramenta_area", { order: "data_inicio.desc" }, env),
  ]);
  return { tools, areas, categories, periods };
}

export async function loadStoredSpend({ env = process.env } = {}) {
  const [tools, categories, entries, files] = await Promise.all([
    fetchRows("ferramentas", {}, env), fetchRows("categorias_funcionais", {}, env),
    fetchRows("lancamentos_financeiros", {}, env), fetchRows("arquivos_drive", {}, env),
  ]);
  const category = new Map(categories.map((item) => [item.id, item.nome]));
  const tool = new Map(tools.map((item) => [item.id, item]));
  return {
    files: files.map((item) => ({ id: item.arquivo_drive_id, name: item.nome, modifiedTime: item.modificado_em })),
    records: entries.map((entry) => {
      const current = tool.get(entry.ferramenta_id);
      return {
        toolId: current?.nome_normalizado || entry.ferramenta_id, tool: current?.nome || entry.fornecedor,
        category: category.get(current?.categoria_funcional_id) || "Sem dado informado", amount: Number(entry.valor),
        date: new Date(`${entry.data_lancamento}T00:00:00Z`), supplier: entry.fornecedor, note: entry.observacao || "", status: entry.situacao || "",
        includedAt: entry.incluido_em || "", includedBy: entry.incluido_por || "", sourceFile: entry.arquivo_drive_id || "",
      };
    }),
  };
}

export async function saveCatalogTool(input, { env = process.env } = {}) {
  const body = {
    nome: trim(input.name), nome_normalizado: normalize(input.name), categoria_funcional_id: input.functionalCategoryId || null,
    tipo_ferramenta: input.toolType === "estruturante" ? "estruturante" : "opcional", origem_categoria: "manual", ativo: input.ativo !== false,
  };
  if (!body.nome) throw new Error("Informe o nome da ferramenta.");
  return request("rest/v1/ferramentas", { method: "POST", env, headers: { Prefer: "resolution=merge-duplicates,return=representation" }, body: [body] });
}

export async function updateCatalogTool(id, input, { env = process.env } = {}) {
  const body = {
    tipo_ferramenta: input.toolType === "estruturante" ? "estruturante" : "opcional",
    categoria_funcional_id: input.functionalCategoryId || null,
    origem_categoria: "manual",
  };
  if (!trim(id)) throw new Error("Ferramenta não encontrada.");
  return request(`rest/v1/ferramentas?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH", env, headers: { Prefer: "return=representation" }, body,
  });
}

export async function saveArea(name, { env = process.env } = {}) {
  const clean = trim(name);
  if (!clean) throw new Error("Informe o nome da área.");
  return request("rest/v1/areas", { method: "POST", env, headers: { Prefer: "resolution=merge-duplicates,return=representation" }, body: [{ nome: clean }] });
}

export async function saveFunctionalCategory(name, { env = process.env } = {}) {
  const clean = trim(name);
  if (!clean) throw new Error("Informe o nome da funcionalidade principal.");
  return request("rest/v1/categorias_funcionais", {
    method: "POST", env, headers: { Prefer: "resolution=merge-duplicates,return=representation" }, body: [{ nome: clean }],
  });
}

export async function saveUsagePeriod(input, { env = process.env } = {}) {
  const body = {
    ferramenta_id: input.toolId, area_id: input.areaId, quantidade_usuarios: Number(input.usersCount), data_inicio: input.startsOn, data_fim: input.endsOn || null,
  };
  if (!body.ferramenta_id || !body.area_id || !Number.isInteger(body.quantidade_usuarios) || body.quantidade_usuarios < 1 || !body.data_inicio) throw new Error("Preencha ferramenta, área, usuários e início.");
  return request("rest/v1/periodos_uso_ferramenta_area", { method: "POST", env, headers: { Prefer: "return=representation" }, body: [body] });
}

function usagePeriodBody(input) {
  const body = {
    ferramenta_id: input.toolId, area_id: input.areaId, quantidade_usuarios: Number(input.usersCount), data_inicio: input.startsOn, data_fim: input.endsOn || null,
  };
  if (!body.ferramenta_id || !body.area_id || !Number.isInteger(body.quantidade_usuarios) || body.quantidade_usuarios < 1 || !body.data_inicio) {
    throw new Error("Preencha ferramenta, área, usuários e início.");
  }
  return body;
}

export async function updateUsagePeriod(id, input, { env = process.env } = {}) {
  if (!trim(id)) throw new Error("Período de uso não encontrado.");
  return request(`rest/v1/periodos_uso_ferramenta_area?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH", env, headers: { Prefer: "return=representation" }, body: usagePeriodBody(input),
  });
}

export async function deleteUsagePeriod(id, { env = process.env } = {}) {
  if (!trim(id)) throw new Error("Período de uso não encontrado.");
  return request(`rest/v1/periodos_uso_ferramenta_area?id=eq.${encodeURIComponent(id)}`, {
    method: "DELETE", env, headers: { Prefer: "return=representation" },
  });
}

export async function createReimbursement(input, session, { env = process.env } = {}) {
  const body = {
    solicitante_id: session.id, solicitante_email: session.email, ferramenta_id: input.toolId || null, ferramenta_nome: trim(input.toolName),
    valor: Number(input.amount), data_despesa: input.expenseDate, justificativa: trim(input.justification),
  };
  if (!body.ferramenta_nome || !Number.isFinite(body.valor) || body.valor <= 0 || !body.data_despesa || !body.justificativa) throw new Error("Preencha ferramenta, valor, data e justificativa.");
  return request("rest/v1/solicitacoes_reembolso", { method: "POST", env, headers: { Prefer: "return=representation" }, body: [body] });
}

export function reimbursementQueryForUser(session) {
  if (!trim(session?.id)) throw new Error("Sessão inválida.");
  return { solicitante_id: `eq.${session.id}`, order: "criado_em.desc" };
}

export function reimbursementQueryForApproval(session) {
  if (!session?.isAdmin) throw new Error("Acesso administrativo necessário.");
  return { order: "criado_em.desc" };
}

export async function listReimbursements(session, { env = process.env } = {}) {
  return fetchRows("solicitacoes_reembolso", reimbursementQueryForUser(session), env);
}

export async function listReimbursementsForApproval(session, { env = process.env } = {}) {
  return fetchRows("solicitacoes_reembolso", reimbursementQueryForApproval(session), env);
}

function administratorEmail(value) {
  const email = trim(value).toLocaleLowerCase("pt-BR");
  if (!/^[^\s@]+@quartavia\.com\.br$/i.test(email)) throw new Error("Informe um e-mail corporativo @quartavia.com.br.");
  return email;
}

export async function listAdministrators(session, { env = process.env } = {}) {
  if (!session?.isAdmin) throw new Error("Acesso administrativo necessário.");
  return fetchRows("perfis_acesso", { select: "id,email,perfil,criado_em", perfil: "eq.administrador", order: "email.asc" }, env);
}

export async function addAdministrator(email, session, { env = process.env } = {}) {
  if (!session?.isAdmin) throw new Error("Acesso administrativo necessário.");
  return request("rest/v1/perfis_acesso", {
    method: "POST", env, headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: [{ email: administratorEmail(email), perfil: "administrador" }],
  });
}

export async function removeAdministrator(id, session, { env = process.env } = {}) {
  if (!session?.isAdmin) throw new Error("Acesso administrativo necessário.");
  const profiles = await listAdministrators(session, { env });
  const profile = profiles.find((item) => item.id === id);
  if (!profile) throw new Error("Administrador não encontrado.");
  if (profile.email === session.email) throw new Error("Você não pode remover o seu próprio acesso administrativo.");
  if (profiles.length <= 1) throw new Error("Mantenha ao menos um administrador com acesso.");
  return request(`rest/v1/perfis_acesso?id=eq.${encodeURIComponent(id)}`, {
    method: "DELETE", env, headers: { Prefer: "return=representation" },
  });
}

export async function decideReimbursement(id, input, session, { env = process.env } = {}) {
  if (!session.isAdmin) throw new Error("Acesso administrativo necessário.");
  const situacao = input.situacao === "aprovado" ? "aprovado" : "recusado";
  return request(`rest/v1/solicitacoes_reembolso?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH", env, headers: { Prefer: "return=representation" },
    body: { situacao, comentario_decisao: trim(input.comment) || null, decidido_por: session.id, decisor_email: session.email, decidido_em: new Date().toISOString() },
  });
}

export async function syncDriveRecords({ files, records }, { env = process.env } = {}) {
  if (!toolsStoreConfigured(env)) throw new Error("Supabase de ferramentas não configurado.");
  const categories = [...new Set(records.map((record) => record.category).filter(Boolean))];
  if (categories.length) await request("rest/v1/categorias_funcionais", {
    method: "POST", env, headers: { Prefer: "resolution=merge-duplicates" }, body: categories.map((name) => ({ nome: name })),
  });
  const savedCategories = await fetchRows("categorias_funcionais", {}, env);
  const categoryId = new Map(savedCategories.map((item) => [item.nome, item.id]));
  const existingTools = await fetchRows("ferramentas", {}, env);
  const existingNames = new Set(existingTools.map((item) => item.nome_normalizado));
  const incomingTools = [...new Map(records.map((record) => [record.toolId, record])).values()]
    .filter((record) => !existingNames.has(record.toolId)).map((record) => ({
    nome: record.tool, nome_normalizado: record.toolId, categoria_funcional_id: categoryId.get(record.category) || null, tipo_ferramenta: "opcional", origem_categoria: "importacao",
  }));
  if (incomingTools.length) await request("rest/v1/ferramentas", { method: "POST", env, headers: { Prefer: "return=minimal" }, body: incomingTools });
  const tools = await fetchRows("ferramentas", {}, env);
  const toolId = new Map(tools.map((item) => [item.nome_normalizado, item.id]));
  const fileId = new Map((files || []).map((file) => [file.name, file.id]));
  if (files?.length) await request("rest/v1/arquivos_drive", {
    method: "POST", env, headers: { Prefer: "resolution=merge-duplicates" },
    body: files.map((file) => ({ arquivo_drive_id: file.id, nome: file.name, modificado_em: file.modifiedTime || null })),
  });
  const entries = records.map((record) => ({
    chave_deduplicacao: financialFingerprint(record), ferramenta_id: toolId.get(record.toolId), arquivo_drive_id: fileId.get(record.sourceFile) || null,
    fornecedor: record.supplier, valor: record.amount, data_lancamento: record.date.toISOString().slice(0, 10), situacao: record.status || null,
    observacao: record.note || null, incluido_em: record.includedAt || null, incluido_por: record.includedBy || null,
  })).filter((entry) => entry.ferramenta_id);
  if (entries.length) await request("rest/v1/lancamentos_financeiros", { method: "POST", env, headers: { Prefer: "resolution=ignore-duplicates" }, body: entries });
  return { files: files?.length || 0, records: entries.length };
}
