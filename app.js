add app.js
import {
  addExpenseWithInstallments,
  listExpensesByMonth,
  getExpenseDetail,
  toggleInstallmentPaid,
  setAllPaid,
  deleteExpense,
  clearAll
} from "./db.js";

/* ---------- helpers ---------- */
const $ = (s) => document.querySelector(s);
const fmtBRL = (n) => (Number(n) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + "-" + Math.random().toString(16).slice(2);
}

function toISODate(d) {
  const dt = new Date(d);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const day = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function monthKeyFromISO(iso) {
  return iso.slice(0, 7);
}

function addMonthsKeepingDay(baseISO, monthsToAdd, dueDayOpt) {
  const [y, m, d] = baseISO.split("-").map(Number);
  const dueDay = dueDayOpt ? Number(dueDayOpt) : d;

  const base = new Date(y, m - 1, 1);
  base.setMonth(base.getMonth() + monthsToAdd);

  const lastDay = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
  const day = Math.min(dueDay, lastDay);

  return toISODate(new Date(base.getFullYear(), base.getMonth(), day));
}

/* ---------- service worker ---------- */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

/* ---------- elements ---------- */
const views = {
  list: $("#view-list"),
  novo: $("#view-new"),
  detail: $("#view-detail"),
};

const listEl = $("#expense-list");
const emptyEl = $("#empty");
const summaryEl = $("#summary");
const monthSelect = $("#filter-month");

/* ---------- routing ---------- */
function showView(name) {
  Object.entries(views).forEach(([k, el]) => el.classList.toggle("hidden", k !== name));

  // tabs topo
  document.querySelectorAll(".tab").forEach(btn => {
    btn.classList.toggle("active", btn.getAttribute("data-tab") === name);
  });

  // tabs bottom
  document.querySelectorAll(".bottom-btn").forEach(btn => {
    btn.classList.toggle("active", btn.getAttribute("data-tab") === name);
  });
}

function route() {
  const hash = location.hash || "#/";
  if (hash === "#/" || hash === "#") {
    showView("list");
    renderList();
    return;
  }
  if (hash === "#/novo") {
    showView("novo");
    return;
  }
  if (hash.startsWith("#/gasto/")) {
    showView("detail");
    const id = hash.split("/")[2];
    renderDetail(id);
    return;
  }
  location.hash = "#/";
}

window.addEventListener("hashchange", route);

/* ---------- month filter ---------- */
function buildMonthOptions() {
  const now = new Date();
  const options = [];
  for (let i = 0; i < 18; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    options.push(`${y}-${m}`);
  }
  monthSelect.innerHTML = options.map(mk => {
    const [y, m] = mk.split("-");
    return `<option value="${mk}">${m}/${y}</option>`;
  }).join("");

  monthSelect.value = monthKeyFromISO(toISODate(now));
}

monthSelect.addEventListener("change", () => renderList());

/* ---------- nav buttons ---------- */
document.querySelectorAll("[data-go]").forEach(btn => {
  btn.addEventListener("click", () => (location.hash = btn.getAttribute("data-go")));
});

$("#btn-cancel").addEventListener("click", () => (location.hash = "#/"));

/* ---------- create expense ---------- */
function setTodayInForm() {
  const today = toISODate(new Date());
  $("#purchaseDate").value = today;
}
setTodayInForm();

$("#form-new").addEventListener("submit", async (ev) => {
  ev.preventDefault();

  const name = $("#name").value.trim();
  const category = $("#category").value.trim();
  const purchaseDate = $("#purchaseDate").value;
  const totalValue = Number($("#totalValue").value);
  const installmentsCount = Math.max(1, Number($("#installments").value || 1));
  const dueDay = $("#dueDay").value ? Number($("#dueDay").value) : null;
  const notes = $("#notes").value.trim();

  const id = uid();
  const monthKey = monthKeyFromISO(purchaseDate);
  const perInstallment = installmentsCount > 0 ? (totalValue / installmentsCount) : totalValue;

  const expense = {
    id,
    name,
    category,
    purchaseDate,
    totalValue,
    installmentsCount,
    perInstallment,
    dueDay,
    notes,
    monthKey,
    createdAt: new Date().toISOString(),
  };

  const installments = Array.from({ length: installmentsCount }, (_, i) => {
    const number = i + 1;
    const dueDate = addMonthsKeepingDay(purchaseDate, i, dueDay);
    return {
      id: `${id}::${number}`,
      expenseId: id,
      number,
      total: installmentsCount,
      value: perInstallment,
      dueDate,
      monthKey: monthKeyFromISO(dueDate),
      paid: false,
      paidAt: null,
      createdAt: new Date().toISOString(),
    };
  });

  await addExpenseWithInstallments(expense, installments);

  $("#form-new").reset();
  setTodayInForm();
  $("#installments").value = "1";

  location.hash = "#/";
});

/* ---------- list view ---------- */
async function renderList() {
  const mk = monthSelect.value;

  const { expenses, stats } = await listExpensesByMonth(mk);

  if (!expenses.length) {
    listEl.innerHTML = "";
    emptyEl.classList.remove("hidden");
    summaryEl.innerHTML = "";
    return;
  }

  emptyEl.classList.add("hidden");

  // resumo do mês (parcelas pelo vencimento do mês selecionado)
  let totalDue = 0;
  let totalPaid = 0;

  for (const [_, s] of stats.entries()) {
    const thisMonth = s.installments.filter(x => x.monthKey === mk);
    totalDue += thisMonth.reduce((a, b) => a + (Number(b.value) || 0), 0);
    totalPaid += thisMonth.filter(x => x.paid).reduce((a, b) => a + (Number(b.value) || 0), 0);
  }

  const open = totalDue - totalPaid;

  summaryEl.innerHTML = `
    <div class="pill gray">
      <div class="k">Total do mês</div>
      <div class="v">${fmtBRL(totalDue)}</div>
    </div>
    <div class="pill green">
      <div class="k">Pago</div>
      <div class="v">${fmtBRL(totalPaid)}</div>
    </div>
    <div class="pill blue">
      <div class="k">Em aberto</div>
      <div class="v">${fmtBRL(open)}</div>
    </div>
  `;

  const ordered = [...expenses].sort((a, b) => (b.purchaseDate.localeCompare(a.purchaseDate)));

  listEl.innerHTML = ordered.map(e => {
    const s = stats.get(e.id);
    const paid = s?.paid ?? 0;
    const total = s?.total ?? e.installmentsCount;

    const icon = pickIcon(e.category, e.name);

    return `
      <div class="item" data-open="${e.id}">
        <div class="item-left">
          <div class="iconbox" aria-hidden="true">${icon}</div>

          <div class="item-meta">
            <div class="item-title">${escapeHtml(e.name)}</div>
            <div class="item-sub">
              <span class="badge">${escapeHtml(e.category || "Sem categoria")}</span>
              <span class="badge">Compra: ${formatBRDate(e.purchaseDate)}</span>
              <span class="badge">Parcelas: ${paid}/${total}</span>
            </div>
          </div>
        </div>

        <div class="progress">
          <div class="big">${fmtBRL(e.totalValue)}</div>
          <div class="small">${fmtBRL(e.perInstallment)} / parcela</div>
        </div>
      </div>
    `;
  }).join("");

  listEl.querySelectorAll("[data-open]").forEach(el => {
    el.addEventListener("click", () => {
      location.hash = `#/gasto/${el.getAttribute("data-open")}`;
    });
  });
}

/* ---------- detail view ---------- */
let currentExpenseId = null;

async function renderDetail(expenseId) {
  currentExpenseId = expenseId;

  const { expense, installments } = await getExpenseDetail(expenseId);
  if (!expense) {
    location.hash = "#/";
    return;
  }

  const paidCount = installments.filter(x => x.paid).length;
  const total = installments.length;
  const icon = pickIcon(expense.category, expense.name);

  $("#detail-header").innerHTML = `
    <div class="detail-top">
      <div class="detail-left">
        <div class="detail-title">
          <span class="detail-icon" aria-hidden="true">${icon}</span>
          <span>${escapeHtml(expense.name)}</span>
        </div>
        <div class="detail-badges">
          <span class="badge">${escapeHtml(expense.category || "Sem categoria")}</span>
          <span class="badge">Compra: ${formatBRDate(expense.purchaseDate)}</span>
          <span class="badge">Parcelas: ${paidCount}/${total}</span>
        </div>
        ${expense.notes ? `<div class="detail-notes">${escapeHtml(expense.notes)}</div>` : ""}
      </div>

      <div class="detail-right">
        <div class="detail-total">${fmtBRL(expense.totalValue)}</div>
        <div class="detail-per">${fmtBRL(expense.perInstallment)} / parcela</div>
      </div>
    </div>
  `;

  const container = $("#installment-list");
  container.innerHTML = installments.map(inst => `
    <div class="installment">
      <div class="chk">
        <input type="checkbox" data-inst="${inst.id}" ${inst.paid ? "checked" : ""}/>
        <div>
          <div><b>${inst.number}/${inst.total}</b> • vence em ${formatBRDate(inst.dueDate)}</div>
          <div style="color:var(--muted);font-size:12px;">${fmtBRL(inst.value)} ${inst.paid ? "• paga" : "• pendente"}</div>
        </div>
      </div>
      <span class="badge">${inst.paid ? "OK" : "..."}</span>
    </div>
  `).join("");

  container.querySelectorAll("[data-inst]").forEach(chk => {
    chk.addEventListener("change", async () => {
      const id = chk.getAttribute("data-inst");
      await toggleInstallmentPaid(id, chk.checked);
      renderDetail(expenseId);
    });
  });
}

$("#btn-back").addEventListener("click", () => (location.hash = "#/"));

$("#btn-mark-all").addEventListener("click", async () => {
  if (!currentExpenseId) return;
  await setAllPaid(currentExpenseId, true);
  renderDetail(currentExpenseId);
});

$("#btn-unmark-all").addEventListener("click", async () => {
  if (!currentExpenseId) return;
  await setAllPaid(currentExpenseId, false);
  renderDetail(currentExpenseId);
});

$("#btn-delete").addEventListener("click", async () => {
  if (!currentExpenseId) return;
  const ok = confirm("Excluir este gasto e todas as parcelas?");
  if (!ok) return;
  await deleteExpense(currentExpenseId);
  currentExpenseId = null;
  location.hash = "#/";
});

/* ---------- seed examples ---------- */
$("#btn-seed").addEventListener("click", async () => {
  const ok = confirm("Criar gastos de exemplo? (não apaga os seus)");
  if (!ok) return;

  const today = toISODate(new Date());
  const examples = [
    { name: "Internet", category: "Casa", total: 119.90, inst: 1, dueDay: 10 },
    { name: "Notebook", category: "Trabalho", total: 4800.00, inst: 18, dueDay: 12 },
    { name: "Mercado", category: "Alimentação", total: 356.40, inst: 1, dueDay: null },
  ];

  for (const ex of examples) {
    const id = uid();
    const purchaseDate = today;
    const installmentsCount = ex.inst;
    const per = ex.total / installmentsCount;

    const expense = {
      id,
      name: ex.name,
      category: ex.category,
      purchaseDate,
      totalValue: ex.total,
      installmentsCount,
      perInstallment: per,
      dueDay: ex.dueDay,
      notes: "",
      monthKey: monthKeyFromISO(purchaseDate),
      createdAt: new Date().toISOString(),
    };

    const installments = Array.from({ length: installmentsCount }, (_, i) => {
      const number = i + 1;
      const dueDate = addMonthsKeepingDay(purchaseDate, i, ex.dueDay);
      return {
        id: `${id}::${number}`,
        expenseId: id,
        number,
        total: installmentsCount,
        value: per,
        dueDate,
        monthKey: monthKeyFromISO(dueDate),
        paid: false,
        paidAt: null,
        createdAt: new Date().toISOString(),
      };
    });

    await addExpenseWithInstallments(expense, installments);
  }

  renderList();
});

/* ---------- misc ---------- */
function formatBRDate(iso) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function pickIcon(category, name) {
  const text = `${category || ""} ${name || ""}`.toLowerCase();

  if (text.includes("internet") || text.includes("wifi")) return "📶";
  if (text.includes("mercado") || text.includes("super") || text.includes("alimenta")) return "🛒";
  if (text.includes("notebook") || text.includes("pc") || text.includes("comput")) return "💻";
  if (text.includes("casa") || text.includes("aluguel") || text.includes("condom")) return "🏠";
  if (text.includes("carro") || text.includes("uber") || text.includes("gas")) return "🚗";
  if (text.includes("saúde") || text.includes("farm") || text.includes("med")) return "💊";
  if (text.includes("lazer") || text.includes("cinema") || text.includes("game")) return "🎮";
  if (text.includes("cartão") || text.includes("credito") || text.includes("crédito")) return "💳";
  return "🧾";
}

// estilos do header do detalhe (sem precisar mexer no CSS grande)
const style = document.createElement("style");
style.textContent = `
  .detail-top{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap;}
  .detail-title{display:flex;gap:10px;align-items:center;font-weight:950;font-size:18px;letter-spacing:.2px;}
  .detail-icon{width:40px;height:40px;display:grid;place-items:center;border-radius:14px;background:rgba(255,255,255,.05);border:1px solid var(--line);box-shadow:0 16px 40px rgba(0,0,0,.25);font-size:18px;}
  .detail-badges{color:var(--muted);font-size:12px;margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;}
  .detail-notes{margin-top:10px;color:var(--muted);font-size:13px;}
  .detail-right{text-align:right;}
  .detail-total{font-weight:950;font-size:18px;letter-spacing:.2px;}
  .detail-per{color:var(--muted);font-size:12px;margin-top:6px;}
`;
document.head.appendChild(style);

/* ---------- boot ---------- */
buildMonthOptions();
route();

// debug helper (opcional): limpar tudo pelo console
window.__clearAll = clearAll;

