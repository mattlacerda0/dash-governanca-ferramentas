const state = { payload: null, view: "overview", search: "", costExpanded: false, expandedVerticals: new Set() };
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const number = new Intl.NumberFormat("pt-BR");
const percent = new Intl.NumberFormat("pt-BR", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });
const monthLabel = new Intl.DateTimeFormat("pt-BR", { month: "short" });
const monthName = new Intl.DateTimeFormat("pt-BR", { month: "long" });

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  })[character]);
}

function kpi(label, value, note, variant = "") {
  const missing = value === "Sem dado informado" ? " is-missing" : "";
  return `<article class="kpi ${escapeHtml(variant)}"><div class="kpi-label">${escapeHtml(label)}</div><div class="kpi-value${missing}" title="${escapeHtml(value)}">${escapeHtml(value)}</div><div class="kpi-note">${escapeHtml(note)}</div></article>`;
}

function valueOrMissing(value, formatter) {
  return Number.isFinite(value) ? formatter(value) : "Sem dado informado";
}

function renderKpis(payload) {
  const { kpis } = payload;
  const drive = payload.dataMode === "drive";
  $("#kpis").innerHTML = [
    kpi(drive ? "Ferramentas no período" : "Total de ferramentas QV", valueOrMissing(kpis.totalTools, number.format), drive ? "Fornecedores categorizados" : "Inventário corporativo", "kpi-featured"),
    kpi(drive ? "Ferramentas no recorte" : "Ferramentas P&E", valueOrMissing(kpis.peTools, number.format), drive ? "Após filtros aplicados" : $("#verticalFilter").value === "all" ? "Inventário completo de P&E" : "Recorte da vertical", "kpi-compact"),
    kpi("Índice de redundância", valueOrMissing(kpis.redundancyRate, percent.format), drive ? "Sem dado informado" : "Ferramentas com sobreposição", "kpi-compact"),
    kpi(drive ? "Custo no período" : "Custo mensal P&E", valueOrMissing(kpis.monthlyEstimated, money.format), drive ? "Lançamentos pagos e em atraso" : "Estimativa recorrente", "kpi-highlight"),
    kpi("Taxa de reembolsos", valueOrMissing(kpis.reimbursementRate, percent.format), drive ? "Sem dado informado" : `${payload.reimbursements.length} ferramentas no recorte`, "kpi-compact"),
    kpi("Custo por pessoa", valueOrMissing(kpis.costPerHead, money.format), drive ? "Sem dado informado" : `${number.format(kpis.headcount)} pessoas em P&E`, "kpi-compact"),
  ].join("");
}

function monthText(month) {
  return monthName.format(new Date(2026, month - 1, 1)).replace(/^./, (letter) => letter.toUpperCase());
}

function populateDateFilters(payload) {
  const periods = payload.availablePeriods || [];
  const yearSelect = $("#yearFilter");
  const monthSelect = $("#monthFilter");
  const year = String(payload.filters.year || periods[0]?.year || new Date().getFullYear());
  if (yearSelect.value !== year || yearSelect.options.length !== periods.length) {
    yearSelect.innerHTML = periods.map((item) => `<option value="${item.year}">${item.year}</option>`).join("");
    yearSelect.value = year;
  }
  const period = periods.find((item) => String(item.year) === year);
  const month = payload.filters.month ? String(payload.filters.month) : "all";
  monthSelect.innerHTML = `<option value="all">Todos os meses</option>${(period?.months || []).map((item) => `<option value="${item}">${escapeHtml(monthText(item))}</option>`).join("")}`;
  monthSelect.value = month;
}

function renderBars(container, data, formatter = number.format) {
  if (!data.length) {
    container.innerHTML = '<div class="empty">Sem dado informado.</div>';
    return;
  }
  const max = Math.max(...data.map((item) => item.value), 1);
  container.innerHTML = `<div class="bars">${data.map((item) => `
    <div class="bar-row">
      <span title="${escapeHtml(item.label)}">${escapeHtml(item.label)}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.max(2, (item.value / max) * 100)}%"></div></div>
      <span class="bar-value">${escapeHtml(formatter(item.value))}</span>
    </div>`).join("")}</div>`;
}

function renderCostChart(data) {
  if (!data.length) {
    $("#costChart").innerHTML = '<div class="empty">Sem dado informado.</div>';
    return;
  }
  const collapsed = data.length > 7 && !state.costExpanded;
  const grouped = collapsed
    ? [...data.slice(0, 6), { label: "Outras", value: data.slice(6).reduce((sum, item) => sum + item.value, 0) }]
    : data;
  const total = grouped.reduce((sum, item) => sum + item.value, 0) || 1;
  const colors = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--chart-6)", "var(--color-subtle)"];
  let cursor = 0;
  const segments = grouped.map((item, index) => {
    const start = cursor;
    cursor += item.value / total * 100;
    return `${colors[index % colors.length]} ${start}% ${cursor}%`;
  });
  $("#costChart").innerHTML = `<div class="donut-layout">
    <div class="donut" style="background:conic-gradient(${segments.join(",")})" aria-label="Distribuição de custos"></div>
    <div class="legend${state.costExpanded ? " is-expanded" : ""}">${grouped.map((item, index) => `<div class="legend-row">
      <span class="legend-dot" style="background:${colors[index % colors.length]}"></span>
      <span>${escapeHtml(item.label)}</span><strong>${money.format(item.value)}</strong>
    </div>`).join("")}${data.length > 7 ? `<button class="expand-tools" type="button" data-expand-cost aria-expanded="${String(state.costExpanded)}">${state.costExpanded ? "Mostrar menos" : `+ ${data.length - 6} ferramentas`}</button>` : ""}</div>
  </div>`;
}

function renderMonthlyChart(data) {
  if (!data.length) {
    $("#monthlyChart").innerHTML = '<div class="empty">Sem dados mensais no período.</div>';
    return;
  }
  const width = 900;
  const height = 240;
  const pad = { left: 54, right: 28, top: 20, bottom: 38 };
  const costs = data.map((item) => item.cost);
  const min = Math.min(...costs) * 0.92;
  const max = Math.max(...costs) * 1.05 || 1;
  const x = (index) => pad.left + index * ((width - pad.left - pad.right) / Math.max(data.length - 1, 1));
  const y = (value) => pad.top + (max - value) / Math.max(max - min, 1) * (height - pad.top - pad.bottom);
  const points = data.map((item, index) => `${x(index)},${y(item.cost)}`).join(" ");
  const area = `${pad.left},${height - pad.bottom} ${points} ${x(data.length - 1)},${height - pad.bottom}`;
  const grid = [0, .5, 1].map((ratio) => {
    const value = min + (max - min) * (1 - ratio);
    const py = pad.top + ratio * (height - pad.top - pad.bottom);
    return `<line class="grid" x1="${pad.left}" x2="${width - pad.right}" y1="${py}" y2="${py}"/><text x="0" y="${py + 4}">${escapeHtml(money.format(value).replace(",00", ""))}</text>`;
  }).join("");
  const labels = data.map((item, index) => {
    const date = new Date(`${item.month}-02T00:00:00`);
    return `<text x="${x(index)}" y="${height - 12}" text-anchor="middle">${monthLabel.format(date).replace(".", "")}${item.headcount ? ` · ${item.headcount}` : ""}</text>`;
  }).join("");
  const dots = data.map((item, index) => `<circle class="point" cx="${x(index)}" cy="${y(item.cost)}" r="4"><title>${money.format(item.cost)} · ${item.headcount} pessoas</title></circle>`).join("");
  $("#monthlyChart").innerHTML = `<svg class="line-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Evolução mensal de custos e headcount">
    ${grid}<polygon class="area" points="${area}"/><polyline class="line" points="${points}"/>${dots}${labels}
  </svg>`;
}

function renderVerticals(payload) {
  $("#verticalCards").innerHTML = payload.verticals.map((vertical) => {
    const tools = payload.tools.filter((tool) => tool.verticals.includes(vertical));
    const expanded = state.expandedVerticals.has(vertical);
    const visibleTools = expanded ? tools : tools.slice(0, 6);
    return `<article class="card vertical-card"><header><strong>${escapeHtml(vertical)}</strong><span class="count-pill">${tools.length}</span></header>
      ${tools.length ? `<ul class="vertical-tools${expanded ? " is-expanded" : ""}">${visibleTools.map((tool) => `<li>${escapeHtml(tool.name)}</li>`).join("")}</ul>${tools.length > 6 ? `<button class="expand-tools" type="button" data-expand-vertical="${escapeHtml(vertical)}" aria-expanded="${String(expanded)}">${expanded ? "Mostrar menos" : `+ ${tools.length - 6} ferramentas`}</button>` : ""}` : '<p class="areas">Sem ferramentas neste recorte.</p>'}
    </article>`;
  }).join("");
}

function renderTable() {
  const tools = state.payload?.tools || [];
  const query = state.search.trim().toLocaleLowerCase("pt-BR");
  const filtered = tools.filter((tool) => !query || [
    tool.name, tool.owner, tool.approver, tool.opportunity, ...(tool.verticals || []),
  ].join(" ").toLocaleLowerCase("pt-BR").includes(query));
  $("#toolsTable").innerHTML = filtered.length ? filtered.map((tool) => `<tr>
    <td><strong>${escapeHtml(tool.name)}</strong>${tool.realizedBrl ? `<br><small>Realizado: ${money.format(tool.realizedBrl)}</small>` : ""}</td>
    <td><div class="vertical-tags">${tool.verticals.map((vertical) => `<span class="badge">${escapeHtml(vertical)}</span>`).join("")}</div></td>
    <td>${escapeHtml(tool.owner || "Sem dado informado")}</td>
    <td>${escapeHtml(tool.approver || "Sem dado informado")}</td>
    <td class="num">${valueOrMissing(tool.realizedBrl ?? tool.estimatedBrl, money.format)}</td>
    <td><span class="badge ${tool.redundant === true ? "danger" : tool.redundant === false ? "success" : ""}">${tool.redundant === true ? "Sim" : tool.redundant === false ? "Não" : "Sem dado informado"}</span></td>
    <td>${escapeHtml(tool.opportunity || "Sem dado informado")}</td>
  </tr>`).join("") : '<tr><td colspan="7"><div class="empty">Nenhuma ferramenta encontrada.</div></td></tr>';
  $("#tableCount").textContent = `Exibindo ${filtered.length} de ${tools.length} ferramentas no recorte.`;
}

function renderRedundancies(payload) {
  $("#redundancyCards").innerHTML = payload.redundancies.length ? payload.redundancies.map((item, index) => `<article class="card redundancy-card">
    <p class="eyebrow">Prioridade ${index + 1}</p><h3>${escapeHtml(item.category)}</h3>
    <div class="tool-pair">${item.tools.map(escapeHtml).join(" × ")}</div>
    <div class="areas">${item.areas.map(escapeHtml).join(" · ")}</div>
    <p class="recommendation">${escapeHtml(item.recommendation)}</p>
  </article>`).join("") : '<div class="empty">Sem dado informado.</div>';
}

function renderReimbursements(payload) {
  $("#reimbursementCards").innerHTML = payload.reimbursements.length ? payload.reimbursements.map((tool) => `<article class="card reimbursement-card">
    <div><h3>${escapeHtml(tool.name)}</h3><p>${escapeHtml(tool.owner)} · ${money.format(tool.estimatedBrl)}/mês</p></div>
    <span class="badge danger">Pago pelo colaborador</span>
  </article>`).join("") : '<div class="empty">Nenhuma ferramenta paga por colaborador neste recorte.</div>';
  $("#claraReimbursements").textContent = payload.source === "google-drive"
    ? "Sem dado informado. Os arquivos atuais não identificam reembolsos individualmente."
    : payload.source.includes("clara")
    ? `${number.format(payload.claraReimbursements.length)} reembolsos retornados pela Clara no período selecionado.`
    : "Integração não configurada ou temporariamente indisponível. O inventário seed permanece visível.";
}

function render(payload) {
  state.payload = payload;
  populateDateFilters(payload);
  renderKpis(payload);
  renderCostChart(payload.charts.costShare);
  renderBars($("#sectorChart"), payload.charts.sectorVolume);
  renderMonthlyChart(payload.charts.monthly);
  renderVerticals(payload);
  renderTable();
  renderRedundancies(payload);
  renderReimbursements(payload);
  const sourcePill = $("#sourcePill");
  sourcePill.textContent = payload.source === "google-drive" ? "Google Drive" : payload.source === "clara+seed" ? "Clara + inventário" : "Inventário seed";
  sourcePill.classList.toggle("is-live", payload.source === "clara+seed" || payload.source === "google-drive");
  sourcePill.classList.toggle("is-seed", payload.source !== "clara+seed" && payload.source !== "google-drive");
  $("#warning").textContent = payload.warning || "";
  $("#warning").classList.toggle("hidden", !payload.warning);
  $("#status").classList.add("hidden");
  $("#content").classList.remove("hidden");
}

async function load() {
  state.costExpanded = false;
  state.expandedVerticals.clear();
  document.body.setAttribute("aria-busy", "true");
  $("#status").textContent = "Carregando dados de governança…";
  $("#status").className = "status status-loading";
  $("#content").classList.add("hidden");
  $("#warning").classList.add("hidden");
  const params = new URLSearchParams({ year: $("#yearFilter").value, month: $("#monthFilter").value, vertical: $("#verticalFilter").value });
  try {
    const response = await fetch(`/api/governance?${params}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    if ($("#verticalFilter").options.length === 1) {
      payload.verticals.forEach((vertical) => $("#verticalFilter").add(new Option(vertical, vertical)));
    }
    render(payload);
  } catch (error) {
    $("#status").className = "status status-error";
    $("#status").textContent = `Não foi possível carregar o dashboard: ${error.message}`;
  } finally {
    document.body.removeAttribute("aria-busy");
  }
}

function switchView(view) {
  state.view = view;
  $$(".nav-item").forEach((item) => item.classList.toggle("is-active", item.dataset.view === view));
  $$("[data-view-panel]").forEach((panel) => panel.classList.toggle("is-active", panel.dataset.viewPanel === view));
  const titles = {
    overview: ["Governança de ferramentas", "Custos, stack e eficiência operacional em uma visão única."],
    pe: ["Product & Experience", "Responsáveis, verticais e custos sob governança."],
    redundancies: ["Redundâncias cross-sector", "Oportunidades de unificação de contratos e licenças."],
    reimbursements: ["Reembolsos & Shadow IT", "Assinaturas custeadas por colaboradores e registros Clara."],
  };
  [$("#pageTitle").textContent, $("#pageSubtitle").textContent] = titles[view];
  $("#sidebar").classList.remove("is-open");
  $("#menuButton").setAttribute("aria-expanded", "false");
}

function exportCsv() {
  if (!state.payload) return;
  const fields = ["Ferramenta", "Verticais", "Responsável", "Aprovador", "Custo mensal BRL", "Redundância", "Oportunidade"];
  const rows = state.payload.tools.map((tool) => [
    tool.name, tool.verticals.join(" | "), tool.owner, tool.approver,
    tool.estimatedBrl.toFixed(2), tool.redundant ? "Sim" : "Não", tool.opportunity || "",
  ]);
  const quote = (value) => `"${String(value).replaceAll('"', '""')}"`;
  const csv = "\uFEFF" + [fields, ...rows].map((row) => row.map(quote).join(";")).join("\r\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  link.download = `governanca-ferramentas-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

$$(".nav-item").forEach((item) => item.addEventListener("click", () => switchView(item.dataset.view)));
$("#menuButton").addEventListener("click", () => {
  const open = $("#sidebar").classList.toggle("is-open");
  $("#menuButton").setAttribute("aria-expanded", String(open));
});
$("#refreshButton").addEventListener("click", load);
$("#yearFilter").addEventListener("change", load);
$("#monthFilter").addEventListener("change", load);
$("#verticalFilter").addEventListener("change", load);
$("#tableSearch").addEventListener("input", (event) => { state.search = event.target.value; renderTable(); });
$("#exportButton").addEventListener("click", exportCsv);
document.addEventListener("click", (event) => {
  const costToggle = event.target.closest("[data-expand-cost]");
  if (costToggle) {
    state.costExpanded = !state.costExpanded;
    renderCostChart(state.payload?.charts.costShare || []);
    return;
  }
  const verticalToggle = event.target.closest("[data-expand-vertical]");
  if (!verticalToggle) return;
  const vertical = verticalToggle.dataset.expandVertical;
  if (state.expandedVerticals.has(vertical)) state.expandedVerticals.delete(vertical);
  else state.expandedVerticals.add(vertical);
  renderVerticals(state.payload);
});
load();
