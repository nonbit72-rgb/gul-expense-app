

/* ================= GLOBAL ================= */

let expenses = JSON.parse(localStorage.getItem("gulData")) || [];
let previousTotal = 0;
let miniChart;
let budgetChart;
let categoryChart;
let yearChart;

/* ================= NAVIGATION ================= */

function showSection(id){
  document.querySelectorAll(".section").forEach(s=>s.style.display="none");
  document.getElementById(id).style.display="block";
}
showSection("homeSection");
/*==================Budget==============*/
let monthlyBudget = parseFloat(localStorage.getItem("monthlyBudget")) || 0;
function setBudget(){
  monthlyBudget = parseFloat(document.getElementById("monthlyBudgetInput").value) || 0;
  localStorage.setItem("monthlyBudget", monthlyBudget);
  updateBudget();
}
function updateBudget(){

  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  const monthTotal = expenses
    .filter(e=>{
      const d=new Date(e.date);
      return d.getMonth()===currentMonth && d.getFullYear()===currentYear;
    })
    .reduce((sum,e)=>sum+e.amount,0);

  const diff = monthlyBudget - monthTotal;
  const statusDiv = document.getElementById("budgetStatus");
  const percentDiv = document.getElementById("budgetPercent");

  if(monthlyBudget <= 0){
    statusDiv.innerHTML = "No Budget Set";
    percentDiv.innerHTML = "";
    updateBudgetChart(0);
    return;
  }

  const percent = (monthTotal / monthlyBudget) * 100;

  if(diff >= 0){
    statusDiv.innerHTML = "Surplus: ₹" + diff.toFixed(2);
    statusDiv.style.color = "lightgreen";
  } else {
    statusDiv.innerHTML = "Deficit: ₹" + Math.abs(diff).toFixed(2);
    statusDiv.style.color = "red";
  }

  percentDiv.innerHTML = "Used: " + percent.toFixed(1) + "%";

  updateBudgetChart(monthTotal, percent);
  updateCategoryChart();
  updateYearChart();
}
function updateBudgetChart(monthTotal, percent){

  if(!budgetChart) return;

  let barColor = "#22c55e"; // green

  if(percent >= 100){
    barColor = "#ef4444"; // red
  } else if(percent >= 75){
    barColor = "#f59e0b"; // yellow
  }

  budgetChart.data.datasets[0].data = [
    monthlyBudget,
    monthTotal
  ];

  budgetChart.data.datasets[0].backgroundColor = [
    "#3b82f6",
    barColor
  ];

  budgetChart.update();
}
function updateCategoryChart(){

  if(!categoryChart) return;

  const grouped = {};

  expenses.forEach(e=>{
    if(!grouped[e.category]){
      grouped[e.category] = 0;
    }
    grouped[e.category] += e.amount;
  });

  categoryChart.data.labels = Object.keys(grouped);
  categoryChart.data.datasets[0].data = Object.values(grouped);

  categoryChart.update();
}
function updateYearChart(){

  if(!yearChart) return;

  const months = new Array(12).fill(0);
  const now = new Date();
  const currentYear = now.getFullYear();

  expenses.forEach(e=>{
    const d = new Date(e.date);
    if(d.getFullYear() === currentYear){
      months[d.getMonth()] += e.amount;
    }
  });

  yearChart.data.labels = [
    "Jan","Feb","Mar","Apr","May","Jun",
    "Jul","Aug","Sep","Oct","Nov","Dec"
  ];

  yearChart.data.datasets[0].data = months;

  yearChart.update();
}
function editBudget(){
  if(monthlyBudget <= 0) return;

  const newBudget = prompt("Edit Monthly Budget:", monthlyBudget);

  if(newBudget !== null && !isNaN(newBudget)){
    monthlyBudget = parseFloat(newBudget);
    localStorage.setItem("monthlyBudget", monthlyBudget);
    updateBudget();
  }
}

function deleteBudget(){
  if(confirm("Delete Monthly Budget?")){
    monthlyBudget = 0;
    localStorage.removeItem("monthlyBudget");
    document.getElementById("monthlyBudgetInput").value = "";
    updateBudget();
  }
}
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
  updateBudget();
}

/* ================= DELETE ================= */

function deleteExpense(id){
  expenses = expenses.filter(e=>e.id!==id);
  localStorage.setItem("gulData", JSON.stringify(expenses));
  renderExpenses();
  updateHome();
  updateMiniChart();
  updateBudget();
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
  updateBudget();
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

    // NATURAL NUMBER LOGIC
    let minutes = Math.floor(diffMs/60000);
    let hours   = Math.floor(diffMs/3600000);
    let days    = Math.floor(diffMs/86400000);

    // Real calendar month difference
    let months =
      (now.getFullYear() - expenseTime.getFullYear()) * 12 +
      (now.getMonth() - expenseTime.getMonth());

    if(now.getDate() < expenseTime.getDate()){
      months -= 1;
    }

    // Force natural number minimum 1
    minutes = minutes < 1 ? 1 : minutes;
    hours   = hours   < 1 ? 1 : hours;
    days    = days    < 1 ? 1 : days;
    months  = months  < 1 ? 1 : months;

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
function initBudgetCharts(){

  const budgetCtx = document.getElementById("budgetChart");
  const categoryCtx = document.getElementById("categoryChart");
  const yearCtx = document.getElementById("yearChart");

  // ================= BUDGET BAR =================
  budgetChart = new Chart(budgetCtx, {
    type: "bar",
    data: {
      labels: ["Budget", "Spent"],
      datasets: [{
        data: [0,0],
        borderRadius: 10
      }]
    },
    options:{
      plugins:{
        legend:{display:false}
      },
      scales:{
        x:{
          ticks:{color:"#e2e8f0"},
          grid:{display:false}
        },
        y:{
          ticks:{color:"#e2e8f0"},
          grid:{color:"rgba(255,255,255,0.1)"}
        }
      }
    }
  });


  // ================= CATEGORY DOUGHNUT =================
  categoryChart = new Chart(categoryCtx, {
    type: "doughnut",
    data: {
      labels: [],
      datasets: [{
        data: [],
        borderWidth: 2,
        borderColor:"#0f172a",
        backgroundColor:[
          "#3b82f6",
          "#22c55e",
          "#f59e0b",
          "#ef4444",
          "#8b5cf6",
          "#06b6d4"
        ]
      }]
    },
    options: {
      cutout: "60%",
      plugins:{
        legend:{
          position:"bottom",
          labels:{
            color:"#e2e8f0",
            padding:15
          }
        }
      }
    }
  });


  // ================= YEAR LINE CHART =================
  yearChart = new Chart(yearCtx, {
    type: "line",
    data: {
      labels: [],
      datasets: [{
        data: [],
        borderWidth: 3,
        tension: 0.4,
        fill:true,
        backgroundColor:"rgba(59,130,246,0.2)",
        borderColor:"#3b82f6",
        pointBackgroundColor:"#3b82f6",
        pointRadius:5
      }]
    },
    options:{
      plugins:{
        legend:{display:false}
      },
      scales:{
        x:{
          ticks:{color:"#e2e8f0"},
          grid:{display:false}
        },
        y:{
          ticks:{color:"#e2e8f0"},
          grid:{color:"rgba(255,255,255,0.1)"}
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
   const d = new Date(e.date);

const date = d.toLocaleDateString("en-US", {
  month: "short",
  day: "numeric"
});
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
/*--------export------------*/
function exportPDF(){

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  let y = 10;

  doc.setFontSize(16);
  doc.text("GUL Expense Report", 10, y);
  y += 10;

  doc.setFontSize(10);

  expenses.forEach((e, index) => {

    const line = 
      `${index+1}. ${e.category} | ₹${e.amount} | ${e.description} | ${new Date(e.date).toLocaleString()}`;

    doc.text(line, 10, y);
    y += 7;

    if(y > 280){
      doc.addPage();
      y = 10;
    }

  });

  doc.save("Expense_Report.pdf");
}
function exportCSV(){

  let csv = "Category,Amount,Description,Date\n";

  expenses.forEach(e=>{
    csv += `${e.category},${e.amount},"${e.description}",${new Date(e.date).toLocaleString()}\n`;
  });

  const blob = new Blob([csv], { type: "text/csv" });
  const url = window.URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = "Expense_Report.csv";
  a.click();

  window.URL.revokeObjectURL(url);
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
  initBudgetCharts();   
  renderExpenses();
  updateMiniChart();
  updateHome();
  updateBudget();       
});