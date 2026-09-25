import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { request as httpsRequest } from "node:https";

const PAGE_SIZE = 100;
const RETRY_DELAYS_MS = [500, 1_000];

class ClaraHttpError extends Error {
  constructor(status, message, retryAfterMs = null) {
    super(`Clara HTTP ${status}${message ? `: ${message}` : ""}`);
    this.name = "ClaraHttpError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

function required(name, env) {
  const value = String(env[name] || "").trim();
  if (!value) throw new Error(`Variável ${name} ausente`);
  return value;
}

function resolveSecretPath(value, root) {
  return isAbsolute(value) ? value : resolve(root, value);
}

function configFromEnv(env = process.env, root = process.cwd()) {
  return {
    baseUrl: String(env.CLARA_BASE_URL || "https://public-api.br.clara.com").replace(/\/$/, ""),
    clientId: required("CLARA_CLIENT_ID", env),
    clientSecret: required("CLARA_CLIENT_SECRET", env),
    cert: readFileSync(resolveSecretPath(required("CLARA_CERT_PATH", env), root)),
    key: readFileSync(resolveSecretPath(required("CLARA_KEY_PATH", env), root)),
    taxIdentifier: String(env.CLARA_TAX_IDENTIFIER || "").trim() || null,
    timeout: Number(env.CLARA_TIMEOUT_MS || 15000),
    cacheTtlMs: Number(env.CLARA_CACHE_TTL_MS || 900000),
  };
}

function retryAfterMs(value) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null;
}

function mtlsJson(url, { method = "GET", headers = {}, cert, key, timeout = 15000 } = {}) {
  return new Promise((resolvePromise, reject) => {
    const request = httpsRequest(url, {
      method,
      cert,
      key,
      rejectUnauthorized: true,
      timeout,
      headers: { Accept: "application/json", ...headers },
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let body = {};
        try { body = text ? JSON.parse(text) : {}; } catch { /* API returned non-JSON. */ }
        if ((response.statusCode || 500) >= 400) {
          reject(new ClaraHttpError(
            response.statusCode || 500,
            body?.message || body?.error || "Resposta inválida da API Clara",
            retryAfterMs(response.headers["retry-after"]),
          ));
          return;
        }
        resolvePromise(body);
      });
    });
    request.on("timeout", () => request.destroy(new Error("Timeout na API Clara")));
    request.on("error", reject);
    request.end();
  });
}

function extractItems(body) {
  if (Array.isArray(body)) return body;
  for (const key of ["content", "data", "items", "results", "reimbursements", "transactions"]) {
    if (Array.isArray(body?.[key])) return body[key];
    if (Array.isArray(body?.data?.[key])) return body.data[key];
  }
  return [];
}

function pageCount(body) {
  const value = Number(body?.totalPages ?? body?.page?.totalPages ?? body?.data?.totalPages);
  return Number.isFinite(value) ? value : null;
}

function requestHeaders(token, config) {
  return {
    Authorization: `Bearer ${token}`,
    ...(config.taxIdentifier ? { "X-Tax-Identifier": config.taxIdentifier } : {}),
  };
}

export function createClaraClient({
  requestJson = mtlsJson,
  now = () => Date.now(),
  sleep = (duration) => new Promise((resolvePromise) => setTimeout(resolvePromise, duration)),
} = {}) {
  let tokenCache = null;

  async function requestWithRetry(url, options) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await requestJson(url, options);
      } catch (error) {
        if (error?.status !== 429 || attempt >= RETRY_DELAYS_MS.length) throw error;
        await sleep(error.retryAfterMs ?? RETRY_DELAYS_MS[attempt]);
      }
    }
  }

  async function getToken(config, { forceRefresh = false } = {}) {
    const currentTime = now();
    if (!forceRefresh && tokenCache && tokenCache.expiresAt > currentTime + 60_000) return tokenCache.value;
    const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
    const body = await requestWithRetry(`${config.baseUrl}/oauth/token`, {
      method: "POST",
      cert: config.cert,
      key: config.key,
      timeout: config.timeout,
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": "0",
      },
    });
    if (!body.access_token) throw new Error("Token Clara ausente na resposta");
    tokenCache = {
      value: body.access_token,
      expiresAt: currentTime + Number(body.expires_in || 3600) * 1000,
    };
    return tokenCache.value;
  }

  async function authenticatedRequest(url, config) {
    let token = await getToken(config);
    try {
      return await requestWithRetry(url, {
        cert: config.cert,
        key: config.key,
        timeout: config.timeout,
        headers: requestHeaders(token, config),
      });
    } catch (error) {
      if (error?.status !== 401) throw error;
      token = await getToken(config, { forceRefresh: true });
      return requestWithRetry(url, {
        cert: config.cert,
        key: config.key,
        timeout: config.timeout,
        headers: requestHeaders(token, config),
      });
    }
  }

  async function listAll(path, params, config) {
    const items = [];
    for (let page = 0; ; page += 1) {
      const url = new URL(`${config.baseUrl}${path}`);
      url.searchParams.set("page", String(page));
      url.searchParams.set("size", String(PAGE_SIZE));
      Object.entries(params || {}).forEach(([key, value]) => value && url.searchParams.set(key, value));
      const body = await authenticatedRequest(url, config);
      const batch = extractItems(body);
      items.push(...batch);
      const totalPages = pageCount(body);
      if (!batch.length || batch.length < PAGE_SIZE || (totalPages !== null && page + 1 >= totalPages)) break;
    }
    return items;
  }

  async function fetchSpend({ start, end, config }) {
    const startDate = start.toISOString().slice(0, 10);
    const endDate = end.toISOString().slice(0, 10);
    const results = await Promise.allSettled([
      listAll("/api/v3/transactions", {
        operationDateRangeStart: startDate,
        operationDateRangeEnd: endDate,
      }, config),
      listAll("/api/v3/reimbursements", {
        expenseDateStart: startDate,
        expenseDateEnd: endDate,
      }, config),
    ]);
    const transactions = results[0].status === "fulfilled" ? results[0].value : [];
    const reimbursements = results[1].status === "fulfilled" ? results[1].value : [];
    const failures = results.filter((result) => result.status === "rejected").map((result) => result.reason?.message);
    if (failures.length && !transactions.length && !reimbursements.length) throw new Error(failures.join(" | "));
    return { transactions, reimbursements, claraPartialError: failures[0] || null };
  }

  async function verify(config) {
    const summaries = await Promise.all(["transactions", "reimbursements"].map(async (resource) => {
      const url = new URL(`${config.baseUrl}/api/v3/${resource}`);
      url.searchParams.set("page", "0");
      url.searchParams.set("size", "1");
      const body = await authenticatedRequest(url, config);
      const items = extractItems(body);
      return [resource, {
        status: 200,
        totalElements: Number(body?.totalElements ?? 0),
        totalPages: pageCount(body),
        contentLength: items.length,
        firstRecordFields: items[0] ? Object.keys(items[0]).sort() : [],
      }];
    }));
    return Object.fromEntries(summaries);
  }

  return { fetchSpend, verify };
}

export function createSpendCache({ now = () => Date.now() } = {}) {
  const entries = new Map();

  function startLoad(key, ttlMs, load) {
    const existing = entries.get(key);
    if (existing?.inFlight) return existing.inFlight;
    const inFlight = Promise.resolve().then(load).then((value) => {
      entries.set(key, { value, expiresAt: now() + ttlMs });
      return value;
    }).catch((error) => {
      if (existing?.value) entries.set(key, existing);
      else entries.delete(key);
      throw error;
    });
    entries.set(key, { ...existing, inFlight });
    return inFlight;
  }

  return {
    async get(key, ttlMs, load) {
      const cached = entries.get(key);
      if (cached?.value && cached.expiresAt > now()) return cached.value;
      return startLoad(key, ttlMs, load);
    },
    staleWhileRevalidate(key, ttlMs, load, fallback) {
      const cached = entries.get(key);
      if (cached?.value && cached.expiresAt > now()) return { value: cached.value, refreshing: false };
      void startLoad(key, ttlMs, load).catch(() => {});
      return { value: cached?.value || fallback, refreshing: true };
    },
  };
}

const defaultClient = createClaraClient();
const spendCache = createSpendCache();

export async function fetchClaraSpend({
  start,
  end,
  env = process.env,
  root = process.cwd(),
  client = defaultClient,
  cache = spendCache,
  waitForFresh = true,
} = {}) {
  const config = configFromEnv(env, root);
  const startDate = start.toISOString().slice(0, 10);
  const endDate = end.toISOString().slice(0, 10);
  const cacheKey = [config.baseUrl, config.taxIdentifier || "default", startDate, endDate].join("|");
  const load = () => client.fetchSpend({ start, end, config });
  if (waitForFresh) return cache.get(cacheKey, config.cacheTtlMs, load);
  const result = cache.staleWhileRevalidate(cacheKey, config.cacheTtlMs, load, {
    transactions: [],
    reimbursements: [],
    claraPartialError: null,
  });
  return { ...result.value, claraRefreshing: result.refreshing };
}

export async function verifyClaraConnection({ env = process.env, root = process.cwd(), client = defaultClient } = {}) {
  return client.verify(configFromEnv(env, root));
}

export function claraConfigured(env = process.env) {
  return ["CLARA_CLIENT_ID", "CLARA_CLIENT_SECRET", "CLARA_CERT_PATH", "CLARA_KEY_PATH"]
    .every((key) => Boolean(String(env[key] || "").trim()));
}
