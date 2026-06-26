/* ============================================================
   Budget Circle — pure client-side budget tracker
   Data is stored in localStorage, namespaced by email.
   No backend required → works on GitHub Pages.
   ============================================================ */

(function () {
  "use strict";

  // ---------- Storage helpers ----------
  const SESSION_KEY = "budgetapp:session";
  const dataKey = (email) => "budgetapp:data:" + email.toLowerCase();

  function loadData(email) {
    try {
      const raw = localStorage.getItem(dataKey(email));
      if (raw) return JSON.parse(raw);
    } catch (e) {
      console.warn("Could not parse saved data", e);
    }
    return { income: 0, savings: 0, expenses: [] };
  }

  function saveData(email, data) {
    localStorage.setItem(dataKey(email), JSON.stringify(data));
  }

  // ---------- App state ----------
  let currentEmail = null;
  let data = { income: 0, savings: 0, expenses: [] };

  // Stable palette for chart slices
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
  const authError = $("auth-error");
  const userEmailLabel = $("user-email");

  const incomeInput = $("income-input");
  const savingsInput = $("savings-input");
  const expenseForm = $("expense-form");
  const categorySelect = $("category-select");
  const customCategory = $("custom-category");
  const amountInput = $("amount-input");

  const expenseList = $("expense-list");
  const expenseEmpty = $("expense-empty");

  const canvas = $("pie");
  const chartEmpty = $("chart-empty");
  const legend = $("legend");

  // ---------- Money formatting ----------
  const fmt = (n) =>
    "$" + Number(n || 0).toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });

  // ---------- Auth ----------
  function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  authForm.addEventListener("submit", function (e) {
    e.preventDefault();
    const email = emailInput.value.trim();
    if (!isValidEmail(email)) {
      authError.textContent = "Please enter a valid email address.";
      authError.hidden = false;
      return;
    }
    authError.hidden = true;
    signIn(email);
  });

  function signIn(email) {
    currentEmail = email.toLowerCase();
    localStorage.setItem(SESSION_KEY, currentEmail);
    data = loadData(currentEmail);
    showApp();
  }

  $("signout-btn").addEventListener("click", function () {
    localStorage.removeItem(SESSION_KEY);
    currentEmail = null;
    appView.hidden = true;
    authView.hidden = false;
    emailInput.value = "";
  });

  // ---------- Render ----------
  function showApp() {
    authView.hidden = true;
    appView.hidden = false;
    userEmailLabel.textContent = currentEmail;
    incomeInput.value = data.income || "";
    savingsInput.value = data.savings || "";
    renderAll();
  }

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
      dot.className = "dot";
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

  // ---------- Pie / circle chart (pure canvas, grouped by category) ----------
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

    // Handle high-DPI screens for crisp rendering
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
    const innerRadius = 72; // doughnut hole
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

      // Legend row
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

    // Center label: total spent
    ctx.fillStyle = getComputedStyle(document.body).getPropertyValue("--muted").trim();
    ctx.font = "13px -apple-system, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Total spent", cx, cy - 8);
    ctx.fillStyle = getComputedStyle(document.body).getPropertyValue("--text").trim();
    ctx.font = "bold 22px -apple-system, sans-serif";
    ctx.fillText(fmt(total), cx, cy + 16);
  }

  // ---------- Mutations ----------
  function persist() {
    if (currentEmail) saveData(currentEmail, data);
  }

  incomeInput.addEventListener("input", function () {
    data.income = parseFloat(incomeInput.value) || 0;
    persist();
    renderSummary();
  });

  savingsInput.addEventListener("input", function () {
    data.savings = parseFloat(savingsInput.value) || 0;
    persist();
    renderSummary();
  });

  categorySelect.addEventListener("change", function () {
    const isCustom = categorySelect.value === "__custom__";
    customCategory.hidden = !isCustom;
    if (isCustom) customCategory.focus();
  });

  expenseForm.addEventListener("submit", function (e) {
    e.preventDefault();
    const amount = parseFloat(amountInput.value);
    if (!amount || amount <= 0) return;

    let category;
    if (categorySelect.value === "__custom__") {
      category = customCategory.value.trim() || "Other";
    } else {
      category = categorySelect.value;
    }

    data.expenses.push({
      id: Date.now() + "-" + Math.random().toString(36).slice(2, 7),
      category,
      amount,
    });
    persist();
    renderAll();

    // reset form
    amountInput.value = "";
    customCategory.value = "";
    customCategory.hidden = true;
    categorySelect.value = categorySelect.options[0].value;
  });

  function removeExpense(id) {
    data.expenses = data.expenses.filter((e) => e.id !== id);
    persist();
    renderAll();
  }

  // ---------- Boot ----------
  const saved = localStorage.getItem(SESSION_KEY);
  if (saved) {
    signIn(saved);
  }

  // Redraw chart crisply if window resizes
  window.addEventListener("resize", function () {
    if (!appView.hidden) renderChart();
  });
})();
