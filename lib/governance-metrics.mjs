const PERIOD_MONTHS = { last_month: 1, quarter: 3, year: 12 };

export function normalizePeriod(value) {
  return Object.hasOwn(PERIOD_MONTHS, value) ? value : "year";
}

export function periodRange(period, now = new Date()) {
  const months = PERIOD_MONTHS[normalizePeriod(period)];
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59));
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - months + 1, 1));
  return { start, end, months };
}

export function filterTools(tools, vertical = "all") {
  if (!vertical || vertical === "all") return tools.filter((tool) => tool.usedInPE);
  return tools.filter((tool) => tool.usedInPE && tool.verticals.includes(vertical));
}

export function matchTool(text, tools) {
  const normalized = String(text || "").toLocaleLowerCase("pt-BR");
  if (!normalized) return null;
  return tools.find((tool) => [tool.name, ...(tool.aliases || [])]
    .some((alias) => normalized.includes(String(alias).toLocaleLowerCase("pt-BR")))) || null;
}

function amountOf(record) {
  const candidates = [
    record?.amount, record?.totalAmount, record?.localAmount,
    record?.amount?.value, record?.amount?.amount, record?.total?.value,
    record?.amountValue?.amount, record?.localAmount?.amount,
  ];
  const found = candidates.find((value) => Number.isFinite(Number(value)));
  return Number(found || 0);
}

function currencyOf(record) {
  return String(record?.amountValue?.currency || record?.localAmount?.currency || record?.currency || "BRL").toUpperCase();
}

function descriptionOf(record) {
  return [
    record?.merchant?.name, record?.merchantName, record?.description,
    record?.concept, record?.establishment, record?.commerce,
  ].filter(Boolean).join(" ");
}

function dateOf(record) {
  const value = record?.transactionDate || record?.operationDate || record?.date
    || record?.createdAt || record?.expenseDate || record?.paymentDate
    || record?.audit?.expenseDate || record?.audit?.requestCreationDate;
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.valueOf()) ? date : null;
}

export function aggregateClaraTransactions(records, tools, fxRate = 1) {
  const matched = [];
  for (const record of records || []) {
    const tool = matchTool(descriptionOf(record), tools);
    if (!tool) continue;
    const amount = amountOf(record);
    matched.push({
      toolId: tool.id,
      amount: currencyOf(record) === "USD" ? amount * fxRate : amount,
      date: dateOf(record),
      source: record,
    });
  }
  return matched;
}

export function buildGovernancePayload({
  inventory,
  redundancies,
  headcount,
  transactions = [],
  reimbursements = [],
  vertical = "all",
  period = "year",
  fxRate = 1,
  now = new Date(),
  source = "seed",
  warning = null,
}) {
  const allTools = inventory.tools || [];
  const tools = filterTools(allTools, vertical);
  const range = periodRange(period, now);
  const matchedTransactions = aggregateClaraTransactions(transactions, allTools, fxRate)
    .filter((item) => item.date && item.date >= range.start && item.date <= range.end);

  const realizedByTool = Object.create(null);
  for (const item of matchedTransactions) {
    realizedByTool[item.toolId] = (realizedByTool[item.toolId] || 0) + item.amount;
  }

  const monthlyCost = tools.reduce((sum, tool) => {
    const estimated = tool.currency === "USD" ? tool.monthlyCost * fxRate : tool.monthlyCost;
    return sum + estimated;
  }, 0);

  const visibleIds = new Set(tools.map((tool) => tool.id));
  const periodRealized = matchedTransactions
    .filter((item) => visibleIds.has(item.toolId))
    .reduce((sum, item) => sum + item.amount, 0);

  const months = Array.from({ length: range.months }, (_, index) => {
    const date = new Date(Date.UTC(range.end.getUTCFullYear(), range.end.getUTCMonth() - range.months + 1 + index, 1));
    return date.toISOString().slice(0, 7);
  });
  const hcByMonth = Object.fromEntries((headcount || []).map((item) => [item.month, item.headcount]));
  const latestHc = [...(headcount || [])].reverse().find((item) => months.includes(item.month))?.headcount || 0;
  const series = months.map((month) => {
    const realized = matchedTransactions
      .filter((item) => visibleIds.has(item.toolId) && item.date?.toISOString().startsWith(month))
      .reduce((sum, item) => sum + item.amount, 0);
    return {
      month,
      cost: realized || monthlyCost,
      headcount: hcByMonth[month] || latestHc,
    };
  });

  const table = tools.map((tool) => ({
    ...tool,
    estimatedBrl: tool.currency === "USD" ? tool.monthlyCost * fxRate : tool.monthlyCost,
    realizedBrl: realizedByTool[tool.id] || null,
  }));
  const paidByEmployee = table.filter((tool) => tool.paidByEmployee);

  return {
    generatedAt: new Date().toISOString(),
    source,
    warning,
    filters: { period: normalizePeriod(period), vertical, range: { start: range.start, end: range.end } },
    fx: { usdBrl: fxRate },
    kpis: {
      totalTools: inventory.companyTotals.tools,
      peTools: tools.length,
      redundancyRate: inventory.companyTotals.redundantTools / inventory.companyTotals.tools,
      monthlyEstimated: monthlyCost,
      periodRealized,
      reimbursementRate: paidByEmployee.length / Math.max(tools.length, 1),
      costPerHead: monthlyCost / Math.max(latestHc, 1),
      headcount: latestHc,
    },
    charts: {
      costShare: table.filter((tool) => tool.estimatedBrl > 0)
        .sort((a, b) => b.estimatedBrl - a.estimatedBrl)
        .map((tool) => ({ label: tool.name, value: tool.estimatedBrl })),
      sectorVolume: Object.entries(inventory.companyTotals.sectorVolumes)
        .map(([label, value]) => ({ label, value })),
      monthly: series,
    },
    tools: table,
    reimbursements: paidByEmployee,
    claraReimbursements: reimbursements,
    redundancies,
    verticals: ["Technology", "Intelligence", "Operations", "Product", "Architecture", "Design", "CX", "CM", "Gestão"],
  };
}

const UNSPECIFIED = "Sem dado informado";

function driveCalendar(records, year, month, now) {
  const available = new Map();
  for (const record of records || []) {
    if (!record.date) continue;
    const recordYear = record.date.getUTCFullYear();
    const recordMonth = record.date.getUTCMonth() + 1;
    if (!available.has(recordYear)) available.set(recordYear, new Set());
    available.get(recordYear).add(recordMonth);
  }
  const years = [...available.keys()].sort((a, b) => b - a);
  const selectedYear = years.includes(Number(year)) ? Number(year) : years[0] || now.getUTCFullYear();
  const selectedMonth = Number(month) >= 1 && Number(month) <= 12 ? Number(month) : null;
  const start = new Date(Date.UTC(selectedYear, selectedMonth ? selectedMonth - 1 : 0, 1));
  const end = new Date(Date.UTC(selectedYear, selectedMonth || 12, 0, 23, 59, 59));
  return {
    start,
    end,
    year: selectedYear,
    month: selectedMonth,
    available: years.map((value) => ({ year: value, months: Array.from({ length: 12 }, (_, index) => index + 1) })),
  };
}

export function buildDriveGovernancePayload({ records, files = [], vertical = "all", year = null, month = null, now = new Date() }) {
  const calendar = driveCalendar(records, year, month, now);
  const range = { start: calendar.start, end: calendar.end, months: calendar.month ? 1 : 12 };
  const inPeriod = (records || []).filter((record) => record.date
    && record.date >= range.start && record.date <= range.end);
  const categories = [...new Set(inPeriod.map((record) => record.category).filter(Boolean))].sort();
  const selected = vertical === "all" ? inPeriod : inPeriod.filter((record) => record.category === vertical);
  const byTool = new Map();
  for (const record of selected) {
    const current = byTool.get(record.toolId) || {
      id: record.toolId,
      name: record.tool,
      category: record.category || UNSPECIFIED,
      verticals: [record.category || UNSPECIFIED],
      owner: UNSPECIFIED,
      approver: UNSPECIFIED,
      monthlyCost: 0,
      estimatedBrl: 0,
      realizedBrl: 0,
      redundant: null,
      paidByEmployee: null,
      opportunity: UNSPECIFIED,
    };
    current.monthlyCost += record.amount;
    current.estimatedBrl += record.amount;
    current.realizedBrl += record.amount;
    byTool.set(record.toolId, current);
  }
  const tools = [...byTool.values()].sort((a, b) => b.realizedBrl - a.realizedBrl || a.name.localeCompare(b.name, "pt-BR"));
  const monthly = Array.from({ length: range.months }, (_, index) => {
    const date = new Date(Date.UTC(range.end.getUTCFullYear(), range.end.getUTCMonth() - range.months + 1 + index, 1));
    const month = date.toISOString().slice(0, 7);
    return {
      month,
      cost: selected.filter((record) => record.date.toISOString().startsWith(month))
        .reduce((sum, record) => sum + record.amount, 0),
      headcount: null,
    };
  });
  const sectorVolume = Object.entries(selected.reduce((totals, record) => {
    totals[record.category || UNSPECIFIED] = (totals[record.category || UNSPECIFIED] || 0) + 1;
    return totals;
  }, {})).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  const total = tools.reduce((sum, tool) => sum + tool.realizedBrl, 0);

  return {
    generatedAt: new Date().toISOString(),
    dataMode: "drive",
    source: "google-drive",
    warning: `Google Drive: ${files.length} planilha(s), ${records.length} lançamento(s) único(s).`,
    filters: { year: calendar.year, month: calendar.month, vertical, range: { start: range.start, end: range.end } },
    availablePeriods: calendar.available,
    fx: { usdBrl: null },
    kpis: {
      totalTools: tools.length,
      peTools: tools.length,
      redundancyRate: null,
      monthlyEstimated: total,
      periodRealized: total,
      reimbursementRate: null,
      costPerHead: null,
      headcount: null,
    },
    charts: {
      costShare: tools.map((tool) => ({ label: tool.name, value: tool.realizedBrl })),
      sectorVolume,
      monthly,
    },
    tools,
    reimbursements: [],
    claraReimbursements: [],
    redundancies: [],
    verticals: categories,
  };
}
