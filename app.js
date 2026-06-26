/* ============================================================
   Budget Circle — Supabase-backed budget tracker
   Real email + password auth, cloud database, per-user data
   secured by Row Level Security.
   ============================================================ */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

// ---------- Config check ----------
const configured =
  SUPABASE_URL &&
  SUPABASE_ANON_KEY &&
  !SUPABASE_URL.startsWith("YOUR_") &&
  !SUPABASE_ANON_KEY.startsWith("YOUR_");

if (!configured) {
  document.getElementById("config-banner").hidden = false;
}

const supabase = configured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

// ---------- App state ----------
let user = null;
let data = { income: 0, savings: 0, expenses: [] };

const COLORS = [
  "#6c8cff", "#36d399", "#ffb454", "#ff6b6b", "#a78bfa",
  "#f472b6", "#22d3ee", "#facc15", "#4ade80", "#fb923c",
];

// ---------- DOM refs ----------
const $ = (id) => document.getElementById(id);
const authView = $("auth-view");
const appView = $("app-view");
const authForm = $("auth-form");
const emailInput = $("email");
const passwordInput = $("password");
const authMsg = $("auth-msg");
const signinBtn = $("signin-btn");
const signupBtn = $("signup-btn");
const userEmailLabel = $("user-email");

const incomeInput = $("income-input");
const savingsInput = $("savings-input");
const saveStatus = $("save-status");
const expenseForm = $("expense-form");
const categorySelect = $("category-select");
const customCategory = $("custom-category");
const amountInput = $("amount-input");

const expenseList = $("expense-list");
const expenseEmpty = $("expense-empty");

const canvas = $("pie");
const chartEmpty = $("chart-empty");
const legend = $("legend");

// ---------- Helpers ----------
const fmt = (n) =>
  "$" + Number(n || 0).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });

function showMessage(text, kind) {
  authMsg.textContent = text;
  authMsg.className = "msg " + (kind || "");
  authMsg.hidden = !text;
}

function setBusy(busy) {
  signinBtn.disabled = busy;
  signupBtn.disabled = busy;
}

// ---------- Auth ----------
if (authForm) {
  authForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    await signIn();
  });
  signupBtn.addEventListener("click", signUp);
}

async function signIn() {
  if (!supabase) return;
  const email = emailInput.value.trim();
  const password = passwordInput.value;
  if (!email || !password) return;

  setBusy(true);
  showMessage("Signing in…", "");
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  setBusy(false);

  if (error) {
    showMessage(error.message, "error");
  } else {
    showMessage("", "");
  }
  // success handled by onAuthStateChange
}

async function signUp() {
  if (!supabase) return;
  const email = emailInput.value.trim();
  const password = passwordInput.value;
  if (!email || password.length < 6) {
    showMessage("Enter an email and a password of at least 6 characters.", "error");
    return;
  }

  setBusy(true);
  showMessage("Creating account…", "");
  const { data: res, error } = await supabase.auth.signUp({ email, password });
  setBusy(false);

  if (error) {
    showMessage(error.message, "error");
    return;
  }
  // If email confirmation is ON, there is no session yet.
  if (!res.session) {
    showMessage(
      "Account created! Check your email to confirm, then sign in.",
      "success"
    );
  }
  // If confirmation is OFF, onAuthStateChange fires and logs us in.
}

$("signout-btn").addEventListener("click", async () => {
  if (supabase) await supabase.auth.signOut();
});

// React to auth changes (initial load, sign in, sign out)
if (supabase) {
  supabase.auth.onAuthStateChange(async (_event, session) => {
    if (session && session.user) {
      user = session.user;
      await enterApp();
    } else {
      user = null;
      appView.hidden = true;
      authView.hidden = false;
      passwordInput.value = "";
    }
  });
}

// ---------- Data layer ----------
async function loadData() {
  // Budget (income + savings)
  const { data: budget } = await supabase
    .from("budgets")
    .select("income, savings")
    .eq("user_id", user.id)
    .maybeSingle();

  // Expenses
  const { data: expenses } = await supabase
    .from("expenses")
    .select("id, category, amount")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });

  data = {
    income: budget ? Number(budget.income) : 0,
    savings: budget ? Number(budget.savings) : 0,
    expenses: (expenses || []).map((e) => ({
      id: e.id,
      category: e.category,
      amount: Number(e.amount),
    })),
  };
}

async function saveBudget() {
  saveStatus.textContent = "Saving…";
  const { error } = await supabase.from("budgets").upsert(
    {
      user_id: user.id,
      income: data.income,
      savings: data.savings,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );
  saveStatus.textContent = error ? "Couldn't save" : "Saved ✓";
  if (!error) setTimeout(() => (saveStatus.innerHTML = "&nbsp;"), 1500);
}

async function addExpense(category, amount) {
  const { data: row, error } = await supabase
    .from("expenses")
    .insert({ user_id: user.id, category, amount })
    .select("id, category, amount")
    .single();
  if (error) {
    alert("Could not add expense: " + error.message);
    return;
  }
  data.expenses.push({
    id: row.id,
    category: row.category,
    amount: Number(row.amount),
  });
  renderAll();
}

async function removeExpense(id) {
  const { error } = await supabase.from("expenses").delete().eq("id", id);
  if (error) {
    alert("Could not delete: " + error.message);
    return;
  }
  data.expenses = data.expenses.filter((e) => e.id !== id);
  renderAll();
}

// ---------- Enter dashboard ----------
async function enterApp() {
  authView.hidden = true;
  appView.hidden = false;
  userEmailLabel.textContent = user.email;
  await loadData();
  incomeInput.value = data.income || "";
  savingsInput.value = data.savings || "";
  renderAll();
}

// ---------- Render ----------
function renderAll() {
  renderSummary();
  renderExpenses();
  renderChart();
}

function totalSpent() {
  return data.expenses.reduce((sum, e) => sum + Number(e.amount), 0);
}

function renderSummary() {
  const spent = totalSpent();
  $("stat-income").textContent = fmt(data.income);
  $("stat-spent").textContent = fmt(spent);
  $("stat-savings").textContent = fmt(data.savings);
  const left = Number(data.income) - spent;
  const leftEl = $("stat-left");
  leftEl.textContent = fmt(left);
  leftEl.style.color = left < 0 ? "var(--danger)" : "var(--good)";
}

function renderExpenses() {
  expenseList.innerHTML = "";
  if (data.expenses.length === 0) {
    expenseEmpty.hidden = false;
    return;
  }
  expenseEmpty.hidden = true;
  data.expenses.forEach((exp, i) => {
    const li = document.createElement("li");

    const left = document.createElement("div");
    left.className = "expense-cat";
    const dot = document.createElement("span");
    dot.style.cssText =
      "width:12px;height:12px;border-radius:50%;display:inline-block;background:" +
      COLORS[i % COLORS.length];
    const name = document.createElement("span");
    name.textContent = exp.category;
    left.appendChild(dot);
    left.appendChild(name);

    const right = document.createElement("div");
    right.className = "expense-cat";
    const amt = document.createElement("span");
    amt.className = "expense-amount";
    amt.textContent = fmt(exp.amount);
    const del = document.createElement("button");
    del.className = "del-btn";
    del.innerHTML = "&times;";
    del.title = "Delete";
    del.addEventListener("click", () => removeExpense(exp.id));
    right.appendChild(amt);
    right.appendChild(del);

    li.appendChild(left);
    li.appendChild(right);
    expenseList.appendChild(li);
  });
}

// ---------- Chart (grouped by category, pure canvas) ----------
function groupedExpenses() {
  const map = new Map();
  data.expenses.forEach((e) => {
    map.set(e.category, (map.get(e.category) || 0) + Number(e.amount));
  });
  return Array.from(map, ([category, amount]) => ({ category, amount }));
}

function renderChart() {
  const groups = groupedExpenses();
  const total = groups.reduce((s, g) => s + g.amount, 0);
  const ctx = canvas.getContext("2d");

  const size = 320;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  canvas.style.width = size + "px";
  canvas.style.height = size + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);

  legend.innerHTML = "";

  if (total === 0) {
    chartEmpty.hidden = false;
    return;
  }
  chartEmpty.hidden = true;

  const cx = size / 2;
  const cy = size / 2;
  const radius = 130;
  const innerRadius = 72;
  let start = -Math.PI / 2;

  groups.forEach((g, i) => {
    const slice = (g.amount / total) * Math.PI * 2;
    const color = COLORS[i % COLORS.length];

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, start, start + slice);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    start += slice;

    const li = document.createElement("li");
    const dot = document.createElement("span");
    dot.className = "dot";
    dot.style.background = color;
    const cat = document.createElement("span");
    cat.className = "legend-cat";
    cat.textContent = g.category;
    const val = document.createElement("span");
    val.className = "legend-val";
    const pct = Math.round((g.amount / total) * 100);
    val.textContent = fmt(g.amount) + " · " + pct + "%";
    li.appendChild(dot);
    li.appendChild(cat);
    li.appendChild(val);
    legend.appendChild(li);
  });

  // Doughnut hole
  ctx.beginPath();
  ctx.arc(cx, cy, innerRadius, 0, Math.PI * 2);
  ctx.fillStyle =
    getComputedStyle(document.body).getPropertyValue("--card").trim() || "#1c2138";
  ctx.fill();

  // Center label
  ctx.fillStyle = getComputedStyle(document.body).getPropertyValue("--muted").trim();
  ctx.font = "13px -apple-system, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("Total spent", cx, cy - 8);
  ctx.fillStyle = getComputedStyle(document.body).getPropertyValue("--text").trim();
  ctx.font = "bold 22px -apple-system, sans-serif";
  ctx.fillText(fmt(total), cx, cy + 16);
}

// ---------- Input wiring ----------
let saveTimer = null;
function scheduleBudgetSave() {
  clearTimeout(saveTimer);
  saveStatus.textContent = "…";
  saveTimer = setTimeout(saveBudget, 600);
}

incomeInput.addEventListener("input", () => {
  data.income = parseFloat(incomeInput.value) || 0;
  renderSummary();
  scheduleBudgetSave();
});

savingsInput.addEventListener("input", () => {
  data.savings = parseFloat(savingsInput.value) || 0;
  renderSummary();
  scheduleBudgetSave();
});

categorySelect.addEventListener("change", () => {
  const isCustom = categorySelect.value === "__custom__";
  customCategory.hidden = !isCustom;
  if (isCustom) customCategory.focus();
});

expenseForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const amount = parseFloat(amountInput.value);
  if (!amount || amount <= 0) return;

  let category =
    categorySelect.value === "__custom__"
      ? customCategory.value.trim() || "Other"
      : categorySelect.value;

  await addExpense(category, amount);

  amountInput.value = "";
  customCategory.value = "";
  customCategory.hidden = true;
  categorySelect.value = categorySelect.options[0].value;
});

window.addEventListener("resize", () => {
  if (!appView.hidden) renderChart();
});
