import test from "node:test";
import assert from "node:assert/strict";
import { financialFingerprint, reimbursementQueryForApproval, reimbursementQueryForUser, toolsStoreConfigured } from "../lib/tools-store.mjs";

test("configuração do Supabase exige URL e chave de serviço", () => {
  assert.equal(toolsStoreConfigured({ TOOLS_SUPABASE_URL: "https://example.supabase.co" }), false);
  assert.equal(toolsStoreConfigured({ TOOLS_SUPABASE_SERVICE_ROLE_KEY: "secret" }), false);
  assert.equal(toolsStoreConfigured({ TOOLS_SUPABASE_URL: "https://example.supabase.co", TOOLS_SUPABASE_SERVICE_ROLE_KEY: "secret" }), true);
});

test("fingerprint financeiro é estável e diferencia lançamentos distintos", () => {
  const base = {
    status: "Pago", amount: 125.5, date: new Date("2026-01-10T00:00:00.000Z"), supplier: "Ferramenta A",
    note: "Plano mensal", includedAt: "2026-01-10", includedBy: "Financeiro",
  };
  assert.equal(financialFingerprint(base), financialFingerprint({ ...base }));
  assert.notEqual(financialFingerprint(base), financialFingerprint({ ...base, amount: 125.51 }));
});

test("solicitações pessoais são filtradas mesmo para administradores", () => {
  const administrator = { id: "user-1", isAdmin: true };
  assert.deepEqual(reimbursementQueryForUser(administrator), { solicitante_id: "eq.user-1", order: "criado_em.desc" });
  assert.deepEqual(reimbursementQueryForApproval(administrator), { order: "criado_em.desc" });
  assert.throws(() => reimbursementQueryForApproval({ id: "user-2", isAdmin: false }), /administrativo/);
});
