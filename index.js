// ---- IndexedDB helpers -----------------------------------------------------
const DB_NAME = "injectionTrackerDB";
const STORE_NAME = "injections";
let dbPromise = null;

function openDatabase() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "date" }); // one record per day
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

async function saveInjection(record) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getAllInjections() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result.sort((a, b) => a.date.localeCompare(b.date)));
    request.onerror = () => reject(request.error);
  });
}

// ---- Date helpers -----------------------------------------------------------
function toDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseDateStr(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function daysBetween(dateStrA, dateStrB) {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((parseDateStr(dateStrB) - parseDateStr(dateStrA)) / msPerDay);
}

function formatDateLabel(dateStr) {
  return parseDateStr(dateStr).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function currentTimeStr() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

function opposite(side) {
  return side === "left" ? "right" : "left";
}

// ---- Recommendation logic ----------------------------------------------------
function computeRecommendation(selectedDateStr, allRecords) {
  const existing = allRecords.find((r) => r.date === selectedDateStr);
  if (existing) {
    return { side: existing.side, source: "logged", record: existing };
  }

  const previous = allRecords
    .filter((r) => r.date < selectedDateStr)
    .sort((a, b) => b.date.localeCompare(a.date))[0];

  if (!previous) {
    return { side: "left", source: "default" };
  }

  const diff = daysBetween(previous.date, selectedDateStr);
  const side = diff % 2 === 0 ? previous.side : opposite(previous.side);
  return { side, source: "recommended", basedOn: previous };
}

// ---- App state ----------------------------------------------------------------
const sideNames = { left: "E MAJTË", right: "E DJATHTË" };
const sideImages = { left: "assets/left.png", right: "assets/right.png" };

let selectedDateStr = toDateStr(new Date());
let currentSide = "left";
let allRecords = [];
let isEditing = false; // true once the user explicitly unlocks an already-logged day

// ---- DOM refs -------------------------------------------------------------
const dateLabelEl = document.getElementById("dateLabel");
const datePickerEl = document.getElementById("datePicker");
const statusCardEl = document.getElementById("statusCard");
const armImageEl = document.getElementById("armImage");
const armVisualEl = document.getElementById("armVisual");
const armLabelEl = document.getElementById("armLabel");
const timeInputEl = document.getElementById("timeInput");
const notesInputEl = document.getElementById("notesInput");
const submitBtnEl = document.getElementById("submitBtn");
const editBtnEl = document.getElementById("editBtn");
const saveMsgEl = document.getElementById("saveMsg");

function setArm(side) {
  currentSide = side;
  armImageEl.src = sideImages[side];
  armImageEl.alt = `Krahu ${sideNames[side]}`;
  armLabelEl.textContent = sideNames[side];
}

function setLocked(locked) {
  timeInputEl.disabled = locked;
  notesInputEl.disabled = locked;
  armVisualEl.classList.toggle("locked", locked);
  submitBtnEl.classList.toggle("hidden", locked);
  editBtnEl.classList.toggle("hidden", !locked);
}

function render() {
  dateLabelEl.textContent = formatDateLabel(selectedDateStr);
  datePickerEl.value = selectedDateStr;
  saveMsgEl.textContent = "";

  const recommendation = computeRecommendation(selectedDateStr, allRecords);
  setArm(recommendation.side);

  statusCardEl.classList.remove("logged", "recommended", "default");

  if (recommendation.source === "logged") {
    const r = recommendation.record;
    statusCardEl.classList.add("logged");
    statusCardEl.innerHTML = `✅ Injeksioni për këtë ditë u regjistrua në krahun <strong>${sideNames[r.side]}</strong> në orën <strong>${r.time}</strong>.${r.notes ? `<br>Shënime: ${escapeHtml(r.notes)}` : ""}${isEditing ? "<br><em>Në modë editimi...</em>" : ""}`;
    timeInputEl.value = r.time;
    notesInputEl.value = r.notes || "";
    submitBtnEl.textContent = "Përditëso Injeksionin";
    setLocked(!isEditing);
  } else if (recommendation.source === "recommended") {
    const b = recommendation.basedOn;
    statusCardEl.classList.add("recommended");
    statusCardEl.innerHTML = `💡 Rekomandohet krahu <strong>${sideNames[recommendation.side]}</strong>, bazuar në injeksionin e fundit (${sideNames[b.side]}) të datës ${formatDateLabel(b.date)}.`;
    timeInputEl.value = currentTimeStr();
    notesInputEl.value = "";
    submitBtnEl.textContent = "Ruaj Injeksionin";
    setLocked(false);
  } else {
    statusCardEl.classList.add("default");
    statusCardEl.textContent = "Nuk ka rekorde të mëparshme. Zgjidh krahun për injeksionin e parë.";
    timeInputEl.value = currentTimeStr();
    notesInputEl.value = "";
    submitBtnEl.textContent = "Ruaj Injeksionin";
    setLocked(false);
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function changeDateByDays(delta) {
  const d = parseDateStr(selectedDateStr);
  d.setDate(d.getDate() + delta);
  selectedDateStr = toDateStr(d);
  isEditing = false;
  render();
}

// ---- Event wiring ---------------------------------------------------------
document.getElementById("prevDay").addEventListener("click", () => changeDateByDays(-1));
document.getElementById("nextDay").addEventListener("click", () => changeDateByDays(1));
document.getElementById("todayBtn").addEventListener("click", () => {
  selectedDateStr = toDateStr(new Date());
  isEditing = false;
  render();
});

datePickerEl.addEventListener("change", () => {
  if (datePickerEl.value) {
    selectedDateStr = datePickerEl.value;
    isEditing = false;
    render();
  }
});

armVisualEl.addEventListener("click", () => {
  if (armVisualEl.classList.contains("locked")) return;
  setArm(opposite(currentSide));
});

editBtnEl.addEventListener("click", () => {
  isEditing = true;
  render();
});

submitBtnEl.addEventListener("click", async () => {
  const record = {
    date: selectedDateStr,
    time: timeInputEl.value || currentTimeStr(),
    side: currentSide,
    notes: notesInputEl.value.trim(),
    updatedAt: Date.now(),
  };
  await saveInjection(record);
  allRecords = await getAllInjections();
  isEditing = false;
  render();
  saveMsgEl.textContent = "Ruajtur me sukses!";
});

// ---- Init -------------------------------------------------------------------
(async function init() {
  allRecords = await getAllInjections();
  render();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
})();
