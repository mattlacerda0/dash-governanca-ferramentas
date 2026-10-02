import assert from "node:assert/strict";
import test from "node:test";
import { filterReimbursements, reimbursementMetrics } from "../public/reimbursement-metrics.mjs";

const items = [
  {
    id: "pending",
    situacao: "pendente",
    valor: "100.00",
    ferramenta_nome: "Figma",
    data_despesa: "2026-09-12",
    criado_em: "2026-09-12T10:00:00.000Z",
    decidido_em: null,
  },
  {
    id: "approved",
    situacao: "aprovado",
    valor: "200.00",
    ferramenta_nome: "Figma",
    data_despesa: "2026-09-20",
    criado_em: "2026-09-20T10:00:00.000Z",
    decidido_em: "2026-09-22T10:00:00.000Z",
  },
  {
    id: "rejected",
    situacao: "recusado",
    valor: "50.00",
    ferramenta_nome: "Cursor",
    data_despesa: "2026-08-10",
    criado_em: "2026-08-10T10:00:00.000Z",
    decidido_em: "2026-08-11T10:00:00.000Z",
  },
];

test("separa pendências do histórico e filtra pela data da despesa", () => {
  const filtered = filterReimbursements(items, { year: "2026", month: "09" });
  const metrics = reimbursementMetrics(items, { year: "2026", month: "09" });

  assert.equal(filtered.length, 2);
  assert.deepEqual(metrics.pending.map((item) => item.id), ["pending"]);
  assert.deepEqual(metrics.completed.map((item) => item.id), ["approved"]);
  assert.deepEqual(metrics.status, {
    pendente: { count: 1, value: 100 },
    aprovado: { count: 1, value: 200 },
    recusado: { count: 0, value: 0 },
  });
});

test("calcula evolução, ranking e prazo médio apenas com decisões do período", () => {
  const metrics = reimbursementMetrics(items, { year: "2026", month: "09" });

  assert.deepEqual(metrics.monthly, [{ month: "2026-09", count: 2, value: 300 }]);
  assert.deepEqual(metrics.tools, [{ label: "Figma", count: 2, value: 300 }]);
  assert.equal(metrics.decisionRate, 0.5);
  assert.equal(metrics.averageDecisionMs, 2 * 24 * 60 * 60 * 1000);
  assert.equal(metrics.decidedCount, 1);
});

test("mantém métricas ausentes explícitas quando não existem solicitações", () => {
  const metrics = reimbursementMetrics([], { year: "2026", month: "09" });

  assert.deepEqual(metrics.pending, []);
  assert.deepEqual(metrics.completed, []);
  assert.equal(metrics.decisionRate, null);
  assert.equal(metrics.averageDecisionMs, null);
  assert.equal(metrics.decidedCount, 0);
});
