/* ============================================================
   QuickBudget — Supabase-backed daily budget tracker
   Email + password auth, cloud database, calendar view,
   per-day expenses with details, secured by Row Level Security.
   ============================================================ */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

// ---------- Config check ----------
const configured =
  SUPABASE_URL && SUPABASE_ANON_KEY &&
  !SUPABASE_URL.startsWith("YOUR_") && !SUPABASE_ANON_KEY.startsWith("YOUR_");

if (!configured) document.getElementById("config-banner").hidden = false;

const supabase = configured ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

// ---------- State ----------
let user = null;
let data = { income: 0, savings: 0, expenses: [] };
let viewMonth = startOfMonth(new Date()); // first day of the displayed month
let selectedDay = null; // "YYYY-MM-DD" currently open in the modal

const COLORS = [
  "#6c8cff", "#36d399", "#ffb454", "#ff6b6b", "#a78bfa",
  "#f472b6", "#22d3ee", "#facc15", "#4ade80", "#fb923c",
];

// ---------- Date helpers (local, timezone-safe) ----------
function pad(n) { return String(n).padStart(2, "0"); }
function ymd(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function monthPrefix(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; }
function prettyMonth(d) { return d.toLocaleDateString(undefined, { month: "long", year: "numeric" }); }
function prettyDate(iso) {
  const [y, m, dd] = iso.split("-").map(Number);
  return new Date(y, m - 1, dd).toLocaleDateString(undefined, {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  });
}

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const authView = $("auth-view"), appView = $("app-view");
const authForm = $("auth-form"), emailInput = $("email"), passwordInput = $("password");
const authMsg = $("auth-msg"), signinBtn = $("signin-btn"), signupBtn = $("signup-btn");
const incomeInput = $("income-input"), savingsInput = $("savings-input"), saveStatus = $("save-status");
const expenseList = $("expense-list"), expenseEmpty = $("expense-empty");
const canvas = $("pie"), chartEmpty = $("chart-empty"), legend = $("legend");
const monthLabel = $("month-label"), calGrid = $("calendar-grid");

// ---------- Format ----------
const fmt = (n) => "$" + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
function showMessage(t, k) { authMsg.textContent = t; authMsg.className = "msg " + (k || ""); authMsg.hidden = !t; }
function setBusy(b) { signinBtn.disabled = b; signupBtn.disabled = b; }

// ===================== AUTH =====================
authForm.addEventListener("submit", async (e) => { e.preventDefault(); await signIn(); });
signupBtn.addEventListener("click", signUp);
$("signout-btn").addEventListener("click", async () => { if (supabase) await supabase.auth.signOut(); });

async function signIn() {
  if (!supabase) return;
  const email = emailInput.value.trim(), password = passwordInput.value;
  if (!email || !password) return;
  setBusy(true); showMessage("Signing in…", "");
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  setBusy(false);
  showMessage(error ? error.message : "", error ? "error" : "");
}

async function signUp() {
  if (!supabase) return;
  const email = emailInput.value.trim(), password = passwordInput.value;
  if (!email || password.length < 6) {
    showMessage("Enter an email and a password of at least 6 characters.", "error");
    return;
  }
  setBusy(true); showMessage("Creating account…", "");
  const { data: res, error } = await supabase.auth.signUp({ email, password });
  setBusy(false);
  if (error) { showMessage(error.message, "error"); return; }
  if (!res.session) showMessage("Account created! Check your email to confirm, then sign in.", "success");
}

if (supabase) {
  supabase.auth.onAuthStateChange(async (_e, session) => {
    if (session && session.user) { user = session.user; await enterApp(); }
    else { user = null; appView.hidden = true; authView.hidden = false; passwordInput.value = ""; }
  });
}

// ===================== DATA LAYER =====================
async function loadData() {
  const { data: budget } = await supabase
    .from("budgets").select("income, savings").eq("user_id", user.id).maybeSingle();
  const { data: expenses } = await supabase
    .from("expenses").select("id, category, amount, spent_on, note")
    .eq("user_id", user.id).order("spent_on", { ascending: false });

  data = {
    income: budget ? Number(budget.income) : 0,
    savings: budget ? Number(budget.savings) : 0,
    expenses: (expenses || []).map((e) => ({
      id: e.id, category: e.category, amount: Number(e.amount),
      spent_on: e.spent_on, note: e.note || "",
    })),
  };
}

async function saveBudget() {
  saveStatus.textContent = "Saving…";
  const { error } = await supabase.from("budgets").upsert(
    { user_id: user.id, income: data.income, savings: data.savings, updated_at: new Date().toISOString() },
    { onConflict: "user_id" }
  );
  saveStatus.textContent = error ? "Couldn't save" : "Saved ✓";
  if (!error) setTimeout(() => (saveStatus.innerHTML = "&nbsp;"), 1500);
}

async function addExpense({ category, amount, spent_on, note }) {
  const { data: row, error } = await supabase.from("expenses")
    .insert({ user_id: user.id, category, amount, spent_on, note: note || null })
    .select("id, category, amount, spent_on, note").single();
  if (error) { alert("Could not add expense: " + error.message); return; }
  data.expenses.unshift({
    id: row.id, category: row.category, amount: Number(row.amount),
    spent_on: row.spent_on, note: row.note || "",
  });
  renderAll();
  if (selectedDay) renderDayModal();
}

async function removeExpense(id) {
  const { error } = await supabase.from("expenses").delete().eq("id", id);
  if (error) { alert("Could not delete: " + error.message); return; }
  data.expenses = data.expenses.filter((e) => e.id !== id);
  renderAll();
  if (selectedDay) renderDayModal();
}

// ===================== ENTER APP =====================
async function enterApp() {
  authView.hidden = true; appView.hidden = false;
  $("user-email").textContent = user.email;
  await loadData();
  incomeInput.value = data.income || "";
  savingsInput.value = data.savings || "";
  renderAll();
}

// ===================== TABS =====================
document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const tab = btn.dataset.tab;
    $("tab-overview").hidden = tab !== "overview";
    $("tab-calendar").hidden = tab !== "calendar";
    if (tab === "overview") renderChart(); // redraw canvas crisply when revealed
  });
});

// ===================== MONTH NAV =====================
$("prev-month").addEventListener("click", () => { viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1); renderAll(); });
$("next-month").addEventListener("click", () => { viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1); renderAll(); });
$("today-btn").addEventListener("click", () => { viewMonth = startOfMonth(new Date()); renderAll(); });

// ----- Mini-calendar popover (click the month label to pick a day) -----
const monthPopover = $("month-popover");
const monthLabelBtn = $("month-label");
let pickerMonth = startOfMonth(viewMonth);

monthLabelBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  if (monthPopover.hidden) { pickerMonth = startOfMonth(viewMonth); renderPicker(); monthPopover.hidden = false; }
  else monthPopover.hidden = true;
});
$("pop-prev").addEventListener("click", (e) => { e.stopPropagation(); pickerMonth = new Date(pickerMonth.getFullYear(), pickerMonth.getMonth() - 1, 1); renderPicker(); });
$("pop-next").addEventListener("click", (e) => { e.stopPropagation(); pickerMonth = new Date(pickerMonth.getFullYear(), pickerMonth.getMonth() + 1, 1); renderPicker(); });
document.addEventListener("click", (e) => { if (!monthPopover.hidden && !e.target.closest(".month-picker-wrap")) monthPopover.hidden = true; });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") monthPopover.hidden = true; });

function renderPicker() {
  $("pop-label").textContent = prettyMonth(pickerMonth);
  const grid = $("pop-grid");
  grid.innerHTML = "";
  const y = pickerMonth.getFullYear(), m = pickerMonth.getMonth();
  const firstWeekday = new Date(y, m, 1).getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const prefix = `${y}-${pad(m + 1)}`;
  const has = {};
  data.expenses.forEach((e) => { if (e.spent_on && e.spent_on.startsWith(prefix)) has[e.spent_on] = true; });
  const todayStr = ymd(new Date());

  for (let i = 0; i < firstWeekday; i++) {
    const b = document.createElement("div"); b.className = "pop-day empty"; grid.appendChild(b);
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${y}-${pad(m + 1)}-${pad(d)}`;
    const cell = document.createElement("div");
    cell.className = "pop-day" + (has[iso] ? " has" : "") + (iso === todayStr ? " today" : "");
    cell.textContent = d;
    cell.addEventListener("click", (e) => {
      e.stopPropagation();
      viewMonth = startOfMonth(new Date(y, m, d));
      monthPopover.hidden = true;
      renderAll();
      openDay(iso);
    });
    grid.appendChild(cell);
  }
}

// ===================== RENDER =====================
function monthExpenses() {
  const p = monthPrefix(viewMonth);
  return data.expenses.filter((e) => e.spent_on && e.spent_on.startsWith(p));
}

function renderAll() {
  monthLabel.textContent = prettyMonth(viewMonth);
  renderSummary();
  renderExpenseList();
  renderChart();
  renderCalendar();
}

function renderSummary() {
  const spent = monthExpenses().reduce((s, e) => s + e.amount, 0);
  $("stat-income").textContent = fmt(data.income);
  $("stat-spent").textContent = fmt(spent);
  $("stat-savings").textContent = fmt(data.savings);
  const left = Number(data.income) - spent;
  const el = $("stat-left");
  el.textContent = fmt(left);
  el.style.color = left < 0 ? "var(--danger)" : "var(--good)";
}

function expenseRow(exp, i) {
  const li = document.createElement("li");

  const main = document.createElement("div");
  main.className = "expense-main";
  const dot = document.createElement("span");
  dot.className = "expense-dot";
  dot.style.background = COLORS[i % COLORS.length];
  const text = document.createElement("div");
  text.className = "expense-text";
  const cat = document.createElement("div");
  cat.className = "expense-cat";
  cat.textContent = exp.category;
  const meta = document.createElement("div");
  meta.className = "expense-meta";
  const dateStr = exp.spent_on ? exp.spent_on.split("-").slice(1).reverse().join("/") : "";
  meta.textContent = exp.note ? `${dateStr} · ${exp.note}` : dateStr;
  text.appendChild(cat); text.appendChild(meta);
  main.appendChild(dot); main.appendChild(text);

  const right = document.createElement("div");
  right.className = "expense-right";
  const amt = document.createElement("span");
  amt.className = "expense-amount";
  amt.textContent = fmt(exp.amount);
  const del = document.createElement("button");
  del.className = "del-btn"; del.innerHTML = "&times;"; del.title = "Delete";
  del.addEventListener("click", () => removeExpense(exp.id));
  right.appendChild(amt); right.appendChild(del);

  li.appendChild(main); li.appendChild(right);
  return li;
}

function renderExpenseList() {
  const list = monthExpenses();
  expenseList.innerHTML = "";
  expenseEmpty.hidden = list.length > 0;
  list.forEach((e, i) => expenseList.appendChild(expenseRow(e, i)));
}

// ---------- Chart ----------
function groupedExpenses(list) {
  const map = new Map();
  list.forEach((e) => map.set(e.category, (map.get(e.category) || 0) + e.amount));
  return Array.from(map, ([category, amount]) => ({ category, amount }));
}

function renderChart() {
  const groups = groupedExpenses(monthExpenses());
  const total = groups.reduce((s, g) => s + g.amount, 0);
  const ctx = canvas.getContext("2d");

  const size = 320, dpr = window.devicePixelRatio || 1;
  canvas.width = size * dpr; canvas.height = size * dpr;
  canvas.style.width = size + "px"; canvas.style.height = size + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);
  legend.innerHTML = "";

  if (total === 0) { chartEmpty.hidden = false; return; }
  chartEmpty.hidden = true;

  const cx = size / 2, cy = size / 2, radius = 130, inner = 72;
  let start = -Math.PI / 2;

  groups.sort((a, b) => b.amount - a.amount).forEach((g, i) => {
    const slice = (g.amount / total) * Math.PI * 2;
    const color = COLORS[i % COLORS.length];
    ctx.beginPath(); ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, start, start + slice); ctx.closePath();
    ctx.fillStyle = color; ctx.fill();
    start += slice;

    const li = document.createElement("li");
    const dot = document.createElement("span"); dot.className = "dot"; dot.style.background = color;
    const cat = document.createElement("span"); cat.className = "legend-cat"; cat.textContent = g.category;
    const val = document.createElement("span"); val.className = "legend-val";
    val.textContent = `${fmt(g.amount)} · ${Math.round((g.amount / total) * 100)}%`;
    li.append(dot, cat, val); legend.appendChild(li);
  });

  ctx.beginPath(); ctx.arc(cx, cy, inner, 0, Math.PI * 2);
  ctx.fillStyle = getComputedStyle(document.body).getPropertyValue("--card").trim() || "#1a1f38";
  ctx.fill();

  ctx.fillStyle = getComputedStyle(document.body).getPropertyValue("--muted").trim();
  ctx.font = "13px -apple-system, sans-serif"; ctx.textAlign = "center";
  ctx.fillText("Spent this month", cx, cy - 8);
  ctx.fillStyle = getComputedStyle(document.body).getPropertyValue("--text").trim();
  ctx.font = "bold 22px -apple-system, sans-serif";
  ctx.fillText(fmt(total), cx, cy + 16);
}

// ---------- Calendar ----------
function dayTotals() {
  const totals = {};
  monthExpenses().forEach((e) => {
    totals[e.spent_on] = totals[e.spent_on] || { sum: 0, count: 0 };
    totals[e.spent_on].sum += e.amount;
    totals[e.spent_on].count += 1;
  });
  return totals;
}

function renderCalendar() {
  calGrid.innerHTML = "";
  const year = viewMonth.getFullYear(), month = viewMonth.getMonth();
  const firstWeekday = new Date(year, month, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const totals = dayTotals();
  const maxSum = Math.max(1, ...Object.values(totals).map((t) => t.sum));
  const todayStr = ymd(new Date());

  for (let i = 0; i < firstWeekday; i++) {
    const blank = document.createElement("div");
    blank.className = "day-cell empty";
    calGrid.appendChild(blank);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const iso = `${year}-${pad(month + 1)}-${pad(day)}`;
    const t = totals[iso];
    const cell = document.createElement("div");
    cell.className = "day-cell" + (iso === todayStr ? " today" : "");

    const heat = document.createElement("div");
    heat.className = "heat";
    if (t) heat.style.opacity = String(0.12 + 0.45 * (t.sum / maxSum));
    cell.appendChild(heat);

    const num = document.createElement("div");
    num.className = "day-num"; num.textContent = day;
    cell.appendChild(num);

    if (t) {
      const spent = document.createElement("div");
      spent.className = "day-spent"; spent.textContent = fmt(t.sum);
      const count = document.createElement("div");
      count.className = "day-count";
      count.textContent = `${t.count} item${t.count > 1 ? "s" : ""}`;
      cell.append(spent, count);
    }

    cell.addEventListener("click", () => openDay(iso));
    calGrid.appendChild(cell);
  }
}

// ===================== DAY MODAL =====================
const dayModal = $("day-modal");
const dayCategory = $("day-category"), dayCustom = $("day-custom");
const dayAmount = $("day-amount"), dayNote = $("day-note");

function openDay(iso) {
  selectedDay = iso;
  renderDayModal();
  dayModal.hidden = false;
  setTimeout(() => dayAmount.focus(), 50);
}
function closeDay() { dayModal.hidden = true; selectedDay = null; }

dayModal.querySelectorAll("[data-close]").forEach((el) => el.addEventListener("click", closeDay));
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !dayModal.hidden) closeDay(); });

function renderDayModal() {
  const list = data.expenses.filter((e) => e.spent_on === selectedDay);
  $("modal-date").textContent = prettyDate(selectedDay);
  const total = list.reduce((s, e) => s + e.amount, 0);
  $("modal-total").textContent = list.length ? `${fmt(total)} across ${list.length} item${list.length > 1 ? "s" : ""}` : "";

  const ul = $("day-expense-list");
  ul.innerHTML = "";
  $("day-empty").hidden = list.length > 0;
  list.forEach((e, i) => ul.appendChild(expenseRow(e, i)));
}

dayCategory.addEventListener("change", () => {
  const custom = dayCategory.value === "__custom__";
  dayCustom.hidden = !custom;
  if (custom) dayCustom.focus();
});

$("day-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const amount = parseFloat(dayAmount.value);
  if (!amount || amount <= 0) return;
  const category = dayCategory.value === "__custom__"
    ? (dayCustom.value.trim() || "Other") : dayCategory.value;

  await addExpense({ category, amount, spent_on: selectedDay, note: dayNote.value.trim() });

  dayAmount.value = ""; dayNote.value = "";
  dayCustom.value = ""; dayCustom.hidden = true;
  dayCategory.value = dayCategory.options[0].value;
  dayAmount.focus();
});

// Quick-add button on Overview → opens today's modal
$("quick-add-btn").addEventListener("click", () => openDay(ymd(new Date())));

// ===================== BUDGET INPUTS =====================
let saveTimer = null;
function scheduleBudgetSave() {
  clearTimeout(saveTimer);
  saveStatus.textContent = "…";
  saveTimer = setTimeout(saveBudget, 600);
}
incomeInput.addEventListener("input", () => { data.income = parseFloat(incomeInput.value) || 0; renderSummary(); scheduleBudgetSave(); });
savingsInput.addEventListener("input", () => { data.savings = parseFloat(savingsInput.value) || 0; renderSummary(); scheduleBudgetSave(); });

window.addEventListener("resize", () => { if (!appView.hidden && !$("tab-overview").hidden) renderChart(); });
