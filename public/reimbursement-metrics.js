const STATUSES = ["pendente", "aprovado", "recusado"];

function validDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function filterReimbursements(items, { year, month } = {}) {
  return (items || []).filter((item) => {
    const [itemYear, itemMonth] = String(item.data_despesa || "").split("-");
    return (!year || itemYear === String(year)) && (!month || month === "all" || itemMonth === String(month).padStart(2, "0"));
  });
}

export function reimbursementMetrics(items, filters) {
  const filtered = filterReimbursements(items, filters);
  const status = Object.fromEntries(STATUSES.map((key) => [key, { count: 0, value: 0 }]));
  const monthly = new Map();
  const tools = new Map();
  const decisionDurations = [];

  for (const item of filtered) {
    const value = Number(item.valor) || 0;
    const current = status[item.situacao] || status.pendente;
    current.count += 1;
    current.value += value;
    const key = String(item.data_despesa || "").slice(0, 7);
    if (key) {
      const month = monthly.get(key) || { month: key, value: 0, count: 0 };
      month.value += value;
      month.count += 1;
      monthly.set(key, month);
    }
    const tool = String(item.ferramenta_nome || "Sem ferramenta informada");
    const toolSummary = tools.get(tool) || { label: tool, value: 0, count: 0 };
    toolSummary.value += value;
    toolSummary.count += 1;
    tools.set(tool, toolSummary);
    const created = validDate(item.criado_em);
    const decided = validDate(item.decidido_em);
    if (item.situacao !== "pendente" && created && decided && decided >= created) decisionDurations.push(decided - created);
  }

  const decided = status.aprovado.count + status.recusado.count;
  return {
    items: filtered,
    pending: filtered.filter((item) => item.situacao === "pendente"),
    completed: filtered.filter((item) => item.situacao === "aprovado" || item.situacao === "recusado"),
    status,
    monthly: [...monthly.values()].sort((a, b) => a.month.localeCompare(b.month)),
    tools: [...tools.values()].sort((a, b) => b.value - a.value || a.label.localeCompare(b.label)),
    totalValue: filtered.reduce((sum, item) => sum + (Number(item.valor) || 0), 0),
    decisionRate: filtered.length ? decided / filtered.length : null,
    averageDecisionMs: decisionDurations.length ? decisionDurations.reduce((sum, value) => sum + value, 0) / decisionDurations.length : null,
    decidedCount: decisionDurations.length,
  };
}
