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

async function deleteInjection(date) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(date);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
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
const deleteBtnEl = document.getElementById("deleteBtn");
const saveMsgEl = document.getElementById("saveMsg");
const confirmOverlayEl = document.getElementById("confirmOverlay");
const cancelDeleteBtnEl = document.getElementById("cancelDeleteBtn");
const confirmDeleteBtnEl = document.getElementById("confirmDeleteBtn");

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
  deleteBtnEl.classList.toggle("hidden", !locked);
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

deleteBtnEl.addEventListener("click", () => {
  confirmOverlayEl.classList.remove("hidden");
});

cancelDeleteBtnEl.addEventListener("click", () => {
  confirmOverlayEl.classList.add("hidden");
});

confirmOverlayEl.addEventListener("click", (e) => {
  if (e.target === confirmOverlayEl) confirmOverlayEl.classList.add("hidden");
});

confirmDeleteBtnEl.addEventListener("click", async () => {
  await deleteInjection(selectedDateStr);
  allRecords = await getAllInjections();
  isEditing = false;
  confirmOverlayEl.classList.add("hidden");
  render();
  saveMsgEl.textContent = "Injeksioni u fshi.";
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

// ---- Import / export ----------------------------------------------------------
const CSV_COLUMNS = ["date", "time", "side", "notes"];

const importBtnEl = document.getElementById("importBtn");
const importInputEl = document.getElementById("importInput");
const menuBtnEl = document.getElementById("menuBtn");
const dataMenuEl = document.getElementById("dataMenu");
const toolbarMsgEl = document.getElementById("toolbarMsg");

let toolbarMsgTimer = null;
function showToolbarMsg(text, isError = false) {
  toolbarMsgEl.textContent = text;
  toolbarMsgEl.classList.toggle("error", isError);
  clearTimeout(toolbarMsgTimer);
  toolbarMsgTimer = setTimeout(() => { toolbarMsgEl.textContent = ""; }, 5000);
}

function closeDataMenu() {
  dataMenuEl.classList.add("hidden");
  menuBtnEl.setAttribute("aria-expanded", "false");
}

function toCsv(records) {
  const esc = (v) => {
    const s = String(v ?? "");
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [CSV_COLUMNS.join(",")];
  for (const r of records) lines.push(CSV_COLUMNS.map((c) => esc(r[c])).join(","));
  return lines.join("\r\n");
}

// RFC 4180 style parser: handles quoted fields, escaped quotes and newlines inside quotes.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      rows.push(row); row = [];
    } else field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

function recordsFromCsv(text) {
  const rows = parseCsv(text.replace(/^\uFEFF/, ""));
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  if (!header.includes("date")) throw new Error("CSV pa kolonën 'date'.");
  return rows.slice(1).map((cells) => {
    const obj = {};
    header.forEach((h, i) => { obj[h] = cells[i] ?? ""; });
    return obj;
  });
}

// Returns a clean record or null if the row is unusable.
function normalizeRecord(raw) {
  if (!raw || typeof raw !== "object") return null;
  const date = String(raw.date ?? "").trim();
  const side = String(raw.side ?? "").trim().toLowerCase();
  const time = String(raw.time ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || toDateStr(parseDateStr(date)) !== date) return null;
  if (side !== "left" && side !== "right") return null;
  return {
    date,
    time: /^([01]\d|2[0-3]):[0-5]\d$/.test(time) ? time : "00:00",
    side,
    notes: String(raw.notes ?? "").trim(),
    updatedAt: Date.now(),
  };
}

async function deliverFile(filename, mime, content) {
  const file = new File([content], filename, { type: mime });
  // iOS home-screen apps ignore <a download>, so prefer the share sheet when files are shareable.
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return true;
    } catch (err) {
      if (err.name === "AbortError") return false;
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

async function exportData(format) {
  closeDataMenu();
  const records = await getAllInjections();
  if (!records.length) return showToolbarMsg("Nuk ka të dhëna për eksport.", true);

  const stamp = toDateStr(new Date());
  const exported =
    format === "json"
      ? await deliverFile(`injections-${stamp}.json`, "application/json", JSON.stringify(records, null, 2))
      : await deliverFile(`injections-${stamp}.csv`, "text/csv", "\uFEFF" + toCsv(records));
  if (exported) showToolbarMsg(`U eksportuan ${records.length} regjistrime.`);
}

async function importFile(file) {
  try {
    const text = await file.text();
    const isCsv = /\.csv$/i.test(file.name) || file.type === "text/csv";
    let rawRows;
    if (isCsv) {
      rawRows = recordsFromCsv(text);
    } else {
      const parsed = JSON.parse(text);
      rawRows = Array.isArray(parsed) ? parsed : parsed.injections;
      if (!Array.isArray(rawRows)) throw new Error("JSON duhet të jetë një listë regjistrimesh.");
    }

    const records = rawRows.map(normalizeRecord).filter(Boolean);
    const skipped = rawRows.length - records.length;
    if (!records.length) throw new Error("Asnjë regjistrim i vlefshëm në skedar.");

    // Single transaction: either everything is imported or nothing is.
    const db = await openDatabase();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      records.forEach((r) => store.put(r)); // same date => overwritten
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    allRecords = await getAllInjections();
    isEditing = false;
    render();
    showToolbarMsg(
      `U importuan ${records.length} regjistrime${skipped ? ` (${skipped} u anashkaluan)` : ""}.`
    );
  } catch (err) {
    showToolbarMsg(`Importi dështoi: ${err.message}`, true);
  }
}

importBtnEl.addEventListener("click", () => {
  closeDataMenu();
  importInputEl.click();
});
importInputEl.addEventListener("change", async () => {
  const file = importInputEl.files[0];
  importInputEl.value = ""; // allow re-importing the same file
  if (file) await importFile(file);
});

menuBtnEl.addEventListener("click", (e) => {
  e.stopPropagation();
  const open = dataMenuEl.classList.toggle("hidden") === false;
  menuBtnEl.setAttribute("aria-expanded", String(open));
});
document.addEventListener("click", closeDataMenu);
document.getElementById("exportJson").addEventListener("click", () => exportData("json"));
document.getElementById("exportCsv").addEventListener("click", () => exportData("csv"));

// ---- Init -------------------------------------------------------------------
(async function init() {
  allRecords = await getAllInjections();
  render();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
})();
