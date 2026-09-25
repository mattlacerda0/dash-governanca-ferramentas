const FALLBACK_USD_BRL = 5.45;
let cache = null;

export async function getUsdBrl({ fetchImpl = fetch, now = Date.now() } = {}) {
  if (cache && cache.expiresAt > now) return cache.value;
  try {
    const response = await fetchImpl("https://economia.awesomeapi.com.br/last/USD-BRL", {
      signal: AbortSignal.timeout(5000),
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`FX HTTP ${response.status}`);
    const body = await response.json();
    const value = Number(body?.USDBRL?.bid);
    if (!Number.isFinite(value) || value <= 0) throw new Error("Cotação inválida");
    cache = { value, expiresAt: now + 6 * 60 * 60 * 1000 };
    return value;
  } catch {
    return FALLBACK_USD_BRL;
  }
}

export { FALLBACK_USD_BRL };
