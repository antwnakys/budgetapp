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
  supabase.auth.onAuthStateChange((_e, session) => {
    // NOTE: do NOT call supabase data/auth methods directly inside this
    // callback — Supabase holds an internal lock here and awaiting another
    // Supabase call deadlocks. Defer with setTimeout so it runs after the
    // lock is released.
    if (session && session.user) {
      user = session.user;
      setTimeout(() => { enterApp(); }, 0);
    } else {
      user = null;
      appView.hidden = true; authView.hidden = false; passwordInput.value = "";
    }
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
  await loadGroups();
  renderFamily();
}

// ===================== TABS =====================
document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const tab = btn.dataset.tab;
    $("tab-overview").hidden = tab !== "overview";
    $("tab-calendar").hidden = tab !== "calendar";
    $("tab-family").hidden = tab !== "family";
    updateMonthBar();
    if (tab === "overview") renderChart(); // redraw canvas crisply when revealed
    if (tab === "family") renderFamilyOverview();
  });
});

// The month switcher applies to all tabs except a Family tab with no group
function updateMonthBar() {
  const active = document.querySelector(".tab.active");
  const tab = active ? active.dataset.tab : "overview";
  const show = tab !== "family" || !!activeGroup;
  $("month-bar").style.display = show ? "flex" : "none";
}

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
  if (activeGroup) renderFamilyOverview(); // keep family overview in sync with the month
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
  const monthExp = monthExpenses();
  const spent = monthExp.reduce((s, e) => s + e.amount, 0);
  drawDonut(canvas, legend, chartEmpty, groupedExpenses(monthExp), spent, Number(data.income) || 0);
}

// Reusable donut: whole circle = income, categories are shares, leftover faded
function drawDonut(canvasEl, legendEl, emptyEl, groupsIn, spent, income) {
  const groups = groupsIn.slice().sort((a, b) => b.amount - a.amount);
  const ctx = canvasEl.getContext("2d");
  const css = (v) => getComputedStyle(document.body).getPropertyValue(v).trim();

  const size = 320, dpr = window.devicePixelRatio || 1;
  canvasEl.width = size * dpr; canvasEl.height = size * dpr;
  canvasEl.style.width = size + "px"; canvasEl.style.height = size + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);
  legendEl.innerHTML = "";

  if (spent === 0 && income === 0) { emptyEl.hidden = false; return; }
  emptyEl.hidden = true;

  // The whole circle represents INCOME; categories are shares of it, and the
  // leftover is shown as a faded "Unspent" slice. If no income is set, fall
  // back to splitting by spending so the circle still shows something.
  const useIncome = income > 0;
  const denom = useIncome ? Math.max(income, spent) : spent;
  const base = useIncome ? income : spent; // legend percentages are out of this

  const cx = size / 2, cy = size / 2, radius = 130, inner = 78;
  let start = -Math.PI / 2;

  const addLegend = (color, label, amount, faded) => {
    const li = document.createElement("li");
    const dot = document.createElement("span"); dot.className = "dot"; dot.style.background = color;
    const cat = document.createElement("span"); cat.className = "legend-cat"; cat.textContent = label;
    if (faded) cat.style.color = css("--muted");
    const val = document.createElement("span"); val.className = "legend-val";
    val.textContent = `${fmt(amount)} · ${Math.round((amount / base) * 100)}%`;
    li.append(dot, cat, val); legendEl.appendChild(li);
  };

  const drawSlice = (amount, color) => {
    const slice = (amount / denom) * Math.PI * 2;
    ctx.beginPath(); ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, start, start + slice); ctx.closePath();
    ctx.fillStyle = color; ctx.fill();
    start += slice;
  };

  // category shares
  groups.forEach((g, i) => {
    const color = COLORS[i % COLORS.length];
    drawSlice(g.amount, color);
    addLegend(color, g.category, g.amount, false);
  });

  // unspent remainder of income
  if (useIncome && income > spent) {
    const remaining = income - spent;
    const color = css("--card-2") || "#212741";
    drawSlice(remaining, color);
    addLegend(color, "Unspent", remaining, true);
  }

  // doughnut hole
  ctx.beginPath(); ctx.arc(cx, cy, inner, 0, Math.PI * 2);
  ctx.fillStyle = css("--card") || "#1a1f38";
  ctx.fill();

  // center: income with total spent beneath it
  ctx.textAlign = "center";
  if (useIncome) {
    ctx.fillStyle = css("--muted");
    ctx.font = "12px -apple-system, sans-serif";
    ctx.fillText("Income", cx, cy - 18);
    ctx.fillStyle = css("--text");
    ctx.font = "bold 24px -apple-system, sans-serif";
    ctx.fillText(fmt(income), cx, cy + 6);
    if (spent > income) {
      ctx.fillStyle = css("--danger");
      ctx.font = "12px -apple-system, sans-serif";
      ctx.fillText("Over by " + fmt(spent - income), cx, cy + 26);
    } else {
      ctx.fillStyle = css("--muted");
      ctx.font = "12px -apple-system, sans-serif";
      ctx.fillText(fmt(spent) + " spent", cx, cy + 26);
    }
  } else {
    ctx.fillStyle = css("--muted");
    ctx.font = "13px -apple-system, sans-serif";
    ctx.fillText("Spent this month", cx, cy - 8);
    ctx.fillStyle = css("--text");
    ctx.font = "bold 22px -apple-system, sans-serif";
    ctx.fillText(fmt(spent), cx, cy + 16);
  }
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

// ===================== FAMILY / GROUPS =====================
let ownedGroup = null;     // group this user owns: { id, name, owner_id }
let ownedMembers = [];     // members of the owned group
let memberGroups = [];     // [{ group, members }] groups the user was added to
let activeGroup = null;    // the group whose combined overview we show
let familyData = { income: 0, savings: 0, expenses: [] };
let familyFnMissing = false; // true if the group_overview SQL hasn't been run

const ROLE_LABELS = { owner: "Owner", parent: "Parent", kid: "Kid", teen: "Teen", member: "Member" };
function roleLabel(r) { return ROLE_LABELS[r] || "Member"; }

function avatarFor(email) {
  const e = (email || "?").trim();
  let h = 0;
  for (const c of e) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return { ch: (e[0] || "?").toUpperCase(), color: COLORS[h % COLORS.length] };
}

async function loadGroups() {
  ownedGroup = null; ownedMembers = []; memberGroups = [];
  const { data: groups, error } = await supabase.from("groups").select("id, name, owner_id");
  if (error || !groups) return; // tables not set up yet → Family tab shows the create form

  ownedGroup = groups.find((g) => g.owner_id === user.id) || null;
  if (ownedGroup) ownedMembers = await fetchMembers(ownedGroup.id);

  for (const g of groups.filter((g) => g.owner_id !== user.id)) {
    memberGroups.push({ group: g, members: await fetchMembers(g.id) });
  }

  // the group we show a combined overview for: your own, else the first you're in
  activeGroup = ownedGroup || (memberGroups[0] && memberGroups[0].group) || null;
  await loadFamilyOverview();
}

async function fetchMembers(groupId) {
  const { data } = await supabase.from("group_members")
    .select("id, email, role, user_id").eq("group_id", groupId).order("created_at");
  return data || [];
}

async function loadFamilyOverview() {
  familyData = { income: 0, savings: 0, my_role: null, my_member_id: null, members: [], expenses: [] };
  familyFnMissing = false;
  if (!activeGroup) return;
  const { data, error } = await supabase.rpc("group_overview", { gid: activeGroup.id });
  if (error) { familyFnMissing = true; return; }
  if (!data) return;
  if (data.my_role === undefined) { familyFnMissing = true; return; } // old function → needs new migration
  familyData = {
    income: Number(data.income) || 0,
    savings: Number(data.savings) || 0,
    my_role: data.my_role || null,
    my_member_id: data.my_member_id || null,
    members: (data.members || []).map((m) => ({
      member_id: m.member_id, email: m.email, role: m.role,
      allowance: Number(m.allowance) || 0, spent: Number(m.spent) || 0,
    })),
    expenses: (data.expenses || []).map((e) => ({
      id: e.id, category: e.category, amount: Number(e.amount),
      spent_on: e.spent_on, note: e.note || "",
      member_id: e.member_id, email: e.email || "", role: e.role || "",
    })),
  };
}

function memberRow(m, editable) {
  const li = document.createElement("li");
  li.className = "member-row";

  const av = avatarFor(m.email);
  const avatar = document.createElement("div");
  avatar.className = "member-avatar";
  avatar.style.background = av.color;
  avatar.textContent = av.ch;

  const info = document.createElement("div");
  info.className = "member-info";
  const email = document.createElement("div");
  email.className = "member-email";
  const isYou = m.email.toLowerCase() === user.email.toLowerCase();
  email.textContent = m.email + (isYou ? " (you)" : "");
  const sub = document.createElement("div");
  sub.className = "member-sub";
  sub.textContent = m.role === "owner" ? "Owner" : (m.user_id ? "Joined" : "Invited");
  info.append(email, sub);

  const actions = document.createElement("div");
  actions.className = "member-actions";

  if (editable && m.role !== "owner") {
    const sel = document.createElement("select");
    sel.className = "role-select";
    [["parent", "Parent"], ["kid", "Kid"], ["teen", "Teen"], ["member", "Member"]].forEach(([v, l]) => {
      const o = document.createElement("option");
      o.value = v; o.textContent = l;
      if (m.role === v) o.selected = true;
      sel.appendChild(o);
    });
    sel.addEventListener("change", () => updateMemberRole(m.id, sel.value));
    const del = document.createElement("button");
    del.className = "del-btn"; del.innerHTML = "&times;"; del.title = "Remove";
    del.addEventListener("click", () => removeMember(m.id, m.email));
    actions.append(sel, del);
  } else {
    const badge = document.createElement("span");
    badge.className = "role-badge role-" + m.role;
    badge.textContent = roleLabel(m.role);
    actions.append(badge);
  }

  li.append(avatar, info, actions);
  return li;
}

function renderFamily() {
  renderFamilyOverview();
  updateMonthBar();
  $("create-group-card").hidden = !!ownedGroup;
  $("group-card").hidden = !ownedGroup;

  if (ownedGroup) {
    $("group-name").textContent = ownedGroup.name;
    $("group-sub").textContent = `${ownedMembers.length} member${ownedMembers.length !== 1 ? "s" : ""}`;
    const ul = $("member-list");
    ul.innerHTML = "";
    [...ownedMembers]
      .sort((a, b) => (a.role === "owner" ? -1 : b.role === "owner" ? 1 : 0))
      .forEach((m) => ul.appendChild(memberRow(m, true)));
  }

  $("member-of-card").hidden = memberGroups.length === 0;
  const wrap = $("member-of-list");
  wrap.innerHTML = "";
  memberGroups.forEach(({ group, members }) => {
    const title = document.createElement("div");
    title.className = "group-sub-title";
    title.textContent = group.name;
    const ul = document.createElement("ul");
    ul.className = "member-list";
    members.forEach((m) => ul.appendChild(memberRow(m, false)));
    wrap.append(title, ul);
  });
}

function familyExpenseRow(exp, i, canDelete) {
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
  const who = (exp.email || "").split("@")[0];
  meta.textContent = [dateStr, who, exp.note].filter(Boolean).join(" · ");
  text.append(cat, meta);
  main.append(dot, text);

  const right = document.createElement("div");
  right.className = "expense-right";
  const amt = document.createElement("span");
  amt.className = "expense-amount";
  amt.textContent = fmt(exp.amount);
  right.append(amt);
  if (canDelete) {
    const del = document.createElement("button");
    del.className = "del-btn"; del.innerHTML = "&times;"; del.title = "Delete";
    del.addEventListener("click", () => removeFamilyExpense(exp.id));
    right.append(del);
  }

  li.append(main, right);
  return li;
}

function renderFamilyOverview() {
  const sec = $("family-overview");
  if (!activeGroup) { sec.hidden = true; return; }
  sec.hidden = false;

  $("fam-title").textContent = activeGroup.name;
  $("fam-note").hidden = !familyFnMissing;
  if (familyFnMissing) {
    $("fam-note").textContent = "Run supabase/migration_family_budget.sql to enable the shared family budget.";
    $("fam-note").className = "msg error";
  }

  const role = familyData.my_role;
  const isEditor = role === "owner" || role === "parent";
  const isKid = role === "kid" || role === "teen";
  sec.classList.toggle("kid-view", isKid);
  $("fam-role-tag").textContent = role
    ? (role === "owner" ? "You're the owner" : "You're a " + roleLabel(role).toLowerCase())
    : "";

  const p = monthPrefix(viewMonth);
  const monthExp = familyData.expenses.filter((e) => e.spent_on && e.spent_on.startsWith(p));
  const spent = monthExp.reduce((s, e) => s + e.amount, 0);
  const income = familyData.income;

  // summary cards (hidden for kids/teens)
  $("fam-summary").hidden = isKid;
  $("fam-stat-income").textContent = fmt(income);
  $("fam-stat-spent").textContent = fmt(spent);
  $("fam-stat-savings").textContent = fmt(familyData.savings);
  const left = income - spent;
  const le = $("fam-stat-left");
  le.textContent = fmt(left);
  le.style.color = left < 0 ? "var(--danger)" : "var(--good)";

  // owner/parent: editable family money
  $("fam-money-card").hidden = !isEditor;
  if (isEditor) {
    if (document.activeElement !== $("fam-income-input")) $("fam-income-input").value = income || "";
    if (document.activeElement !== $("fam-savings-input")) $("fam-savings-input").value = familyData.savings || "";
  }

  // kid/teen: their allowance
  $("fam-allowance-card").hidden = !isKid;
  $("fam-chart-card").hidden = isKid;
  if (isKid) {
    const me = familyData.members.find((m) => m.member_id === familyData.my_member_id);
    const allowance = me ? me.allowance : 0;
    const usedAll = me ? me.spent : 0; // all-time spending against the allowance
    $("fam-allow-amount").textContent = fmt(allowance);
    $("fam-allow-spent").textContent = fmt(usedAll);
    const rem = allowance - usedAll;
    const remEl = $("fam-allow-remaining");
    remEl.textContent = fmt(rem);
    remEl.style.color = rem < 0 ? "var(--danger)" : "var(--good)";
  }

  // expenses: editors see all; kids see only their own
  const listExp = isKid ? monthExp.filter((e) => e.member_id === familyData.my_member_id) : monthExp;
  $("fam-expense-title").textContent = isKid ? "My expenses this month" : "Family expenses this month";
  const ul = $("fam-expense-list");
  ul.innerHTML = "";
  $("fam-expense-empty").hidden = listExp.length > 0;
  listExp.forEach((e, i) => {
    const canDel = isEditor || e.member_id === familyData.my_member_id;
    ul.appendChild(familyExpenseRow(e, i, canDel));
  });

  if (!isKid) drawDonut($("fam-pie"), $("fam-legend"), $("fam-chart-empty"), groupedExpenses(monthExp), spent, income);

  // owner/parent: manage kids' & teens' allowances
  const kids = familyData.members.filter((m) => m.role === "kid" || m.role === "teen");
  $("fam-manage-allowances").hidden = !(isEditor && kids.length > 0);
  if (isEditor && kids.length > 0) renderAllowanceManager(kids);
}

function renderAllowanceManager(kids) {
  const ul = $("fam-allow-list");
  ul.innerHTML = "";
  kids.forEach((m) => {
    const li = document.createElement("li");
    li.className = "member-row";
    const av = avatarFor(m.email);
    const avatar = document.createElement("div");
    avatar.className = "member-avatar";
    avatar.style.background = av.color;
    avatar.textContent = av.ch;
    const info = document.createElement("div");
    info.className = "member-info";
    const name = document.createElement("div");
    name.className = "member-email";
    name.textContent = m.email.split("@")[0];
    const sub = document.createElement("div");
    sub.className = "member-sub";
    const remaining = m.allowance - m.spent;
    sub.textContent = `${roleLabel(m.role)} · spent ${fmt(m.spent)} · ${fmt(remaining)} left`;
    info.append(name, sub);
    const actions = document.createElement("div");
    actions.className = "member-actions";
    const inWrap = document.createElement("div");
    inWrap.className = "money-input";
    const dollar = document.createElement("span"); dollar.textContent = "$";
    const input = document.createElement("input");
    input.type = "number"; input.min = "0"; input.step = "0.01";
    input.className = "allow-input"; input.value = m.allowance || "";
    input.addEventListener("change", () => setMemberAllowance(m.member_id, parseFloat(input.value) || 0));
    inWrap.append(dollar, input);
    actions.append(inWrap);
    li.append(avatar, info, actions);
    ul.appendChild(li);
  });
}

function memberMsg(text, kind) {
  const el = $("member-msg");
  el.textContent = text; el.className = "msg " + (kind || ""); el.hidden = !text;
}

$("create-group-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("group-name-input").value.trim();
  if (!name) return;
  // Insert WITHOUT selecting the row back. An INSERT ... RETURNING is rejected
  // by the SELECT policy here (its STABLE function can't see the just-inserted
  // row in the same statement). A plain insert + re-fetch works reliably.
  const { error } = await supabase.from("groups").insert({ name, owner_id: user.id });
  if (error) { alert("Could not create group: " + error.message); return; }
  await loadGroups();
  if (ownedGroup) {
    await supabase.from("group_members")
      .insert({ group_id: ownedGroup.id, email: user.email.toLowerCase(), user_id: user.id, role: "owner" });
    ownedMembers = await fetchMembers(ownedGroup.id);
  }
  renderFamily();
});

$("add-member-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!ownedGroup) return;
  const email = $("member-email").value.trim().toLowerCase();
  const role = $("member-role").value;
  if (!email) return;
  if (email === user.email.toLowerCase()) { memberMsg("That's you — you're already the owner.", "error"); return; }

  const { error } = await supabase.from("group_members")
    .insert({ group_id: ownedGroup.id, email, role });
  if (error) {
    memberMsg(error.code === "23505" ? "That email is already in the group." : error.message, "error");
    return;
  }
  memberMsg(`Added ${email} as ${roleLabel(role)}.`, "success");
  $("member-email").value = "";
  ownedMembers = await fetchMembers(ownedGroup.id);
  renderFamily();
});

async function updateMemberRole(id, role) {
  const { error } = await supabase.from("group_members").update({ role }).eq("id", id);
  if (error) { alert("Could not update role: " + error.message); return; }
  ownedMembers = await fetchMembers(ownedGroup.id);
  renderFamily();
}

async function removeMember(id, email) {
  if (!confirm(`Remove ${email} from the group?`)) return;
  const { error } = await supabase.from("group_members").delete().eq("id", id);
  if (error) { alert("Could not remove: " + error.message); return; }
  ownedMembers = await fetchMembers(ownedGroup.id);
  renderFamily();
}

// ----- shared family budget (owner / parent) -----
let famSaveTimer = null;
function famMoneyInput() {
  familyData.income = parseFloat($("fam-income-input").value) || 0;
  familyData.savings = parseFloat($("fam-savings-input").value) || 0;
  const p = monthPrefix(viewMonth);
  const monthExp = familyData.expenses.filter((e) => e.spent_on && e.spent_on.startsWith(p));
  const spent = monthExp.reduce((s, e) => s + e.amount, 0);
  $("fam-stat-income").textContent = fmt(familyData.income);
  $("fam-stat-savings").textContent = fmt(familyData.savings);
  const left = familyData.income - spent;
  const le = $("fam-stat-left"); le.textContent = fmt(left);
  le.style.color = left < 0 ? "var(--danger)" : "var(--good)";
  drawDonut($("fam-pie"), $("fam-legend"), $("fam-chart-empty"), groupedExpenses(monthExp), spent, familyData.income);
  scheduleFamilySave();
}
function scheduleFamilySave() {
  clearTimeout(famSaveTimer);
  $("fam-save-status").textContent = "…";
  famSaveTimer = setTimeout(async () => {
    const { error } = await supabase.rpc("set_family_budget", {
      gid: activeGroup.id, p_income: familyData.income, p_savings: familyData.savings,
    });
    $("fam-save-status").textContent = error ? "Couldn't save" : "Saved ✓";
    if (!error) setTimeout(() => ($("fam-save-status").innerHTML = "&nbsp;"), 1500);
  }, 600);
}
$("fam-income-input").addEventListener("input", famMoneyInput);
$("fam-savings-input").addEventListener("input", famMoneyInput);

async function setMemberAllowance(memberId, value) {
  const { error } = await supabase.rpc("set_member_allowance", { p_member: memberId, p_allowance: value });
  if (error) { alert("Couldn't set allowance: " + error.message); return; }
  await loadFamilyOverview();
  renderFamilyOverview();
}

async function removeFamilyExpense(id) {
  if (!confirm("Delete this expense?")) return;
  const { error } = await supabase.rpc("delete_family_expense", { p_expense: id });
  if (error) { alert("Couldn't delete: " + error.message); return; }
  await loadFamilyOverview();
  renderFamilyOverview();
}

// ----- family expense modal -----
const famModal = $("fam-modal");
function openFamModal(title) {
  $("fam-modal-title").textContent = title;
  $("fam-date").value = ymd(new Date());
  famModal.hidden = false;
  setTimeout(() => $("fam-amount").focus(), 50);
}
$("fam-add-btn").addEventListener("click", () => openFamModal("Add family expense"));
$("fam-kid-add-btn").addEventListener("click", () => openFamModal("Add expense"));
famModal.querySelectorAll("[data-close]").forEach((el) => el.addEventListener("click", () => { famModal.hidden = true; }));
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !famModal.hidden) famModal.hidden = true; });
$("fam-category").addEventListener("change", () => {
  const custom = $("fam-category").value === "__custom__";
  $("fam-custom").hidden = !custom;
  if (custom) $("fam-custom").focus();
});
$("fam-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const amount = parseFloat($("fam-amount").value);
  if (!amount || amount <= 0) return;
  const category = $("fam-category").value === "__custom__"
    ? ($("fam-custom").value.trim() || "Other") : $("fam-category").value;
  const date = $("fam-date").value || ymd(new Date());
  const note = $("fam-note-input").value.trim();
  const { error } = await supabase.rpc("add_family_expense", {
    gid: activeGroup.id, p_category: category, p_amount: amount, p_spent_on: date, p_note: note,
  });
  if (error) { alert("Could not add expense: " + error.message); return; }
  $("fam-amount").value = ""; $("fam-note-input").value = "";
  $("fam-custom").value = ""; $("fam-custom").hidden = true;
  $("fam-category").value = $("fam-category").options[0].value;
  famModal.hidden = true;
  await loadFamilyOverview();
  renderFamilyOverview();
});

// ===================== BUDGET INPUTS =====================
let saveTimer = null;
function scheduleBudgetSave() {
  clearTimeout(saveTimer);
  saveStatus.textContent = "…";
  saveTimer = setTimeout(saveBudget, 600);
}
incomeInput.addEventListener("input", () => { data.income = parseFloat(incomeInput.value) || 0; renderSummary(); renderChart(); scheduleBudgetSave(); });
savingsInput.addEventListener("input", () => { data.savings = parseFloat(savingsInput.value) || 0; renderSummary(); scheduleBudgetSave(); });

window.addEventListener("resize", () => { if (!appView.hidden && !$("tab-overview").hidden) renderChart(); });
