'use strict';

/* ============================================================
   EXPENSE MANAGER — script.js
   
   Sections:
     1.  Constants & State
     2.  Database (IndexedDB helpers)
     3.  Navigation
     4.  Home Section
     5.  Budget Section
     6.  Add / Edit Expense Section
     7.  Expense List Section
     8.  Profile Section  ← Placeholder, easy to extend
     9.  Invoice Template ← Clearly separated, easy to customise
    10.  Utilities
    11.  Central Data-Changed Handler
    12.  Initialization
============================================================ */


/* ============================================================
   1. CONSTANTS & STATE
============================================================ */

const DB_NAME    = 'ExpenseManagerDB';
const DB_VERSION = 1;

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December'
];

// Predefined categories (used for CSV normalisation and form selector)
const PREDEFINED_CATS = ['Food & Dining','Travel','Shopping','College Expense','Other'];

// ---- Navigation state ----
let currentSection = 'home';

// ---- Timer handles ----
let clockTimer    = null;   // 1-second clock in Card 1
let rateTimer     = null;   // 1-second cost-rate recalc in Card 2

// ---- Calendar state ----
let calYear  = new Date().getFullYear();
let calMonth = new Date().getMonth();   // 0-indexed

// ---- Budget section state ----
let budgetYear = new Date().getFullYear();

// ---- Expense list state ----
let showAllExpenses = false;
let searchQuery     = '';

// ---- Edit state (null = adding new, number = ID of expense being edited) ----
let editingId = null;

// ---- In-memory data cache (avoids repeated DB scans) ----
let cachedExpenses = [];   // all expense records, sorted newest-first
let cachedBudgets  = [];   // all budget records

// ---- Touch-swipe tracking ----
let calSwipeStartX    = 0;
let budgetSwipeStartX = 0;


/* ============================================================
   2. DATABASE (IndexedDB)
============================================================ */

let db = null;

/** Open (or create) the IndexedDB database and its object stores. */
function initDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const database = e.target.result;

      // expenses store — auto-increment integer primary key
      if (!database.objectStoreNames.contains('expenses')) {
        const store = database.createObjectStore('expenses', {
          keyPath: 'id', autoIncrement: true
        });
        store.createIndex('by_timestamp', 'timestamp', { unique: false });
      }

      // budgets store — keyed by year (integer)
      if (!database.objectStoreNames.contains('budgets')) {
        database.createObjectStore('budgets', { keyPath: 'year' });
      }
    };

    req.onsuccess = (e) => { db = e.target.result; resolve(); };
    req.onerror   = (e) => reject(e.target.error);
  });
}

/** Fetch all records from a store. */
function dbGetAll(storeName) {
  return new Promise((resolve, reject) => {
    const req = db.transaction(storeName, 'readonly')
                  .objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

/** Fetch a single record by key. */
function dbGet(storeName, key) {
  return new Promise((resolve, reject) => {
    const req = db.transaction(storeName, 'readonly')
                  .objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

/** Insert or update a record. Returns the record key. */
function dbPut(storeName, data) {
  return new Promise((resolve, reject) => {
    const req = db.transaction(storeName, 'readwrite')
                  .objectStore(storeName).put(data);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

/** Delete a record by key. */
function dbDelete(storeName, key) {
  return new Promise((resolve, reject) => {
    const req = db.transaction(storeName, 'readwrite')
                  .objectStore(storeName).delete(key);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

/** Reload the in-memory cache from the database. */
async function refreshCache() {
  [cachedExpenses, cachedBudgets] = await Promise.all([
    dbGetAll('expenses'),
    dbGetAll('budgets')
  ]);
  // Keep expenses sorted newest-first throughout the app
  cachedExpenses.sort((a, b) => b.timestamp - a.timestamp);
}


/* ============================================================
   3. NAVIGATION
============================================================ */

function navigateTo(section) {
  // Tear down timers from the previous section
  if (currentSection === 'home') {
    stopClock();
    stopRateTimer();
  }

  // Swap active classes
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('section-' + section).classList.add('active');
  document.querySelector('.nav-btn[data-section="' + section + '"]').classList.add('active');

  currentSection = section;

  // Initialise the newly shown section
  switch (section) {
    case 'home':
      renderHomeCards();
      startClock();
      startRateTimer();
      break;
    case 'budget':
      renderBudget();
      break;
    case 'add':
      // If not already editing, reset to blank new-expense form
      if (editingId === null) resetAddForm();
      break;
    case 'expense':
      renderExpenses();
      break;
    case 'profile':
      renderProfile();
      break;
  }
}


/* ============================================================
   4. HOME SECTION
============================================================ */

/** Render all three home cards from the current cache. */
function renderHomeCards() {
  updateTimeDisplay();
  updateTotalExpense();
  updateCostRates();
  renderCalendar(calYear, calMonth);
}

// ---- Clock (Card 1) ----

function startClock() {
  stopClock();
  clockTimer = setInterval(updateTimeDisplay, 1000);
}

function stopClock() {
  if (clockTimer) { clearInterval(clockTimer); clockTimer = null; }
}

function updateTimeDisplay() {
  const now = new Date();
  const hh  = String(now.getHours()).padStart(2, '0');
  const mm  = String(now.getMinutes()).padStart(2, '0');
  const ss  = String(now.getSeconds()).padStart(2, '0');
  const el  = document.getElementById('display-time');
  if (el) el.textContent = `${hh}:${mm}:${ss}`;
}

// ---- Total Expense (Card 1) ----

function updateTotalExpense() {
  const total = cachedExpenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const el = document.getElementById('display-total');
  if (el) el.textContent = formatCurrency(total);
}

// ---- Cost Rates (Card 2) ----

function startRateTimer() {
  stopRateTimer();
  rateTimer = setInterval(updateCostRates, 1000);
}

function stopRateTimer() {
  if (rateTimer) { clearInterval(rateTimer); rateTimer = null; }
}

/**
 * Recalculate cost rates every second (only while home section is active).
 *
 * Formula per time unit:
 *   rate = Σ ( expense.amount / max(1, floor(elapsed_units_since_expense)) )
 *
 * Uses floor so 1.9 months → 1 month, not 2.
 * If elapsed = 0, treats as 1 to avoid division by zero.
 */
function updateCostRates() {
  const now     = Date.now();
  const MS_MIN  = 60 * 1000;
  const MS_HOUR = 60 * MS_MIN;
  const MS_DAY  = 24 * MS_HOUR;
  const MS_MON  = 30.44 * MS_DAY; // average month

  let perMonth = 0, perDay = 0, perHour = 0, perMinute = 0;

  for (const exp of cachedExpenses) {
    const amt     = Number(exp.amount) || 0;
    const elapsed = now - exp.timestamp;

    perMonth  += amt / Math.max(1, Math.floor(elapsed / MS_MON));
    perDay    += amt / Math.max(1, Math.floor(elapsed / MS_DAY));
    perHour   += amt / Math.max(1, Math.floor(elapsed / MS_HOUR));
    perMinute += amt / Math.max(1, Math.floor(elapsed / MS_MIN));
  }

  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = formatCurrency(val);
  };
  set('rate-month',  perMonth);
  set('rate-day',    perDay);
  set('rate-hour',   perHour);
  set('rate-minute', perMinute);
}

// ---- Calendar (Card 3) ----

/** Render the monthly calendar grid for the given year/month. */
function renderCalendar(year, month) {
  const titleEl = document.getElementById('cal-title');
  const gridEl  = document.getElementById('calendar-grid');
  if (!titleEl || !gridEl) return;

  titleEl.textContent = `${MONTH_NAMES[month]} ${year}`;

  // Build a Set of day-numbers that have at least one expense
  const startMS = new Date(year, month, 1).getTime();
  const endMS   = new Date(year, month + 1, 0, 23, 59, 59, 999).getTime();
  const expDays = new Set();
  for (const exp of cachedExpenses) {
    if (exp.timestamp >= startMS && exp.timestamp <= endMS) {
      expDays.add(new Date(exp.timestamp).getDate());
    }
  }

  const today      = new Date();
  const todayY     = today.getFullYear();
  const todayM     = today.getMonth();
  const todayD     = today.getDate();
  const firstWday  = new Date(year, month, 1).getDay(); // 0=Sun
  const daysInMon  = new Date(year, month + 1, 0).getDate();

  // Weekday headers
  let html = '<div class="cal-weekdays">';
  for (const d of ['Su','Mo','Tu','We','Th','Fr','Sa']) {
    html += `<div class="cal-wday">${d}</div>`;
  }
  html += '</div><div class="cal-days">';

  // Empty cells before the 1st
  for (let i = 0; i < firstWday; i++) {
    html += '<div class="cal-day empty"></div>';
  }

  for (let d = 1; d <= daysInMon; d++) {
    const isFuture = (year > todayY)
      || (year === todayY && month > todayM)
      || (year === todayY && month === todayM && d > todayD);
    const isToday  = (year === todayY && month === todayM && d === todayD);

    let cls = 'cal-day';
    if (isFuture)          cls += ' future';
    else if (expDays.has(d)) cls += ' has-expense';
    else                   cls += ' no-expense';
    if (isToday)           cls += ' today';

    html += `<div class="${cls}" onclick="showDayExpenses(${year},${month},${d})">${d}</div>`;
  }
  html += '</div>';

  gridEl.innerHTML = html;
}

/** Open the day popup showing all expenses for a clicked calendar day. */
function showDayExpenses(year, month, day) {
  const startMS = new Date(year, month, day).getTime();
  const endMS   = new Date(year, month, day, 23, 59, 59, 999).getTime();
  const dayExps = cachedExpenses.filter(e => e.timestamp >= startMS && e.timestamp <= endMS);

  document.getElementById('day-modal-title').textContent =
    `${day} ${MONTH_NAMES[month]} ${year}`;

  const content = document.getElementById('day-modal-content');
  if (dayExps.length === 0) {
    content.innerHTML = '<p class="text-muted" style="text-align:center;padding:20px">None</p>';
  } else {
    content.innerHTML = dayExps.map(e => `
      <div class="mini-expense-card">
        <div class="mini-expense-cat">${esc(e.category)}</div>
        <div class="mini-expense-amount">${formatCurrency(e.amount)}</div>
        ${e.description ? `<div class="mini-expense-desc">${esc(e.description)}</div>` : ''}
        <div class="mini-expense-time">${new Date(e.timestamp).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'})}</div>
      </div>
    `).join('');
  }

  document.getElementById('modal-day').style.display = 'flex';
}

function closeDayModal(event) {
  if (!event || event.target === document.getElementById('modal-day')) {
    document.getElementById('modal-day').style.display = 'none';
  }
}

/** Wire up the calendar prev/next buttons and touch-swipe. */
function initCalendarNav() {
  document.getElementById('cal-prev').addEventListener('click', () => {
    calMonth--;
    if (calMonth < 0) { calMonth = 11; calYear--; }
    renderCalendar(calYear, calMonth);
  });

  document.getElementById('cal-next').addEventListener('click', () => {
    calMonth++;
    if (calMonth > 11) { calMonth = 0; calYear++; }
    renderCalendar(calYear, calMonth);
  });

  // Swipe left = next month, swipe right = prev month
  const cal = document.getElementById('card-calendar');
  cal.addEventListener('touchstart', e => { calSwipeStartX = e.touches[0].clientX; }, { passive: true });
  cal.addEventListener('touchend', e => {
    const diff = calSwipeStartX - e.changedTouches[0].clientX;
    if (Math.abs(diff) < 50) return; // ignore short swipes
    if (diff > 0) { calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; } }
    else          { calMonth--; if (calMonth < 0)  { calMonth = 11; calYear--; } }
    renderCalendar(calYear, calMonth);
  }, { passive: true });
}


/* ============================================================
   5. BUDGET SECTION
============================================================ */

/** Render the entire budget section for the current budgetYear. */
function renderBudget() {
  document.getElementById('budget-year-label').textContent = budgetYear;
  updateBudgetSummary();
  drawAllCharts();
}

/** Recalculate and display the budget summary card. */
function updateBudgetSummary() {
  const budget      = cachedBudgets.find(b => b.year === budgetYear);
  const yearExps    = cachedExpenses.filter(e => new Date(e.timestamp).getFullYear() === budgetYear);
  const totalSpent  = yearExps.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const content     = document.getElementById('budget-summary-content');

  if (!budget) {
    content.innerHTML = `<p class="text-muted" style="text-align:center;">
      No budget set for ${budgetYear}.<br>Click <strong>+ Add</strong> to set one.
    </p>`;
    return;
  }

  const budgetAmt = Number(budget.amount) || 0;
  const surplus   = budgetAmt - totalSpent;
  const pct       = budgetAmt > 0 ? Math.min(100, (totalSpent / budgetAmt) * 100) : 0;
  const barColor  = pct >= 90 ? 'var(--btn-del)' : 'var(--btn-ok)';
  const surpCls   = surplus >= 0 ? 'accent' : 'text-danger';
  const surpLabel = surplus >= 0 ? 'Surplus' : 'Deficit';

  content.innerHTML = `
    <div class="summary-row">
      <span class="card-label">Annual Budget</span>
      <span class="value accent">${formatCurrency(budgetAmt)}</span>
    </div>
    <div class="summary-row">
      <span class="card-label">Total Spent</span>
      <span class="value">${formatCurrency(totalSpent)}</span>
    </div>
    <div class="summary-row">
      <span class="card-label">${surpLabel}</span>
      <span class="value ${surpCls}">${formatCurrency(Math.abs(surplus))}</span>
    </div>
    <div class="progress-label">
      <span class="card-label">Budget Used</span>
      <span class="card-label">${pct.toFixed(1)}%</span>
    </div>
    <div class="progress-bar-bg">
      <div class="progress-bar-fill" style="width:${pct}%; background:${barColor}"></div>
    </div>
  `;
}

// ---- Budget CRUD modals ----

function openAddBudgetModal() {
  document.getElementById('budget-modal-title').textContent = 'Add Budget';
  document.getElementById('budget-year-input').value   = budgetYear;
  document.getElementById('budget-amount-input').value = '';
  document.getElementById('modal-budget').style.display = 'flex';
}

function openEditBudgetModal() {
  const existing = cachedBudgets.find(b => b.year === budgetYear);
  document.getElementById('budget-modal-title').textContent = 'Edit Budget';
  document.getElementById('budget-year-input').value   = budgetYear;
  document.getElementById('budget-amount-input').value = existing ? existing.amount : '';
  document.getElementById('modal-budget').style.display = 'flex';
}

async function saveBudget() {
  const year   = parseInt(document.getElementById('budget-year-input').value, 10);
  const amount = parseFloat(document.getElementById('budget-amount-input').value);

  if (!year || isNaN(amount) || amount < 0) {
    showToast('Please enter a valid year and amount.'); return;
  }

  await dbPut('budgets', { year, amount });
  closeBudgetModal();
  await refreshCache();
  renderBudget();
  showToast(`Budget for ${year} saved!`);
}

async function deleteBudgetForYear() {
  if (!confirm(`Delete budget for ${budgetYear}?`)) return;
  await dbDelete('budgets', budgetYear);
  await refreshCache();
  renderBudget();
  showToast('Budget deleted.');
}

function closeBudgetModal(event) {
  if (!event || event.target === document.getElementById('modal-budget')) {
    document.getElementById('modal-budget').style.display = 'none';
  }
}

/** Wire up budget year navigation buttons and swipe. */
function initBudgetNav() {
  document.getElementById('budget-prev-year').addEventListener('click', () => {
    budgetYear--; if (currentSection === 'budget') renderBudget();
  });
  document.getElementById('budget-next-year').addEventListener('click', () => {
    budgetYear++; if (currentSection === 'budget') renderBudget();
  });

  const sect = document.getElementById('section-budget');
  sect.addEventListener('touchstart', e => { budgetSwipeStartX = e.touches[0].clientX; }, { passive: true });
  sect.addEventListener('touchend', e => {
    const diff = budgetSwipeStartX - e.changedTouches[0].clientX;
    if (Math.abs(diff) < 60) return;
    budgetYear += (diff > 0 ? 1 : -1);
    renderBudget();
  }, { passive: true });
}

// ---- Canvas Graph helpers ----

/**
 * Polyfill for CanvasRenderingContext2D.roundRect
 * (supported in Chrome 99+; this covers older browsers)
 */
function canvasRoundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y,     x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x,     y + h, r);
  ctx.arcTo(x,     y + h, x,     y,     r);
  ctx.arcTo(x,     y,     x + w, y,     r);
  ctx.closePath();
}

/** Redraw all three charts for the current budgetYear. */
function drawAllCharts() {
  const yearExps   = cachedExpenses.filter(e => new Date(e.timestamp).getFullYear() === budgetYear);
  const budget     = cachedBudgets.find(b => b.year === budgetYear);
  const budgetAmt  = budget ? Number(budget.amount) : 0;
  const totalSpent = yearExps.reduce((s, e) => s + (Number(e.amount) || 0), 0);

  // Category totals
  const catData = {};
  for (const exp of yearExps) {
    catData[exp.category] = (catData[exp.category] || 0) + Number(exp.amount);
  }

  // Monthly totals (index 0=Jan … 11=Dec)
  const monthly = Array(12).fill(0);
  for (const exp of yearExps) {
    monthly[new Date(exp.timestamp).getMonth()] += Number(exp.amount);
  }

  drawBarChart(document.getElementById('chart-bar'), budgetAmt, totalSpent);
  drawPieChart(document.getElementById('chart-pie'), catData);
  drawLineChart(document.getElementById('chart-line'), monthly);
}

/**
 * Graph 1 — Bar chart: Annual Budget vs Total Expense.
 */
function drawBarChart(canvas, budgetAmt, totalSpent) {
  if (!canvas) return;
  const W = canvas.width  = canvas.offsetWidth  || 300;
  const H = canvas.height = 200;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);

  const maxVal   = Math.max(budgetAmt, totalSpent, 1);
  const pad      = 50;
  const chartH   = H - 50;
  const barW     = (W - pad * 2) / 4;

  const drawBar = (x, val, fillColor, label) => {
    const bh  = (val / maxVal) * chartH;
    const by  = H - 30 - bh;

    ctx.fillStyle = fillColor;
    canvasRoundRect(ctx, x, by, barW, bh, 6);
    ctx.fill();

    ctx.fillStyle = '#8899aa';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(label, x + barW / 2, H - 10);

    ctx.fillStyle = '#ffffff';
    ctx.fillText(fmtShort(val), x + barW / 2, Math.max(by - 5, 14));
  };

  drawBar(pad,           budgetAmt,  '#00e5b0', 'Budget');
  drawBar(pad + barW * 2, totalSpent, '#7b2335', 'Spent');

  // Axis
  ctx.strokeStyle = '#1a3048';
  ctx.lineWidth   = 1;
  ctx.beginPath();
  ctx.moveTo(pad - 4, H - 30);
  ctx.lineTo(W - pad + 4, H - 30);
  ctx.stroke();
}

const PIE_PALETTE = ['#00e5b0','#00c896','#00a37f','#1a6b58','#0d7a66','#004d3a','#2d8c7a','#005c45'];

/**
 * Graph 2 — Pie/donut chart: category-wise expense breakdown.
 */
function drawPieChart(canvas, catData) {
  if (!canvas) return;
  const W   = canvas.width  = canvas.offsetWidth || 300;
  const H   = canvas.height = 240;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);

  const entries = Object.entries(catData).filter(([, v]) => v > 0);
  if (entries.length === 0) {
    ctx.fillStyle = '#445566';
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('No expenses this year', W / 2, H / 2);
    return;
  }

  const total  = entries.reduce((s, [, v]) => s + v, 0);
  const cx     = W / 2;
  const cy     = H / 2 - 14;
  const outerR = Math.min(W, H * 0.85) / 2 - 10;
  const innerR = outerR * 0.45; // donut hole

  let angle = -Math.PI / 2;

  entries.forEach(([, val], i) => {
    const slice = (val / total) * 2 * Math.PI;
    const color = PIE_PALETTE[i % PIE_PALETTE.length];

    // Slice
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, outerR, angle, angle + slice);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = '#0d1b2a';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Percentage label (only if slice is wide enough to show)
    if (slice > 0.25) {
      const mid = angle + slice / 2;
      const lx  = cx + (outerR * 0.7) * Math.cos(mid);
      const ly  = cy + (outerR * 0.7) * Math.sin(mid);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(((val / total) * 100).toFixed(0) + '%', lx, ly + 4);
    }

    angle += slice;
  });

  // Donut hole
  ctx.beginPath();
  ctx.arc(cx, cy, innerR, 0, 2 * Math.PI);
  ctx.fillStyle = '#112236';
  ctx.fill();

  // Centre total label
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 13px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(fmtShort(total), cx, cy + 5);

  // Legend row at bottom
  const legendY = cy + outerR + 12;
  let lx = 6;
  ctx.font = '10px sans-serif';
  entries.forEach(([cat, val], i) => {
    const swatch = PIE_PALETTE[i % PIE_PALETTE.length];
    const label  = cat.length > 14 ? cat.substring(0, 12) + '…' : cat;
    const tw     = ctx.measureText(label).width + 18;

    // Wrap to next row if needed
    if (lx + tw > W - 4 && i > 0) { lx = 6; /* overflow — skip */ }

    ctx.fillStyle = swatch;
    ctx.fillRect(lx, legendY, 10, 10);
    ctx.fillStyle = '#8899aa';
    ctx.textAlign = 'left';
    ctx.fillText(label, lx + 13, legendY + 9);
    lx += tw + 4;
  });
}

/**
 * Graph 3 — Line chart (stock-market style): month-wise expense totals.
 */
function drawLineChart(canvas, monthly) {
  if (!canvas) return;
  const W   = canvas.width  = canvas.offsetWidth || 300;
  const H   = canvas.height = 200;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);

  const maxVal = Math.max(...monthly, 1);
  const pL = 52, pR = 8, pT = 20, pB = 28;
  const cW = W - pL - pR;
  const cH = H - pT - pB;
  const stepX = cW / 11;

  const pts = monthly.map((v, i) => ({
    x: pL + i * stepX,
    y: pT + cH - (v / maxVal) * cH
  }));

  // Horizontal grid lines
  for (let i = 0; i <= 4; i++) {
    const gy = pT + (i / 4) * cH;
    ctx.strokeStyle = '#1a3048';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(pL, gy);
    ctx.lineTo(W - pR, gy);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = '#445566';
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(fmtShort(maxVal * (1 - i / 4)), pL - 4, gy + 3);
  }

  // Month labels on X-axis
  const shortMonths = ['J','F','M','A','M','J','J','A','S','O','N','D'];
  ctx.fillStyle = '#445566';
  ctx.font = '9px sans-serif';
  ctx.textAlign = 'center';
  pts.forEach((p, i) => ctx.fillText(shortMonths[i], p.x, H - pB + 14));

  // Gradient fill under the line
  const grad = ctx.createLinearGradient(0, pT, 0, pT + cH);
  grad.addColorStop(0, 'rgba(0,229,176,0.28)');
  grad.addColorStop(1, 'rgba(0,229,176,0)');

  ctx.beginPath();
  pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.lineTo(pts[11].x, pT + cH);
  ctx.lineTo(pts[0].x,  pT + cH);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // Main line
  ctx.beginPath();
  ctx.strokeStyle = '#00e5b0';
  ctx.lineWidth   = 2.5;
  ctx.lineJoin    = 'round';
  ctx.lineCap     = 'round';
  pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.stroke();

  // Data-point dots (only for months with spend)
  pts.forEach((p, i) => {
    if (monthly[i] === 0) return;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = '#00e5b0';
    ctx.fill();
    ctx.strokeStyle = '#0d1b2a';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  });
}


/* ============================================================
   6. ADD / EDIT EXPENSE SECTION
============================================================ */

/** Reset the add-expense form to a blank new-expense state. */
function resetAddForm() {
  editingId = null;
  document.getElementById('input-category').value     = 'Food & Dining';
  document.getElementById('custom-cat-group').style.display = 'none';
  document.getElementById('input-custom-cat').value   = '';
  document.getElementById('input-amount').value       = '';
  document.getElementById('input-desc').value         = '';
  document.getElementById('add-form-title').textContent = 'New Expense';
  document.getElementById('btn-confirm-expense').textContent = '✓ Confirm';
  document.getElementById('btn-cancel-edit').style.display  = 'none';

  // Pre-fill datetime to "now" in local time
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  document.getElementById('input-datetime').value = now.toISOString().slice(0, 16);
}

/** Show/hide the custom category input when "Other" is selected. */
function onCategoryChange() {
  const isOther = document.getElementById('input-category').value === 'Other';
  document.getElementById('custom-cat-group').style.display = isOther ? 'block' : 'none';
}

/** Handle form submit for both new expenses and edits. */
async function handleAddExpense() {
  // Resolve category
  let category = document.getElementById('input-category').value;
  if (category === 'Other') {
    const custom = document.getElementById('input-custom-cat').value.trim();
    category = custom || 'Other';
  }

  // Validate amount
  const amount = parseFloat(document.getElementById('input-amount').value);
  if (!amount || amount <= 0) { showToast('Please enter a valid amount.'); return; }

  // Validate datetime
  const dtVal = document.getElementById('input-datetime').value;
  if (!dtVal) { showToast('Please select a date and time.'); return; }

  const description = document.getElementById('input-desc').value.trim();
  const timestamp   = new Date(dtVal).getTime();
  const record      = { category, amount, description, timestamp, updatedAt: Date.now() };

  if (editingId !== null) {
    // UPDATE existing record in place — no duplicate created
    record.id = editingId;
  }

  await dbPut('expenses', record);
  await refreshCache();
  dataChanged();

  const msg = (editingId !== null) ? 'Expense updated!' : 'Expense added!';
  editingId = null;
  resetAddForm();
  showToast(msg);
  navigateTo('expense');
}

/** Cancel editing and return to the expense list. */
function cancelEdit() {
  editingId = null;
  resetAddForm();
  navigateTo('expense');
}

/** Parse and import expenses from a CSV file. */
async function handleCSVImport(event) {
  const file = event.target.files[0];
  if (!file) return;

  const statusEl = document.getElementById('csv-status');
  statusEl.textContent = 'Importing…';

  let text;
  try { text = await file.text(); }
  catch (e) { statusEl.textContent = '✕ Could not read file.'; return; }

  const lines = text.trim().split(/\r?\n/);
  // Skip header row if it contains a non-numeric "category" column
  const start = isNaN(parseFloat(lines[0].split(',')[1])) ? 1 : 0;

  let imported = 0, skipped = 0;

  for (let i = start; i < lines.length; i++) {
    // Split on comma but allow quoted fields
    const parts = lines[i].split(',');
    if (parts.length < 2) { skipped++; continue; }

    const category    = (parts[0] || '').trim();
    const amount      = parseFloat((parts[1] || '').trim());
    const description = (parts[2] || '').trim();
    const dateStr     = parts.slice(3).join(',').trim(); // date may contain commas if quoted

    if (!category || isNaN(amount) || amount <= 0) { skipped++; continue; }

    // Any category not in predefined list is kept as-is (treated as custom "Other")
    let timestamp = Date.now();
    if (dateStr) {
      const parsed = Date.parse(dateStr);
      if (!isNaN(parsed)) timestamp = parsed;
    }

    await dbPut('expenses', { category, amount, description, timestamp, updatedAt: Date.now() });
    imported++;
  }

  await refreshCache();
  dataChanged();
  event.target.value = '';

  statusEl.textContent = `✓ Imported ${imported} record${imported !== 1 ? 's' : ''}.`
    + (skipped ? ` ${skipped} row${skipped !== 1 ? 's' : ''} skipped.` : '');
}


/* ============================================================
   7. EXPENSE LIST SECTION
============================================================ */

/** Render the expense list, applying the current search filter. */
function renderExpenses() {
  const list = document.getElementById('expense-list');
  const q    = searchQuery.toLowerCase().trim();

  // Apply search filter
  let expenses = cachedExpenses;
  if (q) {
    expenses = expenses.filter(e => {
      const ds = new Date(e.timestamp).toLocaleString('en-IN').toLowerCase();
      return String(e.amount).includes(q)
          || (e.category    || '').toLowerCase().includes(q)
          || (e.description || '').toLowerCase().includes(q)
          || ds.includes(q);
    });
  }

  // Pagination
  const total     = expenses.length;
  const displayed = showAllExpenses ? expenses : expenses.slice(0, 10);

  // View-All button
  const btn = document.getElementById('view-all-btn');
  if (btn) {
    btn.style.display = total > 10 ? 'flex' : 'none';
    btn.textContent   = showAllExpenses
      ? 'Show Less'
      : `View All Expenses (${total})`;
  }

  if (total === 0) {
    list.innerHTML = '<p class="text-muted" style="text-align:center;padding:40px 0;">'
      + (q ? 'No results found.' : 'No expenses yet. Tap ➕ to add one.')
      + '</p>';
    return;
  }

  list.innerHTML = displayed.map(renderExpenseCard).join('');
}

/** Build the HTML string for a single expense card. */
function renderExpenseCard(exp) {
  const dateStr = new Date(exp.timestamp).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });

  return `
    <div class="expense-card">
      <div class="expense-card-left">
        <div class="expense-category">${esc(exp.category)}</div>
        <div class="expense-amount">${formatCurrency(exp.amount)}</div>
        ${exp.description ? `<div class="expense-description">${esc(exp.description)}</div>` : ''}
        <div class="expense-date">${dateStr}</div>
      </div>
      <div class="expense-card-actions">
        <button class="btn-icon btn-edit-icon"    onclick="editExpense(${exp.id})"   title="Edit">&#9998;</button>
        <button class="btn-icon btn-delete-icon"  onclick="deleteExpense(${exp.id})" title="Delete">&#10005;</button>
        <button class="btn-icon btn-invoice-icon" onclick="printInvoice(${exp.id})"  title="Print Invoice">&#128424;</button>
      </div>
    </div>`;
}

/** Handle typing in the search box. */
function onSearchInput(value) {
  searchQuery = value;
  showAllExpenses = false; // Reset pagination on new search
  renderExpenses();
}

/** Toggle between showing 10 expenses and all. */
function toggleViewAll() {
  showAllExpenses = !showAllExpenses;
  renderExpenses();
}

/** Delete an expense by ID after confirmation. */
async function deleteExpense(id) {
  if (!confirm('Delete this expense?')) return;
  await dbDelete('expenses', id);
  await refreshCache();
  dataChanged();
  renderExpenses();
  showToast('Expense deleted.');
}

/**
 * Pre-fill the Add form with an existing expense and switch to Add section.
 * Updating is handled in handleAddExpense() which detects editingId !== null.
 */
function editExpense(id) {
  const exp = cachedExpenses.find(e => e.id === id);
  if (!exp) return;

  editingId = id;

  // Determine if category is predefined or custom
  const isPredefined = PREDEFINED_CATS.includes(exp.category);
  document.getElementById('input-category').value = isPredefined ? exp.category : 'Other';

  if (!isPredefined) {
    document.getElementById('custom-cat-group').style.display = 'block';
    document.getElementById('input-custom-cat').value = exp.category;
  } else {
    document.getElementById('custom-cat-group').style.display = 'none';
    document.getElementById('input-custom-cat').value = '';
  }

  document.getElementById('input-amount').value = exp.amount;
  document.getElementById('input-desc').value   = exp.description || '';

  // Convert timestamp to datetime-local value (local timezone)
  const dt = new Date(exp.timestamp);
  dt.setMinutes(dt.getMinutes() - dt.getTimezoneOffset());
  document.getElementById('input-datetime').value = dt.toISOString().slice(0, 16);

  // Update form labels to indicate "edit" mode
  document.getElementById('add-form-title').textContent       = 'Edit Expense';
  document.getElementById('btn-confirm-expense').textContent  = '✓ Update';
  document.getElementById('btn-cancel-edit').style.display    = 'block';

  navigateTo('add');
}

/**
 * Export currently visible (filtered) expenses to a CSV file.
 * If a search filter is active, only the filtered results are exported.
 */
function exportCSV() {
  const q = searchQuery.toLowerCase().trim();
  let expenses = cachedExpenses;

  if (q) {
    expenses = expenses.filter(e => {
      const ds = new Date(e.timestamp).toLocaleString('en-IN').toLowerCase();
      return String(e.amount).includes(q)
          || (e.category    || '').toLowerCase().includes(q)
          || (e.description || '').toLowerCase().includes(q)
          || ds.includes(q);
    });
  }

  const header = 'Category,Amount,Description,Date\n';
  const rows   = expenses.map(e => {
    const cat  = (e.category    || '').replace(/,/g, ';');
    const desc = (e.description || '').replace(/,/g, ';');
    const date = new Date(e.timestamp).toISOString();
    return `${cat},${e.amount},${desc},${date}`;
  }).join('\n');

  const blob     = new Blob([header + rows], { type: 'text/csv' });
  const url      = URL.createObjectURL(blob);
  const anchor   = document.createElement('a');
  anchor.href    = url;
  anchor.download = `expenses_${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}


/* ============================================================
   8. PROFILE SECTION (Placeholder)
   ──────────────────────────────────────────────────────────
   This section is intentionally minimal. It is structured so
   that adding profile features requires no refactoring.

   TO ADD FEATURES:
   ─────────────────
   1. Add HTML inside #profile-content in index.html.
   2. Add JS logic below in this section (renderProfile, etc.).
   3. Add a 'settings' object store in initDB() for persistence.
   4. Use dbPut('settings', {key, value}) to save preferences.

   SUGGESTED ADDITIONS:
   ─────────────────────
   • User name and avatar upload
   • Currency symbol preference  (replace ₹ throughout)
   • Notification / reminder toggle
   • Export all data as JSON backup
   • Import / restore from JSON backup
   • Wipe all data with confirmation
   • App info (version, build date)
============================================================ */

function renderProfile() {
  // Placeholder — extend here without touching other sections
}


/* ============================================================
   9. INVOICE TEMPLATE
   ──────────────────────────────────────────────────────────
   To customise the invoice design, ONLY edit generateInvoiceHTML().
   The printInvoice() function handles opening/printing and should
   not need to be changed.

   Available fields in the `exp` object:
     exp.id          — unique integer ID
     exp.category    — expense category string
     exp.amount      — numeric amount
     exp.description — optional description string
     exp.timestamp   — Unix timestamp in milliseconds
============================================================ */

function generateInvoiceHTML(exp) {
  // ── Invoice Template — customise freely below ─────────────────
  // To change the design, only edit the strings in this function.
  // Available: exp.id, exp.category, exp.amount, exp.description, exp.timestamp
  var dateFormatted = new Date(exp.timestamp).toLocaleString('en-IN', {
    day: '2-digit', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
  var invoiceNum  = String(exp.id).padStart(6, '0');
  var todayStr    = new Date().toLocaleDateString('en-IN');
  var descRow     = exp.description
    ? '<div class="field"><span class="flabel">Description</span>'
      + '<span class="fvalue">' + esc(exp.description) + '</span></div>'
    : '';

  var css = [
    '* { box-sizing: border-box; margin: 0; padding: 0; }',
    'body { font-family: Courier New, Courier, monospace; background: #f5f8fa; color: #1a2030; padding: 32px 20px; }',
    '.invoice { max-width: 480px; margin: 0 auto; background: #ffffff; border-radius: 14px; overflow: hidden; box-shadow: 0 6px 32px rgba(0,0,0,0.12); }',
    '.inv-top { background: #0d1b2a; padding: 28px 28px 20px; border-bottom: 4px solid #00e5b0; }',
    '.inv-title { font-size: 26px; font-weight: 900; color: #00e5b0; letter-spacing: -1px; line-height: 1; }',
    '.inv-subtitle { font-size: 11px; color: #8899aa; margin-top: 3px; }',
    '.inv-meta { margin-top: 14px; display: flex; justify-content: space-between; align-items: flex-end; }',
    '.inv-num { font-size: 20px; color: #fff; font-weight: 700; }',
    '.inv-date { font-size: 11px; color: #8899aa; text-align: right; line-height: 1.5; }',
    '.inv-body { padding: 24px 28px; }',
    '.field { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px dashed #e0e8f0; }',
    '.field:last-of-type { border-bottom: none; }',
    '.flabel { font-size: 11px; color: #8899aa; text-transform: uppercase; letter-spacing: 0.6px; }',
    '.fvalue { font-size: 13px; color: #1a2030; font-weight: 600; text-align: right; max-width: 60%; }',
    '.total-row { margin: 20px 0 0; background: #f0fdf8; border: 2px solid #00e5b0; border-radius: 10px; padding: 16px 20px; display: flex; justify-content: space-between; align-items: center; }',
    '.total-label { font-size: 14px; color: #0d1b2a; font-weight: 700; }',
    '.total-value { font-size: 26px; color: #00c896; font-weight: 900; }',
    '.inv-footer { padding: 14px 28px; font-size: 10px; color: #c0ccd8; text-align: center; border-top: 1px solid #e8f0f8; }',
    '@media print { body { padding: 0; background: white; } .invoice { box-shadow: none; border-radius: 0; } }'
  ].join('\n');

  return '<!DOCTYPE html><html lang="en"><head>'
    + '<meta charset="UTF-8"/><title>Invoice #' + invoiceNum + '</title>'
    + '<style>' + css + '</style></head><body>'
    + '<div class="invoice">'
    +   '<div class="inv-top">'
    +     '<div class="inv-title">EXPENSE<br>MANAGER</div>'
    +     '<div class="inv-subtitle">Personal Finance Tracker</div>'
    +     '<div class="inv-meta">'
    +       '<div class="inv-num">#' + invoiceNum + '</div>'
    +       '<div class="inv-date">Issued<br>' + dateFormatted + '</div>'
    +     '</div>'
    +   '</div>'
    +   '<div class="inv-body">'
    +     '<div class="field"><span class="flabel">Category</span>'
    +       '<span class="fvalue">' + esc(exp.category) + '</span></div>'
    +     descRow
    +     '<div class="field"><span class="flabel">Date &amp; Time</span>'
    +       '<span class="fvalue">' + dateFormatted + '</span></div>'
    +     '<div class="total-row">'
    +       '<span class="total-label">Total Amount</span>'
    +       '<span class="total-value">' + formatCurrency(exp.amount) + '</span>'
    +     '</div>'
    +   '</div>'
    +   '<div class="inv-footer">Generated by Expense Manager &nbsp;&bull;&nbsp; ' + todayStr + '</div>'
    + '</div>'
    + '<script>window.onload=function(){window.print();}<\/script>'
    + '</body></html>';
  // ── End of customisable invoice template ──────────────────────
}

/** Open a new window with the invoice and trigger the browser's print dialog. */
function printInvoice(id) {
  const exp = cachedExpenses.find(e => e.id === id);
  if (!exp) { showToast('Expense not found.'); return; }

  const win = window.open('', '_blank', 'width=560,height=720');
  if (win) {
    win.document.write(generateInvoiceHTML(exp));
    win.document.close();
  } else {
    showToast('Allow pop-ups to print invoices.');
  }
}


/* ============================================================
   10. UTILITIES
============================================================ */

/** Format a number as Indian Rupee currency string. */
function formatCurrency(amount) {
  return '₹' + Number(amount || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

/** Short currency format for chart labels (e.g. ₹12.5K, ₹1.2L). */
function fmtShort(amount) {
  amount = Number(amount || 0);
  if (amount >= 100000) return '₹' + (amount / 100000).toFixed(1) + 'L';
  if (amount >= 1000)   return '₹' + (amount / 1000).toFixed(1) + 'K';
  return '₹' + Math.round(amount);
}

/** Escape HTML special characters to prevent XSS. */
function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Display a brief bottom toast notification. */
function showToast(message) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('show'), 2200);
}


/* ============================================================
   11. CENTRAL DATA-CHANGED HANDLER
   ──────────────────────────────────────────────────────────
   Call dataChanged() after every add / edit / delete operation.
   It refreshes only the currently visible section so we never
   do unnecessary work.
============================================================ */

function dataChanged() {
  switch (currentSection) {
    case 'home':
      updateTotalExpense();
      renderCalendar(calYear, calMonth);
      // Cost rates update themselves on the 1-second timer
      break;
    case 'budget':
      updateBudgetSummary();
      drawAllCharts();
      break;
    case 'expense':
      renderExpenses();
      break;
    // 'add' and 'profile' sections don't need updating
  }
}


/* ============================================================
   12. INITIALIZATION
============================================================ */

async function init() {
  // Open IndexedDB and pre-load all data into memory
  await initDB();
  await refreshCache();

  // Register the service worker for offline support
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./serviceworker.js')
      .catch(() => {}); // fail silently in dev environments
  }

  // Wire up calendar navigation
  initCalendarNav();

  // Wire up budget year navigation
  initBudgetNav();

  // Start on the Home section
  navigateTo('home');
}

// Kick everything off once the DOM is ready
window.addEventListener('DOMContentLoaded', init);
