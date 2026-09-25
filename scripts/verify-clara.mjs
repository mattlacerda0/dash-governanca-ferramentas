import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { claraConfigured, verifyClaraConnection } from "../lib/clara-client.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

function loadEnv(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || match[2].startsWith("#") || process.env[match[1]]) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
}

loadEnv(join(ROOT, ".env"));
loadEnv(join(ROOT, ".env.local"));

if (!claraConfigured()) {
  console.error(JSON.stringify({ ok: false, error: "Configuração Clara incompleta." }));
  process.exitCode = 1;
} else {
  try {
    const resources = await verifyClaraConnection({ root: ROOT });
    console.log(JSON.stringify({ ok: true, resources }));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: error?.message || "Falha de conexão Clara." }));
    process.exitCode = 1;
  }
}
