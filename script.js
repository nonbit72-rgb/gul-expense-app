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
  ctx.moveTo(pad - 4, H - 
