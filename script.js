

/* ================= GLOBAL ================= */

let expenses = JSON.parse(localStorage.getItem("gulData")) || [];
let previousTotal = 0;
let miniChart;

/* ================= NAVIGATION ================= */

function showSection(id){
  document.querySelectorAll(".section").forEach(s=>s.style.display="none");
  document.getElementById(id).style.display="block";
}
showSection("homeSection");

/* ================= ADD ================= */

function addExpense(){

  const category = document.getElementById("category").value;
  const amount = parseFloat(document.getElementById("amount").value);
  const description = document.getElementById("description").value;
  const customTime = document.getElementById("customTime").value;

  if(!amount) return;

  const finalTime = customTime ? new Date(customTime) : new Date();

  expenses.push({
    id: Date.now(),
    category,
    amount,
    description,
    date: finalTime.toISOString()
  });

  localStorage.setItem("gulData", JSON.stringify(expenses));

  document.getElementById("amount").value="";
  document.getElementById("description").value="";
  document.getElementById("customTime").value="";

  renderExpenses();
  updateHome();
  updateMiniChart();
}

/* ================= DELETE ================= */

function deleteExpense(id){
  expenses = expenses.filter(e=>e.id!==id);
  localStorage.setItem("gulData", JSON.stringify(expenses));
  renderExpenses();
  updateHome();
  updateMiniChart();
}

/* ================= EDIT ================= */

function editExpense(id){

  const exp = expenses.find(e=>e.id===id);
  if(!exp) return;

  const newAmount = prompt("Edit Amount:", exp.amount);
  const newDesc = prompt("Edit Description:", exp.description);

  if(newAmount!==null && !isNaN(newAmount)){
    exp.amount = parseFloat(newAmount);
  }

  if(newDesc!==null){
    exp.description = newDesc;
  }

  localStorage.setItem("gulData", JSON.stringify(expenses));
  renderExpenses();
  updateHome();
  updateMiniChart();
}

/* ================= COST PER CALCULATION ================= */
/* Advanced per-expense time logic — unchanged */

function calculateCostPer(){

  const now = new Date();

  let costMonth=0;
  let costDay=0;
  let costHour=0;
  let costMinute=0;

  expenses.forEach(e=>{

    const expenseTime = new Date(e.date);
    const diffMs = now - expenseTime;

    const minutes = Math.max(1, Math.floor(diffMs/60000));
    const hours   = Math.max(1, Math.floor(diffMs/3600000));
    const days    = Math.max(1, Math.floor(diffMs/86400000));
    const months  = Math.max(1, Math.floor(days/30.44));

    costMinute += e.amount / minutes;
    costHour   += e.amount / hours;
    costDay    += e.amount / days;
    costMonth  += e.amount / months;

  });

  return {costMonth, costDay, costHour, costMinute};
}

/* ================= HOME ================= */

function updateHome(){

  const now = new Date();
  const total = expenses.reduce((s,e)=>s+e.amount,0);
  const change = total - previousTotal;

  const color = change > 0 ? "#ef4444" : "#22c55e";

  document.getElementById("time").innerHTML =
    "Time: " + now.toLocaleTimeString();

  document.getElementById("total").innerHTML =
    `Total ₹${total.toFixed(2)}
     <span style="color:${color}">
     ${change>=0?"▲":"▼"} ${Math.abs(change).toFixed(2)}</span>`;

  const costs = calculateCostPer();

  document.getElementById("avgMonth").innerHTML =
    "Cost per Month ₹" + costs.costMonth.toFixed(2);

  document.getElementById("avgDay").innerHTML =
    "Cost per Day ₹" + costs.costDay.toFixed(2);

  document.getElementById("avgHour").innerHTML =
    "Cost per Hour ₹" + costs.costHour.toFixed(4);

  document.getElementById("avgMinute").innerHTML =
    "Cost per Minute ₹" + costs.costMinute.toFixed(6);

  updateMiniChart();

  previousTotal = total;
}

/* ================= MINI CHART ================= */

function initChart(){

  const ctx = document.getElementById("miniChart");

  miniChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: [],
      datasets: [{
        label: "Total per Day",
        data: [],
        borderWidth: 2,
        tension: 0.3,
        pointRadius: 4
      }]
    },
    options: {
      plugins: {
        legend: { display: false }
      },
      scales: {
        x: {
          display: true
        },
        y: {
          display: true
        }
      }
    }
  });
}

function updateMiniChart(){

  if(!miniChart) return;

  const grouped = {};

  // Group by date (YYYY-MM-DD)
  expenses.forEach(e => {
    const date = new Date(e.date).toISOString().split("T")[0];

    if(!grouped[date]){
      grouped[date] = 0;
    }

    grouped[date] += e.amount;
  });

  const labels = Object.keys(grouped).sort();
  const values = labels.map(date => grouped[date]);

  miniChart.data.labels = labels;
  miniChart.data.datasets[0].data = values;

  miniChart.update();
}
/* ================= RENDER ================= */

function renderExpenses(){

  const container = document.getElementById("expenseList");
  container.innerHTML = "";

  const search = document.getElementById("searchInput").value.toLowerCase();

  expenses.forEach(e=>{

    const combined = (
      e.category + " " +
      e.amount + " " +
      e.description + " " +
      new Date(e.date).toLocaleString()
    ).toLowerCase();

    if(!combined.includes(search)) return;

    container.innerHTML += `
      <div class="expenseItem">
        <b>${e.category}</b> ₹${e.amount}<br>
        ${e.description}<br>
        ${new Date(e.date).toLocaleString()}<br>
        <button onclick="editExpense(${e.id})">Edit</button>
        <button onclick="deleteExpense(${e.id})">Delete</button>
      </div>`;
  });
}

/* ================= LOOP ================= */
setInterval(() => {

  // Only update if Home section is visible
  if (document.getElementById("homeSection").style.display !== "none") {
    updateHome();
  }

}, 1000);

/* ================= INIT ================= */

window.addEventListener("DOMContentLoaded", () => {
  initChart();
  renderExpenses();
  updateHome();
});