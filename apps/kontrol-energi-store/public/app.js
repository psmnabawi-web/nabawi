import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import {
  collection,
  doc,
  documentId,
  endAt,
  getDocs,
  getDocFromServer,
  getDocsFromServer,
  getFirestore,
  limit as queryLimit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  startAfter,
  startAt,
  where,
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

const content = document.querySelector("#appContent");
const toast = document.querySelector("#toast");
const syncStatus = document.querySelector("#syncStatus");
const config = window.firebaseConfig || {};

function initialTabFromLocation() {
  try {
    const requested = new URL(window.location.href).searchParams.get("tab");
    return KNOWN_TABS.includes(requested) ? requested : "dashboard";
  } catch {
    return "dashboard";
  }
}
const APP_VERSION = "1.1.4";
const KNOWN_TABS = ["dashboard", "stores", "capture", "token", "history", "master"];
const state = {
  tab: initialTabFromLocation(),
  stores: [],
  meters: [],
  readings: [],
  selectedMeterId: "",
  selectedDashboardStoreId: "",
  selectedTokenMeterId: "",
};
let firebaseApp;
let db;
let userId = "";
let masterSource = "Master Electric.xlsx";
let masterVersion = "";
let unsubscribeReadings = null;
let liveDataReady = false;
let lastCloudSyncAt = null;
let historyBoundary = "";
let historyCursor = null;
let historyLoading = false;
let historyFullyLoaded = false;
let historyLoadError = "";
let refreshNoticePending = false;
let liveReadingIds = new Set();
let historyReadingIds = new Set();
let captureTokenRows = [];
let captureTokenMeterId = "";
let captureTokenState = null;
let captureTokenLoading = false;
let captureTokenError = "";
let tokenHistoryRows = [];
let tokenHistoryMeterId = "";
let tokenHistoryState = null;
let tokenHistoryLoading = false;
let tokenHistoryError = "";
let tokenHistoryRequestEpoch = 0;
let formSaveInFlight = false;

const nf = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 });
const meterReadingFormat = new Intl.NumberFormat("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false });
const rupiah = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
const tariffRupiah = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const MAX_READING_INTEGER_DIGITS = 12;
const MAX_READING_DECIMAL_DIGITS = 2;
const MAX_READING_KWH = 999999999999.99;
const MAX_TOKEN_PURCHASE_RP = 999999999;
const MAX_TOKEN_PURCHASE_HISTORY = 200;
const TOKEN_LINK_SCHEMA_VERSION = 1;
const BUSINESS_TIME_ZONE = "Asia/Jakarta";
const businessDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: BUSINESS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const localDate = (date = new Date()) => {
  const parts = Object.fromEntries(businessDateFormatter.formatToParts(date)
    .filter((part) => part.type !== "literal")
    .map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
};
const rollingStartDate = (days = 14) => {
  const [year, month, day] = localDate().split("-").map(Number);
  return localDate(new Date(Date.UTC(year, month - 1, day - days, 12)));
};
const h = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
const csvCell = (value) => {
  const raw = String(value ?? "");
  const safe = /^[=+\-@]/.test(raw.trimStart()) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
};
const timestampMillis = (value) => {
  if (!value) return NaN;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.toDate === "function") return value.toDate().getTime();
  return new Date(value).getTime();
};
const purchaseSort = (a, b) => timestampMillis(b.serverRecordedAt || b.purchasedAt) - timestampMillis(a.serverRecordedAt || a.purchasedAt);
const flags = (reading) => Array.isArray(reading.anomalyFlags) ? reading.anomalyFlags : [];
const configuredDailyLimit = (meter) => {
  const value = Number(meter?.maxDailyKwh);
  return Number.isFinite(value) && value > 0 ? value : null;
};
const theoreticalDailyLimit = (meter) => {
  const meterPower = Number(meter?.meterPower);
  return Number.isFinite(meterPower) && meterPower > 0 ? meterPower / 1000 * 24 : null;
};
const normalLimit = (meter) => configuredDailyLimit(meter) ?? theoreticalDailyLimit(meter);
const electricityModelLabel = (model) => model === "prepaid" ? "Prabayar" : model === "postpaid" ? "Pascabayar" : "Model belum dikenal";
const readingBasisForModel = (model) => model === "prepaid" ? "remaining_balance" : "cumulative_consumption";
const readingBasisLabel = (basis) => basis === "remaining_balance" ? "Sisa kWh" : basis === "cumulative_consumption" ? "Meter kumulatif" : "Format lama";
const readingSort = (a, b) => String(b.capturedAt || b.readingDate).localeCompare(String(a.capturedAt || a.readingDate));
const previousReadingSort = (a, b) => String(b.readingDate).localeCompare(String(a.readingDate)) || readingSort(a, b);
const previousReadingForMeter = (meterId, readingDate = localDate()) => {
  const meter = state.meters.find((item) => item.id === meterId);
  const store = state.stores.find((item) => item.id === meter?.storeId);
  const model = store?.electricityModel;
  return state.readings
    .filter((row) => {
      if (row.meterId !== meterId || row.status === "rejected" || row.status === "needs_review" || String(row.readingDate) >= readingDate) return false;
      if (model === "prepaid") return row.electricityModel === "prepaid" && row.readingBasis === "remaining_balance";
      if (model === "postpaid") return !row.electricityModel || (row.electricityModel === "postpaid" && row.readingBasis === "cumulative_consumption");
      return false;
    })
    .sort(previousReadingSort)[0];
};
const todayReadingForMeter = (meterId, readingDate = localDate()) => state.readings
  .find((row) => row.meterId === meterId && row.readingDate === readingDate);
const visibleHistoryReadings = () => state.readings.filter((row) => liveReadingIds.has(row.id) || historyReadingIds.has(row.id));
const activeMasterReadings = () => {
  const activeStoreIds = new Set(state.stores.filter((store) => store.active !== false).map((store) => store.id));
  const activeMeters = new Map(state.meters.filter((meter) => meter.active !== false && activeStoreIds.has(meter.storeId)).map((meter) => [meter.id, meter]));
  return state.readings.filter((reading) => {
    const meter = activeMeters.get(reading.meterId);
    return Boolean(meter && meter.storeId === reading.storeId);
  });
};
const flagLabel = { baseline_only: "Pembacaan awal", usage_above_limit: "Pemakaian di atas batas", capture_time_shift: "Jam input bergeser", zero_usage: "Pemakaian nol", manual_input: "Input manual", low_ocr_confidence: "Keyakinan OCR rendah", ocr_corrected: "Hasil OCR dikoreksi" };
const dashboardStatusMeta = {
  missing: { label: "Belum input", className: "missing" },
  baseline: { label: "Baseline", className: "baseline" },
  valid: { label: "Valid", className: "valid" },
  anomaly: { label: "Perlu cek", className: "anomaly" },
  legacy: { label: "Data lama", className: "legacy" },
  rejected: { label: "Ditolak", className: "rejected" },
};

function reading24hValue(reading) {
  if (!reading || reading.previousReadingKwh == null || reading.usageKwh == null) return null;
  const normalized = Number(reading.normalized24hKwh);
  if (Number.isFinite(normalized) && normalized >= 0) return normalized;
  const usage = Number(reading.usageKwh);
  return Number.isFinite(usage) && usage >= 0 ? usage : null;
}

function dashboardReadingStatus(reading, meter) {
  if (!reading) return "missing";
  if (reading.status === "rejected") return "rejected";
  const store = state.stores.find((item) => item.id === meter?.storeId);
  if (store?.electricityModel === "prepaid" && (reading.electricityModel !== "prepaid" || reading.readingBasis !== "remaining_balance")) return "legacy";
  if (store?.electricityModel === "postpaid" && reading.electricityModel && (reading.electricityModel !== "postpaid" || reading.readingBasis !== "cumulative_consumption")) return "legacy";
  if (reading.previousReadingKwh == null || reading.usageKwh == null) return "baseline";
  const value24h = reading24hValue(reading);
  const limit = normalLimit(meter);
  const overPhysicalOrConfiguredLimit = value24h !== null && limit !== null && value24h > limit;
  if (reading.status === "needs_review" || flags(reading).includes("usage_above_limit") || overPhysicalOrConfiguredLimit) return "anomaly";
  return "valid";
}

function validEnergyReading(reading) {
  const meter = state.meters.find((item) => item.id === reading?.meterId);
  return Boolean(meter && dashboardReadingStatus(reading, meter) === "valid");
}

function latestReadingForStore(storeId) {
  const store = state.stores.find((item) => item.id === storeId);
  return activeMasterReadings()
    .filter((row) => {
      if (row.storeId !== storeId || row.status === "rejected" || row.status === "needs_review") return false;
      if (store?.electricityModel === "prepaid") return row.electricityModel === "prepaid" && row.readingBasis === "remaining_balance";
      if (store?.electricityModel === "postpaid") return !row.electricityModel || (row.electricityModel === "postpaid" && row.readingBasis === "cumulative_consumption");
      return false;
    })
    .sort(readingSort)[0] || null;
}

function formatDateTime(value) {
  if (!value) return "–";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "–";
  return date.toLocaleString("id-ID", { timeZone: BUSINESS_TIME_ZONE, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function formatReadingDateShort(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return String(value || "–");
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toLocaleDateString("id-ID", { day: "2-digit", month: "short", timeZone: "UTC" });
}

function historyBarHeight(value, maxValue, useLogScale = false) {
  const numericValue = Number(value);
  const numericMax = Number(maxValue);
  if (!Number.isFinite(numericValue) || numericValue < 0 || !Number.isFinite(numericMax) || numericMax <= 0) return 0;
  if (numericValue === 0) return 4;
  const ratio = useLogScale
    ? Math.log1p(numericValue) / Math.log1p(numericMax)
    : numericValue / numericMax;
  return Math.max(8, Math.min(100, ratio * 100));
}

const readingPartialPattern = new RegExp(`^\\d{0,${MAX_READING_INTEGER_DIGITS}}(?:,\\d{0,${MAX_READING_DECIMAL_DIGITS}})?$`);

function standardizeDecimalSeparator(rawValue) {
  const raw = String(rawValue ?? "");
  const dotCount = (raw.match(/\./g) || []).length;
  return dotCount === 1 && !raw.includes(",") ? raw.replace(".", ",") : raw;
}

function sanitizeReadingText(rawValue) {
  const standardized = standardizeDecimalSeparator(String(rawValue ?? "").trim());
  return readingPartialPattern.test(standardized) ? standardized : "";
}

function normalizeReadingText(rawValue) {
  const sanitized = sanitizeReadingText(rawValue);
  if (!sanitized) return "";
  const [integerPart, decimalPart] = sanitized.split(",");
  if (!integerPart.length) return "";
  const normalizedInteger = integerPart.replace(/^0+(?=\d)/, "") || "0";
  if (decimalPart !== undefined && !decimalPart.length) return "";
  return `${normalizedInteger},${String(decimalPart ?? "").padEnd(MAX_READING_DECIMAL_DIGITS, "0")}`;
}

function parseReadingText(rawValue) {
  const normalized = normalizeReadingText(rawValue);
  const pattern = new RegExp(`^\\d{1,${MAX_READING_INTEGER_DIGITS}},\\d{${MAX_READING_DECIMAL_DIGITS}}$`);
  if (!pattern.test(normalized)) return { valid: false, normalized, value: NaN };
  const value = Number(normalized.replace(",", "."));
  return { valid: Number.isFinite(value) && value >= 0 && value <= MAX_READING_KWH, normalized, value };
}

function sanitizeRupiahText(rawValue) {
  return String(rawValue ?? "").replace(/[^0-9]/g, "").slice(0, 9);
}

function parseRupiahText(rawValue) {
  const normalized = sanitizeRupiahText(rawValue).replace(/^0+(?=\d)/, "");
  const value = Number(normalized || 0);
  return {
    valid: /^\d+$/.test(normalized) && Number.isSafeInteger(value) && value > 0 && value <= MAX_TOKEN_PURCHASE_RP,
    normalized,
    value,
  };
}

function normalizeTokenReference(rawValue) {
  const display = String(rawValue ?? "").normalize("NFKC").trim().replace(/\s+/g, " ");
  const key = display.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const looksLikePlnTokenCode = /^\d{20}$/.test(key);
  return {
    display,
    key,
    valid: display.length > 0
      && display.length <= 200
      && key.length >= 4
      && key.length <= 80
      && !looksLikePlnTokenCode,
  };
}

function emptyTokenState(meter, store) {
  return {
    exists: false,
    meterId: meter?.id || "",
    storeId: store?.id || meter?.storeId || "",
    revision: 0,
    pendingFromRevision: null,
    pendingPurchaseCount: 0,
    pendingTokenKwhCenti: 0,
    pendingAmountRp: 0,
    lastPurchaseId: "",
    lastConsumedRevision: 0,
    lastAcceptedReadingId: "",
    lastAcceptedReadingDate: "",
    lastAcceptedReadingKwhCenti: null,
    lastAcceptedCapturedAt: null,
  };
}

function normalizedTokenState(rawState, meter, store) {
  if (!rawState) throw new Error("State token meter belum disiapkan. Jalankan deploy v1.1.3 lengkap sebelum input.");
  const stateValue = {
    exists: true,
    ...rawState,
    revision: Number(rawState.revision),
    pendingFromRevision: rawState.pendingFromRevision == null ? null : Number(rawState.pendingFromRevision),
    pendingPurchaseCount: Number(rawState.pendingPurchaseCount),
    pendingTokenKwhCenti: Number(rawState.pendingTokenKwhCenti),
    pendingAmountRp: Number(rawState.pendingAmountRp),
    lastConsumedRevision: Number(rawState.lastConsumedRevision),
    lastAcceptedReadingKwhCenti: rawState.lastAcceptedReadingKwhCenti == null ? null : Number(rawState.lastAcceptedReadingKwhCenti),
  };
  const utcTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/;
  const valid = stateValue.meterId === meter?.id
    && stateValue.storeId === store?.id
    && stateValue.storeCode === store?.code
    && stateValue.storeName === store?.name
    && stateValue.meterSerial === meter?.serialNumber
    && stateValue.electricityModel === "prepaid"
    && stateValue.masterVersion === masterVersion
    && [stateValue.revision, stateValue.pendingPurchaseCount, stateValue.pendingTokenKwhCenti, stateValue.pendingAmountRp, stateValue.lastConsumedRevision].every(Number.isFinite)
    && stateValue.revision >= 0
    && Number.isSafeInteger(stateValue.revision)
    && (stateValue.pendingFromRevision == null || (Number.isSafeInteger(stateValue.pendingFromRevision) && stateValue.pendingFromRevision > 0 && stateValue.pendingFromRevision <= stateValue.revision))
    && stateValue.pendingPurchaseCount >= 0
    && Number.isSafeInteger(stateValue.pendingPurchaseCount)
    && stateValue.pendingPurchaseCount <= stateValue.revision
    && Number.isSafeInteger(stateValue.pendingTokenKwhCenti)
    && stateValue.pendingTokenKwhCenti >= 0
    && Number.isSafeInteger(stateValue.pendingAmountRp)
    && stateValue.pendingAmountRp >= 0
    && Number.isSafeInteger(stateValue.lastConsumedRevision)
    && stateValue.lastConsumedRevision >= 0
    && stateValue.lastConsumedRevision <= stateValue.revision
    && ((stateValue.revision === 0 && stateValue.lastPurchaseId === "")
      || (stateValue.revision > 0 && typeof stateValue.lastPurchaseId === "string" && stateValue.lastPurchaseId.length > 0))
    && ((stateValue.pendingPurchaseCount === 0
        && stateValue.pendingFromRevision == null
        && stateValue.pendingTokenKwhCenti === 0
        && stateValue.pendingAmountRp === 0
        && stateValue.lastConsumedRevision === stateValue.revision)
      || (stateValue.pendingPurchaseCount > 0
        && stateValue.pendingFromRevision === stateValue.revision - stateValue.pendingPurchaseCount + 1
        && stateValue.pendingFromRevision === stateValue.lastConsumedRevision + 1
        && stateValue.pendingTokenKwhCenti > 0
        && stateValue.pendingAmountRp > 0))
    && ((stateValue.lastAcceptedReadingId === ""
        && stateValue.lastAcceptedReadingDate === ""
        && stateValue.lastAcceptedReadingKwhCenti == null
        && stateValue.lastAcceptedCapturedAt == null)
      || (typeof stateValue.lastAcceptedReadingId === "string"
        && stateValue.lastAcceptedReadingId.length > 0
        && typeof stateValue.lastAcceptedReadingDate === "string"
        && /^\d{4}-\d{2}-\d{2}$/.test(stateValue.lastAcceptedReadingDate)
        && Number.isSafeInteger(stateValue.lastAcceptedReadingKwhCenti)
        && stateValue.lastAcceptedReadingKwhCenti >= 0
        && stateValue.lastAcceptedReadingKwhCenti <= 99999999999999
        && typeof stateValue.lastAcceptedCapturedAt === "string"
        && utcTimestampPattern.test(stateValue.lastAcceptedCapturedAt)));
  if (!valid) throw new Error("Saldo transaksi token pada server tidak valid. Hubungi pengelola sebelum input meter.");
  return stateValue;
}

function tokenStateSummary(tokenState = captureTokenState) {
  const stateValue = tokenState || emptyTokenState();
  const count = Number(stateValue.pendingPurchaseCount || 0);
  const revisionEnd = count > 0 ? Number(stateValue.revision) : null;
  return {
    count,
    totalKwh: roundTo(Number(stateValue.pendingTokenKwhCenti || 0) / 100),
    totalKwhCenti: Number(stateValue.pendingTokenKwhCenti || 0),
    totalAmountRp: Number(stateValue.pendingAmountRp || 0),
    revisionStart: count > 0 ? Number(stateValue.pendingFromRevision) : null,
    revisionEnd,
  };
}

function prepaidPreviousFromTokenState(tokenState = captureTokenState) {
  if (!tokenState?.lastAcceptedReadingId || tokenState.lastAcceptedReadingKwhCenti == null) return null;
  return {
    id: tokenState.lastAcceptedReadingId,
    meterId: tokenState.meterId,
    storeId: tokenState.storeId,
    readingDate: tokenState.lastAcceptedReadingDate,
    readingKwh: Number(tokenState.lastAcceptedReadingKwhCenti) / 100,
    capturedAt: tokenState.lastAcceptedCapturedAt,
    status: "valid",
    electricityModel: "prepaid",
    readingBasis: "remaining_balance",
  };
}

function nextTokenStateAfterPurchase(tokenState, purchase, purchaseId) {
  const nextRevision = Number(tokenState.revision) + 1;
  const wasEmpty = Number(tokenState.pendingPurchaseCount) === 0;
  return {
    meterId: tokenState.meterId,
    storeId: tokenState.storeId,
    storeCode: tokenState.storeCode,
    storeName: tokenState.storeName,
    meterSerial: tokenState.meterSerial,
    electricityModel: "prepaid",
    revision: nextRevision,
    pendingFromRevision: wasEmpty ? nextRevision : tokenState.pendingFromRevision,
    pendingPurchaseCount: Number(tokenState.pendingPurchaseCount) + 1,
    pendingTokenKwhCenti: Number(tokenState.pendingTokenKwhCenti) + Number(purchase.tokenKwhCenti),
    pendingAmountRp: Number(tokenState.pendingAmountRp) + Number(purchase.purchaseAmountRp),
    lastPurchaseId: purchaseId,
    lastConsumedRevision: Number(tokenState.lastConsumedRevision),
    lastAcceptedReadingId: tokenState.lastAcceptedReadingId,
    lastAcceptedReadingDate: tokenState.lastAcceptedReadingDate,
    lastAcceptedReadingKwhCenti: tokenState.lastAcceptedReadingKwhCenti,
    lastAcceptedCapturedAt: tokenState.lastAcceptedCapturedAt,
    lastEventType: "purchase",
    lastEventId: purchaseId,
    updatedAt: serverTimestamp(),
    masterVersion,
  };
}

function nextTokenStateAfterAcceptedReading(tokenState, readingId, readingDate, readingKwh, capturedAt) {
  return {
    meterId: tokenState.meterId,
    storeId: tokenState.storeId,
    storeCode: tokenState.storeCode,
    storeName: tokenState.storeName,
    meterSerial: tokenState.meterSerial,
    electricityModel: "prepaid",
    revision: Number(tokenState.revision),
    pendingFromRevision: null,
    pendingPurchaseCount: 0,
    pendingTokenKwhCenti: 0,
    pendingAmountRp: 0,
    lastPurchaseId: tokenState.lastPurchaseId,
    lastConsumedRevision: Number(tokenState.revision),
    lastAcceptedReadingId: readingId,
    lastAcceptedReadingDate: readingDate,
    lastAcceptedReadingKwhCenti: Math.round(Number(readingKwh) * 100),
    lastAcceptedCapturedAt: capturedAt,
    lastEventType: "reading",
    lastEventId: readingId,
    updatedAt: serverTimestamp(),
    masterVersion,
  };
}

function tokenPurchaseSummary(rows) {
  const purchases = Array.isArray(rows) ? rows : [];
  return {
    ids: purchases.map((row) => row.id),
    count: purchases.length,
    totalKwh: roundTo(purchases.reduce((sum, row) => sum + Number(row.tokenKwh || 0), 0)),
    totalAmountRp: purchases.reduce((sum, row) => sum + Number(row.purchaseAmountRp || 0), 0),
  };
}

function readingsLinkedToPurchase(purchaseId) {
  return state.readings
    .filter((reading) => Array.isArray(reading.tokenPurchaseIds) && reading.tokenPurchaseIds.includes(purchaseId))
    .sort(readingSort);
}

function readingsLinkedToPurchaseRevision(meterId, revision) {
  return state.readings
    .filter((reading) => reading.meterId === meterId
      && Number.isInteger(Number(reading.tokenRevisionStart))
      && Number.isInteger(Number(reading.tokenRevisionEnd))
      && Number(revision) >= Number(reading.tokenRevisionStart)
      && Number(revision) <= Number(reading.tokenRevisionEnd))
    .sort(readingSort);
}

const roundTo = (value, decimals = 2) => {
  const factor = 10 ** decimals;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
};

function calculateUsageKwh(model, previousReadingKwh, currentReadingKwh, tokenAddedKwh = 0, multiplier = 1) {
  if (previousReadingKwh == null) return null;
  const previous = Number(previousReadingKwh);
  const current = Number(currentReadingKwh);
  const tokenAdded = Number(tokenAddedKwh || 0);
  const meterMultiplier = Number(multiplier || 1);
  if (![previous, current, tokenAdded, meterMultiplier].every(Number.isFinite) || tokenAdded < 0 || meterMultiplier <= 0) return NaN;
  const rawUsage = model === "prepaid"
    ? previous + tokenAdded - current
    : current - previous;
  return roundTo(rawUsage * meterMultiplier);
}

function showToast(message) {
  toast.textContent = `✓ ${message}`;
  toast.hidden = false;
  window.setTimeout(() => { toast.hidden = true; }, 3200);
}

function setFormSaveLock(locked) {
  formSaveInFlight = locked;
  document.querySelectorAll("[data-tab]").forEach((button) => { button.disabled = locked; });
  const refreshButton = document.querySelector("#refreshButton");
  if (refreshButton) refreshButton.disabled = locked;
  ["meterSelect", "tokenMeterSelect", "refreshTokenHistory", "addTokenFromCapture"].forEach((id) => {
    const control = document.querySelector(`#${id}`);
    if (control) control.disabled = locked;
  });
}

function friendlyDataError(error, fallback = "Data belum dapat disinkronkan. Tekan Coba lagi.") {
  const code = String(error?.code || "").toLowerCase();
  const message = String(error?.message || "");
  const detail = `${code} ${message}`.toLowerCase();
  if (!navigator.onLine) return "Perangkat sedang offline. Sambungkan internet lalu coba lagi.";
  if (detail.includes("failed-precondition") || detail.includes("requires an index")) {
    return "Sinkronisasi database sedang disiapkan. Tekan Coba lagi dalam beberapa saat.";
  }
  if (detail.includes("permission-denied") || detail.includes("permission denied")) {
    return "Aplikasi perlu diperbarui atau akses data ditolak. Tutup-buka aplikasi lalu coba lagi.";
  }
  if (detail.includes("unauthenticated")) {
    return "Sesi aplikasi berakhir. Muat ulang aplikasi untuk menyambungkan kembali.";
  }
  if (detail.includes("unavailable") || detail.includes("network") || detail.includes("fetch")) {
    return "Server belum dapat dijangkau. Periksa koneksi lalu coba lagi.";
  }
  if (detail.includes("resource-exhausted") || detail.includes("quota")) {
    return "Layanan sedang sibuk. Coba lagi beberapa saat.";
  }
  const safeLocalPrefixes = [
    "Master resmi",
    "Struktur master resmi",
    "Versi master resmi",
    "Isi master resmi",
  ];
  if (safeLocalPrefixes.some((prefix) => message.startsWith(prefix))) return message;
  return fallback;
}

function setSyncStatus(status, label, detail = "") {
  if (!syncStatus) return;
  syncStatus.className = `sync-status ${status}`;
  const statusLabel = syncStatus.querySelector("[data-sync-label]");
  if (statusLabel) statusLabel.textContent = label;
  const lastSync = status === "live" && lastCloudSyncAt
    ? `Terakhir tersinkron ${lastCloudSyncAt.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`
    : "";
  syncStatus.title = detail || lastSync || label;
  syncStatus.setAttribute("aria-label", `Status sinkronisasi: ${label}${detail ? `. ${detail}` : ""}`);
}

function showError(message, retry = restartLiveData) {
  setSyncStatus("error", "Gagal sinkron");
  content.innerHTML = `<section class="empty-state"><div class="empty-icon">!</div><h2>Data belum dapat dibuka</h2><p>${h(message)}</p><button class="primary-button" id="retryButton">Coba lagi</button></section>`;
  document.querySelector("#retryButton")?.addEventListener("click", retry);
}

async function loadLockedMaster() {
  const response = await fetch(`/master-electric.json?v=${APP_VERSION}`, { cache: "no-store" });
  if (!response.ok) throw new Error("Master resmi gagal dimuat.");
  const master = await response.json();
  if (!master.locked || !Array.isArray(master.stores) || !Array.isArray(master.meters) || master.stores.length !== 11 || master.meters.length !== 11) throw new Error("Struktur master resmi tidak valid.");
  if (typeof master.masterVersion !== "string" || !master.masterVersion.trim()) throw new Error("Versi master resmi tidak valid.");
  const storesValid = master.stores.every((row) => typeof row.id === "string" && row.id && typeof row.code === "string" && row.code && typeof row.name === "string" && row.name && typeof row.area === "string" && row.area && ["prepaid", "postpaid"].includes(row.electricityModel) && Number.isFinite(row.latitude) && Number.isFinite(row.longitude) && typeof row.coordinateText === "string" && row.coordinateText && Number.isFinite(row.tariffPerKwh) && row.tariffPerKwh > 0 && row.active === true);
  const metersValid = master.meters.every((row) => typeof row.id === "string" && row.id && typeof row.storeId === "string" && row.storeId && typeof row.serialNumber === "string" && row.serialNumber && Number.isFinite(row.meterPower) && row.meterPower > 0 && Number.isFinite(row.multiplier) && row.multiplier > 0 && row.active === true);
  if (!storesValid || !metersValid) throw new Error("Isi master resmi tidak lengkap atau bertipe salah.");
  const storeIds = new Set(master.stores.map((row) => row.id));
  const storeCodes = new Set(master.stores.map((row) => row.code));
  const meterIds = new Set(master.meters.map((row) => row.id));
  const serials = new Set(master.meters.map((row) => String(row.serialNumber)));
  if (storeIds.size !== 11 || storeCodes.size !== 11 || meterIds.size !== 11 || serials.size !== 11 || master.meters.some((row) => !storeIds.has(row.storeId))) throw new Error("Master resmi memiliki ID ganda atau relasi meter yang tidak valid.");
  masterSource = String(master.source || masterSource);
  masterVersion = String(master.masterVersion || "");
  state.stores = Object.freeze(master.stores.map((row) => Object.freeze({ ...row, masterLocked: true, masterVersion })));
  state.meters = Object.freeze(master.meters.map((row) => Object.freeze({ ...row, serialNumber: String(row.serialNumber), masterLocked: true, masterVersion })));
}

let appCheckReady = false;

/**
 * App Check menutup celah utama login Anonymous: tanpa App Check, siapa pun yang
 * memiliki API key publik dapat membaca seluruh readings dan tokenPurchases.
 * Aktif hanya jika reCAPTCHA site key diisi saat deploy sehingga aplikasi tetap
 * berjalan normal pada project yang belum mendaftarkan App Check.
 */
async function setupAppCheck(app) {
  const siteKey = String(config.appCheckSiteKey || "").trim();
  if (!siteKey || appCheckReady) return;
  try {
    const { initializeAppCheck, ReCaptchaV3Provider, ReCaptchaEnterpriseProvider } =
      await import("https://www.gstatic.com/firebasejs/11.10.0/firebase-app-check.js");
    const useEnterprise = String(config.appCheckProvider || "").trim().toLowerCase() === "recaptcha-enterprise";
    initializeAppCheck(app, {
      provider: useEnterprise
        ? new ReCaptchaEnterpriseProvider(siteKey)
        : new ReCaptchaV3Provider(siteKey),
      isTokenAutoRefreshEnabled: true,
    });
    appCheckReady = true;
  } catch (error) {
    // Gagal memuat App Check tidak boleh mematikan pencatatan di lapangan.
    console.warn("App Check tidak dapat diaktifkan:", error);
  }
}

async function init() {
  if (!config.projectId || String(config.apiKey).includes("GANTI_")) {
    content.innerHTML = `<section class="empty-state setup-card"><div class="empty-icon">⚙</div><h2>Konfigurasi belum terpasang</h2><p>Deploy aplikasi menggunakan blok Cloud Shell di dalam paket ZIP. Konfigurasi layanan akan dibuat otomatis.</p></section>`;
    return;
  }
  try {
    await loadLockedMaster();
    if (!firebaseApp) {
      firebaseApp = initializeApp(config);
      await setupAppCheck(firebaseApp);
    }
    if (!db) db = getFirestore(firebaseApp);
    const credential = await signInAnonymously(getAuth(firebaseApp));
    userId = credential.user.uid;
    try {
      await loadLatestReadings();
    } catch {
      // Dashboard realtime tetap dibuka; capture akan memeriksa baseline terbaru lagi ke server.
    }
    startLiveData({ showLoader: true });
  } catch (error) {
    showError(friendlyDataError(error, "Inisialisasi aplikasi belum berhasil. Tekan Coba lagi."), init);
  }
}

function mergeReadings(rows) {
  const readingMap = new Map(state.readings.map((row) => [row.id, row]));
  rows.forEach((row) => readingMap.set(row.id, row));
  state.readings = [...readingMap.values()].sort(readingSort);
}

function recentReadingsQuery(meterId) {
  return query(
    collection(db, "readings"),
    orderBy(documentId(), "desc"),
    startAt(`${meterId}_9999-12-31`),
    endAt(`${meterId}_0000-00-00`),
    queryLimit(10),
  );
}

async function loadLatestReadings() {
  const latestRows = await Promise.all(state.meters.map(async (meter) => {
    const store = state.stores.find((item) => item.id === meter.storeId);
    const snapshot = await getDocs(recentReadingsQuery(meter.id));
    const latest = snapshot.docs
      .map((row) => ({ id: row.id, ...row.data() }))
      .find((row) => {
        if (row.status === "rejected" || row.status === "needs_review") return false;
        if (store?.electricityModel === "prepaid") return row.electricityModel === "prepaid" && row.readingBasis === "remaining_balance";
        return !row.electricityModel || (row.electricityModel === "postpaid" && row.readingBasis === "cumulative_consumption");
      });
    return latest || null;
  }));
  mergeReadings(latestRows.filter(Boolean));
}

async function loadRecentReadingsFromServer(meterId) {
  const snapshot = await getDocsFromServer(recentReadingsQuery(meterId));
  const rows = snapshot.docs.map((row) => ({ id: row.id, ...row.data() }));
  mergeReadings(rows);
  return rows;
}

async function loadPreviousPostpaidReadingFromServer(meterId, readingDate = localDate()) {
  let cursor = null;
  for (let page = 0; page < 100; page += 1) {
    const constraints = [
      orderBy(documentId(), "desc"),
    ];
    if (cursor) constraints.push(startAfter(cursor));
    else constraints.push(startAt(`${meterId}_9999-12-31`));
    constraints.push(endAt(`${meterId}_0000-00-00`));
    constraints.push(queryLimit(100));
    const snapshot = await getDocsFromServer(query(collection(db, "readings"), ...constraints));
    const rows = snapshot.docs.map((row) => ({ id: row.id, ...row.data() }));
    mergeReadings(rows);
    const accepted = rows.find((row) => row.status !== "rejected"
      && row.status !== "needs_review"
      && String(row.readingDate) < readingDate
      && (!row.electricityModel
        || (row.electricityModel === "postpaid" && row.readingBasis === "cumulative_consumption")));
    if (accepted) return accepted;
    if (snapshot.size < 100) return null;
    cursor = snapshot.docs[snapshot.docs.length - 1];
  }
  throw new Error("Riwayat pascabayar terlalu panjang untuk menentukan baseline secara aman. Hubungi pengelola.");
}

async function loadTokenPurchasesForMeter(meterId) {
  const snapshot = await getDocsFromServer(query(
    collection(db, "tokenPurchases"),
    where("meterId", "==", meterId),
    orderBy("revision", "desc"),
    queryLimit(MAX_TOKEN_PURCHASE_HISTORY),
  ));
  return snapshot.docs
    .map((row) => ({ id: row.id, ...row.data() }))
    .filter((row) => row.status === "recorded")
    .sort(purchaseSort);
}

function updateCaptureServerBaseline() {
  if (state.tab !== "capture") return;
  const meter = state.meters.find((item) => item.id === state.selectedMeterId);
  const store = state.stores.find((item) => item.id === meter?.storeId);
  if (store?.electricityModel !== "prepaid") return;
  const value = document.querySelector("#capturePreviousValue");
  const time = document.querySelector("#capturePreviousTime");
  if (!value || !time) return;
  if (captureTokenLoading) {
    value.textContent = "Memuat saldo server…";
    time.textContent = "Memeriksa baseline resmi";
    return;
  }
  if (captureTokenError || captureTokenState?.meterId !== meter.id) {
    value.textContent = "Belum dapat dimuat";
    time.textContent = "Coba lagi pada panel token";
    return;
  }
  const previous = prepaidPreviousFromTokenState(captureTokenState);
  value.textContent = previous ? `${meterReadingFormat.format(previous.readingKwh)} kWh` : "Baseline baru diperlukan";
  time.textContent = previous ? new Date(previous.capturedAt).toLocaleString("id-ID", { timeZone: BUSINESS_TIME_ZONE }) : "–";
}

function updateTokenServerBaseline() {
  if (state.tab !== "token") return;
  const meter = state.meters.find((item) => item.id === state.selectedTokenMeterId);
  const baseline = document.querySelector("#tokenBaselineValue");
  if (!meter || !baseline) return;
  if (tokenHistoryLoading) {
    baseline.textContent = "Memuat saldo server…";
    return;
  }
  if (tokenHistoryError || tokenHistoryState?.meterId !== meter.id) {
    baseline.textContent = "Belum dapat dimuat";
    return;
  }
  const previous = prepaidPreviousFromTokenState(tokenHistoryState);
  baseline.textContent = previous ? formatDateTime(previous.capturedAt) : "Belum ada";
}

async function loadTokenStateForMeter(meter, store) {
  const snapshot = await getDocFromServer(doc(db, "tokenStates", meter.id));
  return normalizedTokenState(snapshot.exists() ? snapshot.data() : null, meter, store);
}

function tokenPurchasesForState(rows, tokenState) {
  const summary = tokenStateSummary(tokenState);
  if (!summary.count) return [];
  return rows.filter((row) => Number.isInteger(Number(row.revision))
    && Number(row.revision) >= summary.revisionStart
    && Number(row.revision) <= summary.revisionEnd);
}

async function hydrateCaptureTokenPurchases(meter) {
  const requestMeterId = meter.id;
  const store = state.stores.find((item) => item.id === meter.storeId);
  captureTokenMeterId = requestMeterId;
  captureTokenRows = [];
  captureTokenState = null;
  captureTokenLoading = true;
  captureTokenError = "";
  renderCaptureTokenSummary();
  updateUsagePreview();
  try {
    const [tokenState, allRows] = await Promise.all([
      loadTokenStateForMeter(meter, store),
      loadTokenPurchasesForMeter(requestMeterId),
    ]);
    if (state.tab !== "capture" || state.selectedMeterId !== requestMeterId) return;
    captureTokenState = tokenState;
    captureTokenRows = tokenPurchasesForState(allRows, tokenState);
  } catch (error) {
    if (state.tab !== "capture" || state.selectedMeterId !== requestMeterId) return;
    captureTokenError = friendlyDataError(error, error.message || "Pembelian token belum dapat diperiksa.");
  } finally {
    if (state.tab === "capture" && state.selectedMeterId === requestMeterId) {
      captureTokenLoading = false;
      updateCaptureServerBaseline();
      renderCaptureTokenSummary();
      updateUsagePreview();
    }
  }
}

function startLiveData({ showLoader = false } = {}) {
  if (!db) return;
  unsubscribeReadings?.();
  unsubscribeReadings = null;
  setSyncStatus("connecting", "Menghubungkan");
  if (showLoader && !liveDataReady) {
    content.innerHTML = `<section class="loading-state"><div class="spinner"></div><h2>Menyiapkan kontrol energi</h2><p>Menghubungkan pembacaan seluruh store secara live.</p></section>`;
  }

  const liveQuery = query(
    collection(db, "readings"),
    where("readingDate", ">=", rollingStartDate(13)),
    orderBy("readingDate", "desc"),
    queryLimit(200),
  );

  unsubscribeReadings = onSnapshot(
    liveQuery,
    { includeMetadataChanges: true },
    (readingSnap) => {
      const firstSnapshot = !liveDataReady;
      const hasDocumentChanges = readingSnap.docChanges().length > 0;
      const liveRows = readingSnap.docs.map((row) => ({ id: row.id, ...row.data() }));
      liveReadingIds = new Set(liveRows.map((row) => row.id));
      mergeReadings(liveRows);
      if (!historyBoundary) {
        if (liveRows.length) {
          const oldestTime = Math.min(...liveRows.map((row) => new Date(row.capturedAt).getTime()).filter(Number.isFinite));
          historyBoundary = Number.isFinite(oldestTime) ? new Date(oldestTime + 1).toISOString() : new Date().toISOString();
        } else {
          historyBoundary = new Date().toISOString();
        }
      }
      liveDataReady = true;
      if (!state.selectedMeterId) state.selectedMeterId = state.meters.find((meter) => meter.active !== false)?.id || "";

      if (!navigator.onLine) {
        setSyncStatus("offline", "Offline");
      } else if (readingSnap.metadata.hasPendingWrites) {
        setSyncStatus("connecting", "Menyimpan");
      } else if (readingSnap.metadata.fromCache) {
        setSyncStatus("connecting", "Menghubungkan");
      } else {
        lastCloudSyncAt = new Date();
        setSyncStatus("live", "Live");
        if (refreshNoticePending) {
          refreshNoticePending = false;
          showToast("Data live sudah tersinkron.");
        }
      }

      if (firstSnapshot) {
        // Pengecatan pertama selalu penuh, apa pun tabnya. Tanpa ini, membuka
        // aplikasi langsung ke tab Token atau Master lewat shortcut layar HP
        // (?tab=) hanya menampilkan layar memuat karena halaman tidak pernah
        // dirender.
        render();
      } else if (hasDocumentChanges) {
        // Pada pembaruan live berikutnya form yang sedang diisi crew tidak
        // boleh dibangun ulang, jadi hanya tab non-form yang dirender penuh.
        if (state.tab === "capture") refreshCaptureAvailability();
        else if (["dashboard", "stores", "history"].includes(state.tab)) render();
      }
    },
    (error) => {
      unsubscribeReadings = null;
      const message = friendlyDataError(error, "Sinkronisasi realtime belum berhasil. Tekan Coba lagi.");
      setSyncStatus("error", "Gagal sinkron", message);
      if (!liveDataReady) showError(message, restartLiveData);
    },
  );
}

function restartLiveData({ silent = false } = {}) {
  if (!db) {
    init();
    return;
  }
  refreshNoticePending = liveDataReady && !silent;
  startLiveData({ showLoader: !liveDataReady });
}

function handleConnectionChange() {
  if (!navigator.onLine) {
    setSyncStatus("offline", "Offline");
    return;
  }
  setSyncStatus("connecting", "Menghubungkan");
  restartLiveData({ silent: true });
}

function render() {
  document.querySelectorAll("[data-tab]").forEach((button) => button.classList.toggle("active", button.dataset.tab === state.tab));
  if (state.tab === "dashboard") renderDashboard();
  if (state.tab === "stores") renderStoreDashboard();
  if (state.tab === "capture") renderCapture();
  if (state.tab === "token") renderTokenPurchase();
  if (state.tab === "history") renderHistory();
  if (state.tab === "master") renderMaster();
}

function renderDashboard() {
  const today = localDate();
  const activeStoreIds = new Set(state.stores.filter((store) => store.active !== false).map((store) => store.id));
  const activeMeters = state.meters.filter((meter) => meter.active !== false && activeStoreIds.has(meter.storeId));
  const masterReadings = activeMasterReadings();
  const todayRows = masterReadings.filter((row) => row.readingDate === today && row.status !== "rejected");
  const validTodayRows = todayRows.filter(validEnergyReading);
  const usage = validTodayRows.reduce((sum, row) => sum + Number(row.usageKwh || 0), 0);
  const cost = validTodayRows.reduce((sum, row) => sum + Number(row.estimatedCost || 0), 0);
  const captured = new Set(todayRows.map((row) => row.meterId)).size;
  const compliance = activeMeters.length ? Math.round(captured / activeMeters.length * 100) : 0;
  const exceptions = todayRows.filter((row) => {
    const meter = activeMeters.find((item) => item.id === row.meterId);
    return meter && dashboardReadingStatus(row, meter) === "anomaly";
  });
  if (!state.stores.length || !state.meters.length) {
    content.innerHTML = `<section class="empty-state onboarding"><div class="empty-icon">⚡</div><p class="section-kicker">MASTER TERKUNCI</p><h2>Master store belum tersedia</h2><p>Hubungi pengelola aplikasi untuk menerbitkan pembaruan master resmi.</p><div class="privacy-note">◆ Input hanya menerima format angka meter standar.</div></section>`;
    return;
  }
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(); date.setDate(date.getDate() - (6 - index));
    const key = localDate(date);
    const validRows = masterReadings.filter((row) => row.readingDate === key && validEnergyReading(row));
    return {
      key,
      label: date.toLocaleDateString("id-ID", { weekday: "short" }),
      usage: validRows.reduce((sum, row) => sum + Number(reading24hValue(row) || 0), 0),
      hasData: validRows.length > 0,
    };
  });
  const max = Math.max(1, ...days.map((day) => day.usage));
  const validDays = days.filter((day) => day.hasData);
  const average7Days = validDays.length
    ? validDays.reduce((sum, day) => sum + day.usage, 0) / validDays.length
    : null;
  content.innerHTML = `<div class="page-stack">
    <section class="hero-card"><div><p class="section-kicker">PEMAKAIAN VALID HARI INI</p><div class="hero-number">${nf.format(usage)} <small>kWh</small></div><p>${validTodayRows.length ? `${rupiah.format(cost)} estimasi biaya` : "Belum ada pemakaian valid yang dapat dihitung"}</p></div><div class="hero-progress"><strong>${compliance}%</strong><span>input selesai</span></div><button class="hero-action" id="quickCapture">＋ Input meter</button></section>
    ${exceptions.length ? `<section class="dashboard-alert"><span>!</span><div><strong>${exceptions.length} pembacaan perlu dicek</strong><p>Nilai anomali tidak dimasukkan ke total, rata-rata, atau grafik tetapi tetap tersimpan di riwayat.</p></div></section>` : ""}
    <section class="kpi-grid"><article class="kpi-card"><span>Meter tercatat</span><strong>${captured}/${activeMeters.length}</strong><small>${activeMeters.length - captured} belum input</small></article><article class="kpi-card ${exceptions.length ? "warning" : ""}"><span>Perlu dicek hari ini</span><strong>${exceptions.length}</strong><small>${exceptions.length ? "Dikeluarkan dari perhitungan" : "Tidak ada anomali"}</small></article><article class="kpi-card"><span>Rata-rata 7 hari</span><strong>${average7Days == null ? "–" : nf.format(average7Days)}</strong><small>${validDays.length}/7 hari memiliki data valid</small></article></section>
    <section class="panel"><div class="panel-heading"><div><p class="section-kicker">TREN 7 HARI</p><h2>Konsumsi energi valid</h2></div><span class="panel-unit">kWh/24 jam</span></div><div class="bar-chart">${days.map((day) => `<div class="bar-column"><span class="bar-value">${day.hasData ? nf.format(day.usage) : "–"}</span><div class="bar-track"><div class="bar-fill ${day.hasData ? "" : "missing"}" style="height:${day.hasData ? Math.max(5, day.usage / max * 100) : 0}%"></div></div><span>${day.label}</span></div>`).join("")}</div></section>
    <section class="panel"><div class="panel-heading"><div><p class="section-kicker">KEPATUHAN HARI INI</p><h2>Status per store</h2></div><button class="secondary-button compact-button" id="openStoreDashboard">Buka dashboard store</button></div><div class="store-status-list">${state.stores.filter((store) => store.active !== false).map((store) => { const meters = activeMeters.filter((meter) => meter.storeId === store.id); const rows = todayRows.filter((row) => row.storeId === store.id); const meter = meters[0]; const row = meter ? rows.find((item) => item.meterId === meter.id) : null; const status = dashboardReadingStatus(row, meter); const meta = dashboardStatusMeta[status]; const storeUsage = status === "valid" ? Number(row.usageKwh || 0) : null; return `<button type="button" class="store-summary-row" data-store-detail="${h(store.id)}"><span class="status-dot ${meta.className}"></span><div><strong>${h(store.name)}</strong><small>${h(store.code)} · ${h(store.area)} · ${electricityModelLabel(store.electricityModel)}</small></div><div class="store-result"><strong>${storeUsage == null ? meta.label : `${nf.format(storeUsage)} kWh`}</strong><small>${rows.length}/${meters.length} meter · Lihat detail</small></div></button>`; }).join("")}</div></section>
  </div>`;
  document.querySelector("#quickCapture").addEventListener("click", () => { state.tab = "capture"; render(); });
  document.querySelector("#openStoreDashboard")?.addEventListener("click", () => { state.tab = "stores"; render(); });
  document.querySelectorAll("[data-store-detail]").forEach((button) => button.addEventListener("click", () => {
    state.selectedDashboardStoreId = button.dataset.storeDetail;
    state.tab = "stores";
    render();
  }));
}

function renderStoreDashboard() {
  const activeStores = state.stores.filter((store) => store.active !== false);
  if (!activeStores.length) {
    content.innerHTML = `<section class="empty-state"><div class="empty-icon">⚡</div><h2>Store belum tersedia</h2><p>Master store belum dapat dibaca.</p></section>`;
    return;
  }
  if (!activeStores.some((store) => store.id === state.selectedDashboardStoreId)) {
    state.selectedDashboardStoreId = activeStores[0].id;
  }
  const store = activeStores.find((item) => item.id === state.selectedDashboardStoreId);
  const meter = state.meters.find((item) => item.storeId === store.id && item.active !== false);
  const today = localDate();
  const masterReadings = activeMasterReadings();
  const storeReadings = masterReadings.filter((row) => row.storeId === store.id).sort(readingSort);
  const todayReading = meter ? todayReadingForMeter(meter.id, today) : null;
  const todayStatus = dashboardReadingStatus(todayReading, meter);
  const todayMeta = dashboardStatusMeta[todayStatus];
  const latestReading = latestReadingForStore(store.id);
  const limit = normalLimit(meter);
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (6 - index));
    const key = localDate(date);
    const reading = storeReadings.find((row) => row.readingDate === key && row.status !== "rejected") || null;
    const status = dashboardReadingStatus(reading, meter);
    const value = status === "valid" ? reading24hValue(reading) : null;
    return {
      key,
      label: date.toLocaleDateString("id-ID", { weekday: "short" }),
      reading,
      status,
      value,
    };
  });
  const validDays = days.filter((day) => day.status === "valid" && day.value !== null);
  const average7Days = validDays.length ? validDays.reduce((sum, day) => sum + day.value, 0) / validDays.length : null;
  const capturedDays = days.filter((day) => day.reading && day.status !== "rejected").length;
  const anomalyDays = days.filter((day) => day.status === "anomaly").length;
  const compliance7Days = Math.round(capturedDays / 7 * 100);
  const cost7Days = validDays.reduce((sum, day) => sum + Number(day.reading?.estimatedCost || 0), 0);
  const max = Math.max(1, ...validDays.map((day) => day.value));
  const recentReadings = storeReadings.slice(0, 7);
  const recentChartRows = [...recentReadings].reverse().map((row) => {
    const status = dashboardReadingStatus(row, meter);
    const meta = dashboardStatusMeta[status];
    const usage = Number(row.usageKwh);
    const chartableStatus = status === "valid" || status === "anomaly";
    const hasUsage = chartableStatus && row.previousReadingKwh != null && Number.isFinite(usage) && usage >= 0;
    return {
      row,
      status,
      meta,
      usage: hasUsage ? usage : null,
      countedInKpi: status === "valid",
      dateLabel: formatReadingDateShort(row.readingDate),
    };
  });
  const positiveRecentUsage = recentChartRows.map((item) => item.usage).filter((value) => Number.isFinite(value) && value > 0);
  const maxRecentUsage = Math.max(1, ...positiveRecentUsage);
  const minRecentUsage = positiveRecentUsage.length ? Math.min(...positiveRecentUsage) : 1;
  const useHistoryLogScale = positiveRecentUsage.length > 1 && maxRecentUsage / minRecentUsage > 20;
  const recentCards = recentReadings.map((row) => {
    const status = dashboardReadingStatus(row, meter);
    const meta = dashboardStatusMeta[status];
    const value24h = status === "valid" ? reading24hValue(row) : null;
    const purchaseCount = Number(row.tokenPurchaseCount ?? (Number(row.tokenAddedKwh) > 0 ? 1 : 0));
    const purchaseKwh = Number(row.tokenPurchaseTotalKwh ?? row.tokenAddedKwh ?? 0);
    const purchaseAmount = Number(row.tokenPurchaseTotalAmountRp || 0);
    return `<article class="store-audit-row"><div><span>${h(row.readingDate)}</span><strong>${formatDateTime(row.capturedAt)}</strong><small>${readingBasisLabel(row.readingBasis)}</small></div><div><span>${row.readingBasis === "remaining_balance" ? "Sisa kWh" : "Angka meter"}</span><strong>${meterReadingFormat.format(row.readingKwh)} kWh</strong></div><div><span>Pemakaian</span><strong>${status === "baseline" ? "Baseline" : row.usageKwh == null ? "–" : `${nf.format(row.usageKwh)} kWh`}</strong>${purchaseCount > 0 ? `<small>${purchaseCount} token · ${nf.format(purchaseKwh)} kWh · ${rupiah.format(purchaseAmount)}</small>` : ""}</div><div><span>Setara 24 jam</span><strong>${value24h == null ? "–" : `${nf.format(value24h)} kWh`}</strong></div><div><span>Crew</span><strong>${h(row.recordedBy || "–")}</strong></div><span class="tracking-badge ${meta.className}">${meta.label}</span></article>`;
  }).join("");
  const recentChartBars = recentChartRows.map((item) => {
    const barHeight = item.usage == null ? 0 : historyBarHeight(item.usage, maxRecentUsage, useHistoryLogScale);
    const valueLabel = item.usage == null ? "–" : nf.format(item.usage);
    const kpiNote = item.countedInKpi ? "masuk KPI" : "tidak masuk KPI";
    const accessibleLabel = `${item.dateLabel}, ${item.meta.label}, ${item.usage == null ? "pemakaian belum dapat dihitung" : `${valueLabel} kWh per interval`}, ${kpiNote}`;
    return `<div class="history-bar-column" role="img" aria-label="${h(accessibleLabel)}" title="${h(item.row.recordedBy || "Crew belum tercatat")}"><span class="history-bar-value">${valueLabel}${item.usage == null ? "" : " kWh"}</span><div class="history-bar-track"><div class="history-bar-fill ${item.meta.className} ${item.usage == null ? "no-value" : ""}" style="height:${item.usage == null ? 6 : barHeight}%"></div></div><strong>${h(item.dateLabel)}</strong><span class="history-bar-status ${item.meta.className}">${item.meta.label}</span></div>`;
  }).join("");
  const portfolioRows = activeStores.map((item) => {
    const itemMeter = state.meters.find((row) => row.storeId === item.id && row.active !== false);
    const itemToday = itemMeter ? todayReadingForMeter(itemMeter.id, today) : null;
    const status = dashboardReadingStatus(itemToday, itemMeter);
    const meta = dashboardStatusMeta[status];
    const last = latestReadingForStore(item.id);
    const value24h = status === "valid" ? reading24hValue(itemToday) : null;
    return `<button type="button" class="tracking-row ${item.id === store.id ? "current" : ""}" data-dashboard-store="${h(item.id)}"><div class="tracking-store"><strong>${h(item.name)}</strong><small>${h(item.code)} · ${h(item.area)} · ${electricityModelLabel(item.electricityModel)}</small></div><div data-label="Status"><span class="tracking-badge ${meta.className}">${meta.label}</span></div><div data-label="Input terakhir"><strong>${last ? formatDateTime(last.capturedAt) : "–"}</strong><small>${h(last?.recordedBy || "Belum ada baseline sesuai model")}</small></div><div data-label="Angka meter"><strong>${last ? meterReadingFormat.format(last.readingKwh) : "–"}</strong><small>${item.electricityModel === "prepaid" ? "sisa kWh" : "meter kumulatif"}</small></div><div data-label="kWh/24 jam"><strong>${value24h == null ? "–" : nf.format(value24h)}</strong><small>${status === "anomaly" || status === "legacy" ? "Dikeluarkan" : "setara 24 jam"}</small></div><div data-label="Biaya"><strong>${status === "valid" ? rupiah.format(itemToday.estimatedCost || 0) : "–"}</strong><small>${status === "valid" ? item.electricityModel === "prepaid" ? "nilai energi interval" : "biaya interval" : meta.label}</small></div><span class="tracking-arrow">›</span></button>`;
  }).join("");
  const todayUsage = todayStatus === "valid" ? Number(todayReading.usageKwh || 0) : null;
  const today24h = todayStatus === "valid" ? reading24hValue(todayReading) : null;

  content.innerHTML = `<div class="page-stack store-dashboard-page">
    <section class="page-intro store-dashboard-intro"><div><p class="section-kicker">DASHBOARD PER STORE</p><h2>Tracking penggunaan listrik</h2><p>Pilih store untuk melihat kepatuhan input, konsumsi valid, biaya, dan anomali secara rinci.</p></div><label class="store-dashboard-filter"><span>Store aktif</span><select id="dashboardStoreSelect">${activeStores.map((item) => `<option value="${h(item.id)}" ${item.id === store.id ? "selected" : ""}>${h(item.code)} · ${h(item.name)}</option>`).join("")}</select></label></section>
    <section class="store-identity-card"><div><p class="section-kicker">STORE TERPILIH</p><h3>${h(store.name)}</h3><span>${h(store.code)} · ${h(store.area)} · Meter ${h(meter?.serialNumber || "–")} · <span class="electricity-model-badge ${h(store.electricityModel)}">${electricityModelLabel(store.electricityModel)}</span></span></div><div class="store-today-status"><small>Status hari ini</small><span class="tracking-badge ${todayMeta.className}">${todayMeta.label}</span></div><button class="primary-button" id="inputSelectedStore">＋ Input meter</button></section>
    ${todayStatus === "anomaly" ? `<section class="dashboard-alert"><span>!</span><div><strong>Pembacaan hari ini perlu dicek</strong><p>Nilai melebihi batas kontrol ${limit == null ? "yang tersedia" : `${nf.format(limit)} kWh/24 jam`} atau berstatus verifikasi. Data tetap tersimpan, tetapi tidak masuk KPI dan grafik.</p></div></section>` : ""}
    ${todayStatus === "legacy" ? `<section class="dashboard-alert legacy-alert"><span>i</span><div><strong>Data lama tidak dipakai untuk perhitungan ${electricityModelLabel(store.electricityModel).toLowerCase()}</strong><p>Data tetap ada di audit trail. Input berikutnya menjadi baseline baru agar rumus sesuai model listrik.</p></div></section>` : ""}
    <section class="store-kpi-grid"><article><span>${store.electricityModel === "prepaid" ? "Sisa kWh terakhir" : "Meter kumulatif terakhir"}</span><strong>${latestReading ? meterReadingFormat.format(latestReading.readingKwh) : "–"}</strong><small>${latestReading ? formatDateTime(latestReading.capturedAt) : "Belum ada baseline sesuai model"}</small></article><article><span>Pemakaian interval hari ini</span><strong>${todayUsage == null ? "–" : nf.format(todayUsage)}</strong><small>${todayUsage == null ? todayMeta.label : "kWh valid"}</small></article><article><span>Rata-rata 7 hari</span><strong>${average7Days == null ? "–" : nf.format(average7Days)}</strong><small>${validDays.length}/7 hari valid · kWh/24 jam</small></article><article><span>${store.electricityModel === "prepaid" ? "Estimasi nilai energi 7 hari" : "Estimasi biaya 7 hari"}</span><strong>${validDays.length ? rupiah.format(cost7Days) : "–"}</strong><small>Hanya pembacaan valid</small></article><article><span>Kepatuhan input 7 hari</span><strong>${compliance7Days}%</strong><small>${capturedDays}/7 hari tercatat</small></article><article class="${anomalyDays ? "warning" : ""}"><span>Anomali 7 hari</span><strong>${anomalyDays}</strong><small>${anomalyDays ? "Perlu ditindaklanjuti" : "Tidak ada anomali"}</small></article></section>
    <section class="panel"><div class="panel-heading"><div><p class="section-kicker">TREN STORE 7 HARI</p><h2>${h(store.name)}</h2></div><span class="panel-unit">kWh/24 jam</span></div><div class="bar-chart store-bar-chart">${days.map((day) => `<div class="bar-column"><span class="bar-value">${day.value == null ? "–" : nf.format(day.value)}</span><div class="bar-track"><div class="bar-fill ${day.value == null ? "missing" : ""}" style="height:${day.value == null ? 0 : Math.max(5, day.value / max * 100)}%"></div></div><span>${day.label}</span><small class="day-status ${dashboardStatusMeta[day.status].className}">${dashboardStatusMeta[day.status].label}</small></div>`).join("")}</div><div class="chart-footnote"><span>Batas kontrol: <strong>${limit == null ? "Belum ditetapkan" : `${nf.format(limit)} kWh/24 jam`}</strong></span><span>Hari tanpa input dan anomali tidak dianggap nol.</span></div></section>
    <section class="panel"><div class="panel-heading"><div><p class="section-kicker">DETAIL HARI INI</p><h2>Pembacaan ${electricityModelLabel(store.electricityModel).toLowerCase()}</h2></div><span class="tracking-badge ${todayMeta.className}">${todayMeta.label}</span></div><div class="store-reading-detail"><div><span>${store.electricityModel === "prepaid" ? "Sisa sebelumnya" : "Meter sebelumnya"}</span><strong>${todayReading?.previousReadingKwh == null ? "–" : `${meterReadingFormat.format(todayReading.previousReadingKwh)} kWh`}</strong></div>${store.electricityModel === "prepaid" ? `<div><span>Pembelian token terkait</span><strong>${todayReading ? `${Number(todayReading.tokenPurchaseCount || 0)} transaksi · ${meterReadingFormat.format(todayReading.tokenPurchaseTotalKwh ?? todayReading.tokenAddedKwh ?? 0)} kWh` : "–"}</strong><small>${todayReading && Number(todayReading.tokenPurchaseCount || 0) > 0 ? rupiah.format(todayReading.tokenPurchaseTotalAmountRp || 0) : "Tidak ada pembelian"}</small></div>` : ""}<div><span>${store.electricityModel === "prepaid" ? "Sisa sekarang" : "Meter sekarang"}</span><strong>${todayReading ? `${meterReadingFormat.format(todayReading.readingKwh)} kWh` : "–"}</strong></div><div><span>Pemakaian interval</span><strong>${todayUsage == null ? "–" : `${nf.format(todayUsage)} kWh`}</strong></div><div><span>Setara 24 jam</span><strong>${today24h == null ? "–" : `${nf.format(today24h)} kWh`}</strong></div><div><span>${store.electricityModel === "prepaid" ? "Estimasi nilai energi" : "Estimasi biaya"}</span><strong>${todayStatus === "valid" ? rupiah.format(todayReading.estimatedCost || 0) : "–"}</strong></div><div><span>Crew / waktu</span><strong>${todayReading ? `${h(todayReading.recordedBy)} · ${formatDateTime(todayReading.capturedAt)}` : "Belum input"}</strong></div></div></section>
    <section class="panel reading-history-panel"><div class="panel-heading"><div><p class="section-kicker">RIWAYAT STORE</p><h2>Grafik 7 pembacaan terakhir</h2></div><span class="panel-unit">kWh per interval</span></div>${recentChartRows.length ? `<div class="history-chart-scroll" tabindex="0" aria-label="Grafik pemakaian tujuh pembacaan terakhir; geser ke samping bila menggunakan layar kecil"><div class="history-bar-chart" style="grid-template-columns:repeat(${recentChartRows.length},minmax(72px,1fr))">${recentChartBars}</div></div><div class="history-chart-legend"><span><i class="valid"></i>Valid · masuk KPI</span><span><i class="anomaly"></i>Perlu cek · tidak masuk KPI</span><span><i class="baseline"></i>Baseline</span><span><i class="legacy"></i>Data lama / ditolak</span></div><div class="chart-footnote history-chart-note"><span>Grafik audit menampilkan pemakaian per interval, bukan angka meter kumulatif.</span><span>${useHistoryLogScale ? "Skala log digunakan agar nilai sangat besar tidak menutupi batang lain." : "Warna status menentukan apakah data masuk KPI."}</span></div><details class="store-audit-details"><summary>Lihat detail angka meter, crew, dan status</summary><div class="store-audit-list">${recentCards}</div></details>` : `<div class="empty-list">Belum ada pembacaan untuk store ini.</div>`}</section>
    <section class="panel portfolio-panel"><div class="panel-heading"><div><p class="section-kicker">TRACKING HARI INI</p><h2>Seluruh store</h2></div><span class="panel-unit">${activeStores.length} store aktif</span></div><div class="tracking-table-head"><span>Store</span><span>Status</span><span>Input terakhir</span><span>Angka meter</span><span>kWh/24 jam</span><span>Biaya</span><span></span></div><div class="tracking-table">${portfolioRows}</div></section>
  </div>`;

  document.querySelector("#dashboardStoreSelect")?.addEventListener("change", (event) => {
    state.selectedDashboardStoreId = event.target.value;
    renderStoreDashboard();
  });
  document.querySelector("#inputSelectedStore")?.addEventListener("click", () => {
    if (meter) state.selectedMeterId = meter.id;
    state.tab = "capture";
    render();
  });
  document.querySelectorAll("[data-dashboard-store]").forEach((button) => button.addEventListener("click", () => {
    state.selectedDashboardStoreId = button.dataset.dashboardStore;
    renderStoreDashboard();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }));
}

function renderCapture() {
  const meters = state.meters.filter((meter) => meter.active !== false);
  if (!meters.length) {
    content.innerHTML = `<section class="empty-state"><div class="empty-icon">⚙</div><h2>Meter belum tersedia</h2><p>Hubungi pengelola aplikasi untuk memperbarui master resmi.</p></section>`;
    return;
  }
  if (!state.selectedMeterId || !meters.some((m) => m.id === state.selectedMeterId)) state.selectedMeterId = meters[0].id;
  const meter = meters.find((item) => item.id === state.selectedMeterId);
  const store = state.stores.find((item) => item.id === meter.storeId);
  const previous = captureTokenState?.meterId === meter.id
    ? prepaidPreviousFromTokenState(captureTokenState)
    : previousReadingForMeter(meter.id);
  const todayReading = todayReadingForMeter(meter.id);
  const savedName = localStorage.getItem("energy-user-name") || "";
  const model = store?.electricityModel;
  const isPrepaid = model === "prepaid";
  const readingLabel = isPrepaid ? "Sisa kWh sekarang" : "Angka meter kumulatif sekarang";
  const repeatLabel = isPrepaid ? "Ketik ulang sisa kWh" : "Ketik ulang angka meter";
  const previousLabel = isPrepaid ? "Sisa kWh terakhir" : "Meter terakhir";
  content.innerHTML = `<div class="page-stack capture-page">
    <section class="page-intro"><p class="section-kicker">INPUT METER HARIAN</p><h2>Catat ${isPrepaid ? "saldo prabayar" : "meter pascabayar"}</h2><p>${isPrepaid ? "Masukkan sisa kWh pada layar meter. Pembelian token yang sudah dicatat akan ditarik otomatis sejak pembacaan valid terakhir." : "Masukkan angka pemakaian kumulatif yang tampil pada meter."}</p></section>
    <section class="panel form-panel"><label class="field"><span>Store dan meter</span><select id="meterSelect">${meters.map((item) => { const itemStore = state.stores.find((row) => row.id === item.storeId); return `<option value="${item.id}" ${item.id === meter.id ? "selected" : ""}>${h(itemStore?.code)} · ${h(itemStore?.name)} · ${electricityModelLabel(itemStore?.electricityModel)} · ${h(item.serialNumber)}</option>`; }).join("")}</select></label><div class="meter-context model-context"><div><span>Store</span><strong>${h(store?.name)}</strong></div><div><span>Model listrik</span><strong><span class="electricity-model-badge ${h(model)}">${electricityModelLabel(model)}</span></strong></div><div><span>${previousLabel}</span><strong id="capturePreviousValue">${isPrepaid && captureTokenState?.meterId !== meter.id ? "Memuat saldo server…" : previous ? `${meterReadingFormat.format(previous.readingKwh)} kWh` : "Baseline baru diperlukan"}</strong></div><div><span>Waktu terakhir</span><strong id="capturePreviousTime">${isPrepaid && captureTokenState?.meterId !== meter.id ? "Memeriksa baseline resmi" : previous ? new Date(previous.capturedAt).toLocaleString("id-ID", { timeZone: BUSINESS_TIME_ZONE }) : "–"}</strong></div></div></section>
    <section class="manual-guide ${isPrepaid ? "prepaid-guide" : "postpaid-guide"}"><div class="manual-guide-value">${isPrepaid ? "SISA" : "TOTAL"}</div><div><strong>${isPrepaid ? "Rumus prabayar" : "Rumus pascabayar"}</strong><p>${isPrepaid ? "Pemakaian = sisa sebelumnya + token kWh masuk − sisa sekarang." : "Pemakaian = meter sekarang − meter sebelumnya."} Angka maksimal 2 desimal tanpa pemisah ribuan.</p></div></section>
    <section class="panel form-panel manual-form">
      ${isPrepaid ? `<section class="linked-token-card" id="linkedTokenCard"><div class="linked-token-loading"><span class="mini-spinner"></span><div><strong>Memeriksa pembelian token</strong><small>Mengambil transaksi terbaru dari server.</small></div></div></section>` : ""}
      <label class="field reading-field"><span>${readingLabel} (kWh)</span><div class="reading-input-wrap"><input id="readingInput" type="text" inputmode="decimal" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Contoh: ${isPrepaid ? "125,40" : "2306,60"}" aria-describedby="readingFormatStatus"><b>kWh</b></div><small>Masukkan angka persis dari layar tanpa titik ribuan.</small></label>
      <label class="field reading-field"><span>${repeatLabel}</span><div class="reading-input-wrap"><input id="readingConfirmInput" type="text" inputmode="decimal" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Ketik ulang angka yang sama"><b>kWh</b></div><small id="readingFormatStatus" class="reading-format-status">Kedua angka harus sama sebelum dapat disimpan.</small></label>
      ${isPrepaid ? `<label class="token-declaration"><input id="tokenDeclarationInput" type="checkbox"><span>Saya sudah memastikan seluruh pembelian token sejak pembacaan valid terakhir telah dicatat.</span></label>` : ""}
      <label class="field"><span>Nama crew</span><input id="crewInput" value="${h(savedName)}" maxlength="100" autocomplete="name" placeholder="Nama pencatat"></label>
      <div id="usagePreview"></div>
      <label class="field" id="reasonWrap" hidden><span>Alasan / catatan verifikasi</span><textarea id="reasonInput" maxlength="1000" placeholder="Jelaskan angka nol atau selisih yang perlu diperiksa"></textarea></label>
      <div class="form-message" id="captureMessage" hidden></div><button class="primary-button full save-button" id="saveReading" disabled>Periksa & simpan angka</button>
    </section>
  </div>`;
  document.querySelector("#meterSelect").addEventListener("change", (event) => { state.selectedMeterId = event.target.value; renderCapture(); });
  ["readingInput", "readingConfirmInput"].forEach((id) => {
    const input = document.querySelector(`#${id}`);
    if (!input) return;
    input.addEventListener("input", () => standardizeReadingInput(input));
    input.addEventListener("blur", () => {
      const parsed = parseReadingText(input.value);
      if (parsed.valid) {
        input.value = parsed.normalized;
        input.dataset.rejected = "false";
      }
      updateUsagePreview();
    });
  });
  document.querySelector("#crewInput").addEventListener("input", updateUsagePreview);
  document.querySelector("#tokenDeclarationInput")?.addEventListener("change", updateUsagePreview);
  document.querySelector("#reasonInput").addEventListener("input", updateUsagePreview);
  document.querySelector("#saveReading").addEventListener("click", saveReading);
  if (isPrepaid) {
    hydrateCaptureTokenPurchases(meter);
  } else {
    captureTokenRows = [];
    captureTokenMeterId = "";
    captureTokenState = null;
    captureTokenLoading = false;
    captureTokenError = "";
  }
  if (todayReading) refreshCaptureAvailability();
}

function renderCaptureTokenSummary(previous = prepaidPreviousFromTokenState() || previousReadingForMeter(state.selectedMeterId)) {
  const card = document.querySelector("#linkedTokenCard");
  if (!card) return;
  if (captureTokenLoading) {
    card.innerHTML = `<div class="linked-token-loading"><span class="mini-spinner"></span><div><strong>Memeriksa pembelian token</strong><small>Mengambil transaksi terbaru dari server.</small></div></div>`;
    return;
  }
  if (captureTokenError) {
    card.innerHTML = `<div class="linked-token-head"><div><span class="token-card-kicker">PEMBELIAN TOKEN TERKAIT</span><strong>Data token belum dapat diperiksa</strong><small>${h(captureTokenError)}</small></div><button type="button" class="secondary-button compact-button" id="retryCaptureTokens">Coba lagi</button></div>`;
    document.querySelector("#retryCaptureTokens")?.addEventListener("click", () => {
      const meter = state.meters.find((item) => item.id === state.selectedMeterId);
      if (meter) hydrateCaptureTokenPurchases(meter);
    });
    return;
  }
  const summary = tokenStateSummary();
  const list = captureTokenRows.length
    ? `<div class="linked-token-list">${captureTokenRows.map((row) => `<div><span>${formatDateTime(row.purchasedAt)}</span><strong>${nf.format(row.tokenKwh)} kWh</strong><small>${rupiah.format(row.purchaseAmountRp)}${row.receiptReference ? ` · Ref ${h(row.receiptReference)}` : ""}</small></div>`).join("")}</div>`
    : summary.count
      ? `<div class="linked-token-empty">${summary.count} transaksi pending tersimpan di server. Detail transaksi tidak masuk batas riwayat yang sedang tampil.</div>`
      : `<div class="linked-token-empty">Tidak ada pembelian token pending. Token otomatis: <strong>0,00 kWh</strong>.</div>`;
  card.innerHTML = `<div class="linked-token-head"><div><span class="token-card-kicker">PEMBELIAN TOKEN PENDING</span><strong>${summary.count} transaksi · ${nf.format(summary.totalKwh)} kWh · ${rupiah.format(summary.totalAmountRp)}</strong><small>${previous ? `Saldo server sejak pembacaan valid ${formatDateTime(previous.capturedAt)}.` : "Saldo server akan ditutup sebagai audit baseline dan belum menjadi pemakaian."}</small></div><button type="button" class="secondary-button compact-button" id="addTokenFromCapture">＋ Catat token</button></div>${list}<div class="linked-token-note">Saldo pending disimpan per meter di server. Nominal rupiah tidak masuk rumus pemakaian.</div>`;
  document.querySelector("#addTokenFromCapture")?.addEventListener("click", () => {
    if (formSaveInFlight) return;
    state.selectedTokenMeterId = state.selectedMeterId;
    state.tab = "token";
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
}

function refreshCaptureAvailability() {
  if (state.tab !== "capture") return;
  const savedToday = todayReadingForMeter(state.selectedMeterId);
  const button = document.querySelector("#saveReading");
  const message = document.querySelector("#captureMessage");
  if (!savedToday || !button) return;
  button.disabled = true;
  button.dataset.liveBlocked = "true";
  button.textContent = "Sudah dicatat hari ini";
  if (message) {
    message.hidden = false;
    message.textContent = savedToday.status === "rejected"
      ? "Pembacaan hari ini berstatus ditolak dan tidak dapat ditimpa. Hubungi pengelola."
      : "Meter ini sudah dicatat hari ini. Data dari perangkat lain diperbarui otomatis.";
  }
}

function standardizeReadingInput(input) {
  const raw = input.value;
  const standardized = standardizeDecimalSeparator(raw);
  if (standardized !== raw && readingPartialPattern.test(standardized)) input.value = standardized;
  input.dataset.rejected = readingPartialPattern.test(input.value) ? "false" : "true";
  updateUsagePreview();
}

function updateUsagePreview() {
  const meter = state.meters.find((item) => item.id === state.selectedMeterId);
  if (!meter) return;
  const store = state.stores.find((item) => item.id === meter.storeId);
  const model = store?.electricityModel;
  const isPrepaid = model === "prepaid";
  const previous = isPrepaid && captureTokenState
    ? prepaidPreviousFromTokenState(captureTokenState)
    : previousReadingForMeter(meter.id);
  const readingInput = document.querySelector("#readingInput");
  const confirmationInput = document.querySelector("#readingConfirmInput");
  const tokenDeclaration = document.querySelector("#tokenDeclarationInput");
  const formatStatus = document.querySelector("#readingFormatStatus");
  const button = document.querySelector("#saveReading");
  if (!readingInput || !confirmationInput || !formatStatus || !button) return;
  const crew = document.querySelector("#crewInput")?.value.trim() || "";
  const reason = document.querySelector("#reasonInput")?.value.trim() || "";
  const current = parseReadingText(readingInput.value);
  const confirmation = parseReadingText(confirmationInput.value);
  const tokenSummary = tokenStateSummary();
  const tokenAddedKwh = isPrepaid && previous ? tokenSummary.totalKwh : 0;
  const tokenReady = !isPrepaid || (!captureTokenLoading && !captureTokenError && captureTokenMeterId === meter.id);
  const tokenConfirmed = !isPrepaid || Boolean(tokenDeclaration?.checked);
  const wrap = document.querySelector("#usagePreview");
  if (!wrap) return;

  const rejected = readingInput.dataset.rejected === "true" || confirmationInput.dataset.rejected === "true";
  const matches = current.valid && confirmation.valid && current.value === confirmation.value;
  const availablePrepaidBalance = previous ? Number(previous.readingKwh) + tokenAddedKwh : null;
  const invalidDirection = Boolean(previous && current.valid && tokenReady && (isPrepaid
    ? current.value > availablePrepaidBalance
    : current.value < Number(previous.readingKwh)));
  const previewUsage = previous && matches
    ? calculateUsageKwh(model, previous.readingKwh, current.value, tokenAddedKwh, meter.multiplier)
    : null;
  const limit = normalLimit(meter);
  const previewIntervalHours = previous ? (Date.now() - new Date(previous.capturedAt).getTime()) / 3600000 : null;
  const previewNormalized24h = previewUsage !== null && Number.isFinite(previewUsage) && previewUsage >= 0 && Number.isFinite(previewIntervalHours) && previewIntervalHours > 0
    ? roundTo(previewUsage / previewIntervalHours * 24)
    : null;
  const previewAboveLimit = limit !== null && previewNormalized24h !== null && previewNormalized24h > limit;
  const needsReason = previewUsage === 0 || previewAboveLimit;
  let statusText = "Kedua angka harus sama sebelum dapat disimpan.";
  let statusClass = "";
  if (rejected) {
    statusText = "Format ditolak. Gunakan angka tanpa pemisah ribuan, contoh 2306,60.";
    statusClass = "bad";
  } else if (!readingInput.value) {
    statusText = "Masukkan angka yang terlihat pada meter.";
  } else if (!current.valid) {
    statusText = "Lengkapi angka. Maksimal 12 digit dan 2 angka setelah koma.";
    statusClass = "bad";
  } else if (!confirmationInput.value) {
    statusText = "Ketik ulang angka meter untuk mencegah salah input.";
  } else if (!confirmation.valid || !matches) {
    statusText = "Angka pertama dan angka ulang belum sama.";
    statusClass = "bad";
  } else if (isPrepaid && captureTokenLoading) {
    statusText = "Menunggu pemeriksaan pembelian token dari server.";
  } else if (isPrepaid && captureTokenError) {
    statusText = "Pembelian token belum dapat diperiksa. Coba lagi sebelum menyimpan.";
    statusClass = "bad";
  } else if (isPrepaid && !tokenConfirmed) {
    statusText = "Centang konfirmasi bahwa seluruh pembelian token sudah dicatat.";
    statusClass = "bad";
  } else if (invalidDirection) {
    statusText = isPrepaid
      ? `Sisa sekarang melebihi ${meterReadingFormat.format(availablePrepaidBalance)} kWh yang tersedia. Catat pembelian token yang belum masuk atau cek angka meter.`
      : `Angka tidak boleh lebih kecil dari meter kumulatif terakhir ${meterReadingFormat.format(previous.readingKwh)} kWh.`;
    statusClass = "bad";
  } else if (needsReason && !reason) {
    statusText = "Format angka benar. Isi alasan verifikasi sebelum menyimpan.";
    statusClass = "bad";
  } else {
    statusText = `Format valid: ${current.normalized} kWh. ${isPrepaid ? "Saldo" : "Angka meter"} sudah diketik dua kali dengan sama.`;
    statusClass = "good";
  }
  formatStatus.textContent = statusText;
  formatStatus.className = `reading-format-status ${statusClass}`.trim();
  readingInput.setAttribute("aria-invalid", String(!current.valid || rejected || invalidDirection));
  confirmationInput.setAttribute("aria-invalid", String(!confirmation.valid || rejected || !matches));
  if (button.dataset.liveBlocked !== "true") button.disabled = !(matches && tokenReady && tokenConfirmed && !rejected && !invalidDirection && crew && (!needsReason || reason));

  if (!matches) {
    wrap.innerHTML = "";
    document.querySelector("#reasonWrap").hidden = true;
    return;
  }
  if (!previous) {
    wrap.innerHTML = `<div class="usage-preview baseline-preview"><div><span>${isPrepaid ? "Baseline sisa kWh" : "Baseline meter"}</span><strong>${current.normalized} kWh</strong></div><div><span>Pemakaian interval</span><strong>Belum dihitung</strong></div>${isPrepaid ? `<div><span>Pembelian token pending</span><strong>${tokenSummary.count} transaksi</strong><em>${nf.format(tokenSummary.totalKwh)} kWh · ${rupiah.format(tokenSummary.totalAmountRp)}</em></div>` : ""}<small>${isPrepaid ? "Baseline menyimpan hubungan pembelian token untuk audit, tetapi token dan pemakaian tidak dihitung ulang pada hari berikutnya." : "Ini pembacaan pertama dan menjadi dasar perhitungan berikutnya."}</small></div>`;
    document.querySelector("#reasonWrap").hidden = true;
    return;
  }
  const usage = previewUsage;
  wrap.innerHTML = `<div class="usage-preview ${needsReason ? "anomaly" : ""}"><div><span>${isPrepaid ? "Sisa sebelumnya" : "Meter sebelumnya"}</span><strong>${meterReadingFormat.format(previous.readingKwh)} kWh</strong></div>${isPrepaid ? `<div><span>Token otomatis (${tokenSummary.count} transaksi)</span><strong>${meterReadingFormat.format(tokenAddedKwh)} kWh</strong><em>${rupiah.format(tokenSummary.totalAmountRp)} pembelian</em></div>` : ""}<div><span>${isPrepaid ? "Sisa sekarang" : "Meter sekarang"}</span><strong>${current.normalized} kWh</strong></div><div><span>Pemakaian interval</span><strong>${Number.isFinite(usage) && usage >= 0 ? nf.format(usage) : "–"} kWh</strong></div><div><span>${isPrepaid ? "Estimasi nilai energi" : "Estimasi biaya"}</span><strong>${Number.isFinite(usage) && usage >= 0 ? rupiah.format(usage * Number(store.tariffPerKwh || 0)) : "–"}</strong></div><small>${needsReason ? "Angka nol atau di luar pola normal wajib diberi alasan." : isPrepaid ? "Rumus: sisa sebelumnya + total kWh token terkait − sisa sekarang." : "Rumus: meter sekarang − meter sebelumnya."}</small></div>`;
  document.querySelector("#reasonWrap").hidden = !needsReason;
}

function calculateReadingResult({ model, previous, current, tokenSummary, meter, store, capturedAt, reason }) {
  let usage = null;
  let intervalHours = null;
  let normalized24hKwh = null;
  let estimatedCost = null;
  const tokenAddedKwh = model === "prepaid" && previous ? tokenSummary.totalKwh : 0;
  const anomalyFlags = [];
  const limit = normalLimit(meter);
  if (previous) {
    usage = calculateUsageKwh(model, previous.readingKwh, current, tokenAddedKwh, meter.multiplier);
    if (!Number.isFinite(usage) || usage < 0) {
      return { error: model === "prepaid"
        ? "Sisa kWh sekarang lebih besar daripada saldo server yang tersedia. Catat pembelian token yang belum masuk atau cek angka meter."
        : "Angka meter lebih kecil dari pembacaan terakhir. Cek salah baca atau penggantian meter." };
    }
    intervalHours = (new Date(capturedAt).getTime() - new Date(previous.capturedAt).getTime()) / 3600000;
    if (!Number.isFinite(intervalHours) || intervalHours <= 0) {
      return { error: "Waktu pembacaan sebelumnya tidak valid. Hubungi pengelola sebelum menyimpan.", blocking: true };
    }
    normalized24hKwh = roundTo(usage / intervalHours * 24);
    estimatedCost = roundTo(usage * Number(store.tariffPerKwh || 0));
    if (limit !== null && normalized24hKwh > limit) anomalyFlags.push("usage_above_limit");
    if (intervalHours < 20 || intervalHours > 28) anomalyFlags.push("capture_time_shift");
    if (usage === 0) anomalyFlags.push("zero_usage");
  } else {
    anomalyFlags.push("baseline_only");
  }
  const needsReview = anomalyFlags.some((flag) => ["usage_above_limit", "zero_usage"].includes(flag));
  if (needsReview && !reason) {
    return { error: usage === 0
      ? model === "prepaid"
        ? "Isi alasan karena pemakaian nol setelah saldo dan token diperhitungkan."
        : "Isi alasan karena angka meter sama dengan pembacaan sebelumnya."
      : "Isi alasan karena selisih berada di luar batas normal." };
  }
  return {
    usage,
    intervalHours,
    normalized24hKwh,
    estimatedCost,
    tokenAddedKwh,
    anomalyFlags,
    needsReview,
    status: needsReview ? "needs_review" : "valid",
  };
}

async function saveReading() {
  const meter = state.meters.find((item) => item.id === state.selectedMeterId);
  const store = state.stores.find((item) => item.id === meter.storeId);
  const model = store.electricityModel;
  const isPrepaid = model === "prepaid";
  const displayedTokenRevision = isPrepaid ? Number(captureTokenState?.revision) : 0;
  const displayedAcceptedReadingId = isPrepaid ? String(captureTokenState?.lastAcceptedReadingId || "") : "";
  const now = new Date();
  const readingDate = localDate(now);
  let previous = null;
  const readingInput = document.querySelector("#readingInput");
  const confirmationInput = document.querySelector("#readingConfirmInput");
  const currentEntry = parseReadingText(readingInput.value);
  const confirmationEntry = parseReadingText(confirmationInput.value);
  const tokenDeclaration = document.querySelector("#tokenDeclarationInput");
  const current = currentEntry.value;
  const crew = document.querySelector("#crewInput").value.trim();
  const reason = document.querySelector("#reasonInput")?.value.trim() || "";
  const message = document.querySelector("#captureMessage");
  if (!navigator.onLine) {
    message.hidden = false;
    message.textContent = "Perangkat sedang offline. Sambungkan internet agar angka tersimpan ke server.";
    return;
  }
  if (readingInput.dataset.rejected === "true" || confirmationInput.dataset.rejected === "true") {
    message.hidden = false;
    message.textContent = "Ada format yang ditolak. Periksa kembali dan ketik angka tanpa pemisah ribuan.";
    return;
  }
  if (!currentEntry.valid || !confirmationEntry.valid) {
    message.hidden = false;
    message.textContent = "Format angka belum valid. Gunakan contoh 2306,60 tanpa pemisah ribuan.";
    return;
  }
  if (currentEntry.value !== confirmationEntry.value) {
    message.hidden = false;
    message.textContent = "Angka pertama dan angka ulang harus sama.";
    return;
  }
  if (!crew) {
    message.hidden = false;
    message.textContent = "Nama crew wajib diisi.";
    return;
  }
  if (isPrepaid && !tokenDeclaration?.checked) {
    message.hidden = false;
    message.textContent = "Konfirmasi bahwa seluruh pembelian token sejak pembacaan valid terakhir sudah dicatat.";
    return;
  }
  if (isPrepaid && (!captureTokenState || !Number.isSafeInteger(displayedTokenRevision))) {
    message.hidden = false;
    message.textContent = "Saldo token server belum siap. Tekan Coba lagi pada panel token sebelum menyimpan.";
    return;
  }
  readingInput.value = currentEntry.normalized;
  confirmationInput.value = confirmationEntry.normalized;

  const button = document.querySelector("#saveReading");
  button.disabled = true;
  button.textContent = "Memeriksa data server…";
  setFormSaveLock(true);
  try {
    const recentServerRows = await loadRecentReadingsFromServer(meter.id);
    if (recentServerRows.some((row) => row.readingDate === readingDate)) {
      throw new Error("Pembacaan meter untuk hari ini sudah tersimpan.");
    }
    if (isPrepaid) {
      const serverTokenState = await loadTokenStateForMeter(meter, store);
      const stateChanged = Number(serverTokenState.revision) !== displayedTokenRevision
        || String(serverTokenState.lastAcceptedReadingId || "") !== displayedAcceptedReadingId;
      captureTokenState = serverTokenState;
      captureTokenMeterId = meter.id;
      captureTokenLoading = false;
      captureTokenError = "";
      captureTokenRows = tokenPurchasesForState(captureTokenRows, captureTokenState);
      previous = prepaidPreviousFromTokenState(captureTokenState);
      renderCaptureTokenSummary(previous);
      if (stateChanged) {
        readingInput.value = "";
        confirmationInput.value = "";
        if (tokenDeclaration) tokenDeclaration.checked = false;
        updateUsagePreview();
        throw new Error("TOKEN_STATE_CHANGED:Pembelian token atau baseline berubah saat form dibuka. Baca ulang saldo meter lalu ketik kembali angkanya.");
      }
    } else {
      previous = await loadPreviousPostpaidReadingFromServer(meter.id, readingDate);
    }
    updateUsagePreview();
    const preflightResult = calculateReadingResult({
      model,
      previous,
      current,
      tokenSummary: isPrepaid ? tokenStateSummary(captureTokenState) : tokenStateSummary(emptyTokenState()),
      meter,
      store,
      capturedAt: now.toISOString(),
      reason,
    });
    if (preflightResult.error) throw new Error(`INPUT_VALIDATION:${preflightResult.error}`);
  } catch (error) {
    const duplicate = String(error.message || "").toLowerCase().includes("hari ini sudah tersimpan");
    const validationMessage = String(error.message || "").startsWith("INPUT_VALIDATION:")
      ? String(error.message).slice("INPUT_VALIDATION:".length)
      : "";
    const stateChangedMessage = String(error.message || "").startsWith("TOKEN_STATE_CHANGED:")
      ? String(error.message).slice("TOKEN_STATE_CHANGED:".length)
      : "";
    message.hidden = false;
    message.textContent = duplicate
      ? "Meter ini sudah memiliki pembacaan hari ini. Data sedang diperbarui."
      : validationMessage || stateChangedMessage || friendlyDataError(error, error.message || "Data terbaru dari server belum dapat diperiksa. Cek koneksi lalu coba lagi.");
    if (duplicate) {
      button.disabled = true;
      button.textContent = "Sudah dicatat hari ini";
      restartLiveData({ silent: true });
    } else {
      button.disabled = false;
      button.textContent = "Periksa & simpan angka";
    }
    setFormSaveLock(false);
    return;
  }

  button.disabled = true;
  button.textContent = "Menyimpan ke server…";
  let savedPayload = null;
  let savedResult = null;
  let savedTokenState = null;
  try {
    const ref = doc(db, "readings", `${meter.id}_${readingDate}`);
    const tokenStateRef = isPrepaid ? doc(db, "tokenStates", meter.id) : null;
    await runTransaction(db, async (transaction) => {
      const existing = await transaction.get(ref);
      if (existing.exists()) throw new Error("Pembacaan meter untuk hari ini sudah tersimpan.");
      let authoritativeTokenState = null;
      if (isPrepaid) {
        const tokenStateSnapshot = await transaction.get(tokenStateRef);
        authoritativeTokenState = normalizedTokenState(tokenStateSnapshot.exists() ? tokenStateSnapshot.data() : null, meter, store);
        if (Number(authoritativeTokenState.revision) !== displayedTokenRevision
          || String(authoritativeTokenState.lastAcceptedReadingId || "") !== displayedAcceptedReadingId) {
          throw new Error("TOKEN_STATE_CHANGED:Pembelian token atau baseline berubah saat penyimpanan. Baca ulang saldo meter lalu input kembali.");
        }
        previous = prepaidPreviousFromTokenState(authoritativeTokenState);
      } else {
        // Pascabayar memakai baseline valid yang sudah dimuat langsung dari server
        // sebelum transaksi. Dokumen pembacaan bersifat create-only sehingga nilai
        // tersebut tidak dapat diubah di tengah penyimpanan.
      }
      const linkedTokenSummary = isPrepaid
        ? tokenStateSummary(authoritativeTokenState)
        : tokenStateSummary(emptyTokenState());
      const result = calculateReadingResult({
        model,
        previous,
        current,
        tokenSummary: linkedTokenSummary,
        meter,
        store,
        capturedAt: now.toISOString(),
        reason,
      });
      if (result.error) throw new Error(`INPUT_VALIDATION:${result.error}`);
      const tokenLinkDisposition = isPrepaid
        ? result.status === "valid" ? "consumed" : "provisional"
        : "none";
      const payload = {
        meterId: meter.id,
        storeId: meter.storeId,
        storeCode: store.code,
        storeName: store.name,
        meterSerial: meter.serialNumber,
        meterPower: meter.meterPower,
        tariffPerKwh: store.tariffPerKwh,
        readingDate,
        capturedAt: now.toISOString(),
        serverRecordedAt: serverTimestamp(),
        readingKwh: current,
        previousReadingKwh: previous?.readingKwh ?? null,
        usageKwh: result.usage,
        intervalHours: result.intervalHours,
        normalized24hKwh: result.normalized24hKwh,
        estimatedCost: result.estimatedCost,
        inputMode: "manual",
        status: result.status,
        anomalyFlags: result.anomalyFlags,
        reason,
        recordedBy: crew,
        createdByUid: userId,
        appVersion: APP_VERSION,
        masterVersion,
        electricityModel: model,
        readingBasis: readingBasisForModel(model),
        tokenAddedKwh: result.tokenAddedKwh,
        tokenLinkSchemaVersion: TOKEN_LINK_SCHEMA_VERSION,
        tokenLinkDisposition,
        tokenPurchaseCount: linkedTokenSummary.count,
        tokenPurchaseTotalKwh: linkedTokenSummary.totalKwh,
        tokenPurchaseTotalKwhCenti: linkedTokenSummary.totalKwhCenti,
        tokenPurchaseTotalAmountRp: linkedTokenSummary.totalAmountRp,
        tokenRevisionStart: linkedTokenSummary.revisionStart,
        tokenRevisionEnd: linkedTokenSummary.revisionEnd,
      };
      transaction.set(ref, payload);
      if (isPrepaid && result.status === "valid") {
        savedTokenState = nextTokenStateAfterAcceptedReading(authoritativeTokenState, ref.id, readingDate, current, now.toISOString());
        transaction.set(tokenStateRef, savedTokenState);
      } else {
        savedTokenState = authoritativeTokenState;
      }
      savedPayload = payload;
      savedResult = result;
    });
    localStorage.setItem("energy-user-name", crew);
    mergeReadings([{ id: ref.id, ...savedPayload }]);
    liveReadingIds.add(ref.id);
    if (isPrepaid && savedTokenState) captureTokenState = normalizedTokenState(savedTokenState, meter, store);
    state.tab = "dashboard";
    lastCloudSyncAt = new Date();
    setSyncStatus("live", "Live");
    render();
    showToast(savedResult?.needsReview ? "Tersimpan ke server dan masuk verifikasi; token tetap pending." : `${electricityModelLabel(model)} tersimpan dengan rumus yang sesuai.`);
  } catch (error) {
    const duplicate = Boolean(todayReadingForMeter(meter.id, readingDate)) || String(error.message || "").toLowerCase().includes("hari ini sudah tersimpan");
    const validationMessage = String(error.message || "").startsWith("INPUT_VALIDATION:")
      ? String(error.message).slice("INPUT_VALIDATION:".length)
      : "";
    const stateChangedMessage = String(error.message || "").startsWith("TOKEN_STATE_CHANGED:")
      ? String(error.message).slice("TOKEN_STATE_CHANGED:".length)
      : "";
    message.hidden = false;
    if (duplicate) {
      message.textContent = "Meter ini baru saja dicatat dari perangkat lain. Data sedang diperbarui otomatis.";
      button.disabled = true;
      button.textContent = "Sudah dicatat hari ini";
      restartLiveData({ silent: true });
    } else {
      message.textContent = validationMessage || stateChangedMessage || friendlyDataError(error, error.message || "Pembacaan belum dapat disimpan ke server. Coba lagi.");
      button.disabled = false;
      button.textContent = "Periksa & simpan angka";
      if (stateChangedMessage && isPrepaid) {
        readingInput.value = "";
        confirmationInput.value = "";
        if (tokenDeclaration) tokenDeclaration.checked = false;
        hydrateCaptureTokenPurchases(meter);
      }
    }
  }
  setFormSaveLock(false);
}

function renderTokenPurchase() {
  const prepaidMeters = state.meters.filter((meter) => {
    const store = state.stores.find((item) => item.id === meter.storeId);
    return meter.active !== false && store?.active !== false && store?.electricityModel === "prepaid";
  });
  if (!prepaidMeters.length) {
    content.innerHTML = `<section class="empty-state"><div class="empty-icon">⚡</div><h2>Store prabayar tidak tersedia</h2><p>Fitur pembelian token hanya digunakan oleh store dengan model listrik prabayar.</p></section>`;
    return;
  }
  if (!prepaidMeters.some((meter) => meter.id === state.selectedTokenMeterId)) {
    state.selectedTokenMeterId = prepaidMeters[0].id;
  }
  const meter = prepaidMeters.find((item) => item.id === state.selectedTokenMeterId);
  const store = state.stores.find((item) => item.id === meter.storeId);
  const previous = tokenHistoryState?.meterId === meter.id
    ? prepaidPreviousFromTokenState(tokenHistoryState)
    : previousReadingForMeter(meter.id);
  const todayReading = todayReadingForMeter(meter.id);
  const savedName = localStorage.getItem("energy-user-name") || "";
  content.innerHTML = `<div class="page-stack token-page">
    <section class="page-intro"><p class="section-kicker">PEMBELIAN TOKEN PRABAYAR</p><h2>Catat token saat dimasukkan</h2><p>Simpan nominal pembelian dan kWh dari struk. Transaksi akan dijumlah otomatis pada input meter berikutnya.</p></section>
    <section class="manual-guide prepaid-guide"><div class="manual-guide-value">TOKEN</div><div><strong>Jangan hitung kWh dari nominal rupiah</strong><p>Gunakan kWh yang tercetak pada struk. Nominal pembelian dapat berbeda karena biaya admin, PPJ, atau komponen transaksi lain.</p></div></section>
    <section class="panel token-form-panel">
      <label class="field"><span>Store dan meter prabayar</span><select id="tokenMeterSelect">${prepaidMeters.map((item) => { const itemStore = state.stores.find((row) => row.id === item.storeId); return `<option value="${h(item.id)}" ${item.id === meter.id ? "selected" : ""}>${h(itemStore?.code)} · ${h(itemStore?.name)} · ${h(item.serialNumber)}</option>`; }).join("")}</select></label>
      <div class="meter-context token-meter-context"><div><span>Store</span><strong>${h(store.name)}</strong></div><div><span>Meter</span><strong>${h(meter.serialNumber)}</strong></div><div><span>Baseline valid terakhir</span><strong id="tokenBaselineValue">${tokenHistoryState?.meterId === meter.id ? previous ? formatDateTime(previous.capturedAt) : "Belum ada" : "Memuat saldo server…"}</strong></div><div><span>Hubungan berikutnya</span><strong>${todayReading ? "Input meter berikutnya" : "Input meter hari ini"}</strong></div></div>
      ${todayReading ? `<div class="dashboard-alert token-after-reading-alert"><span>i</span><div><strong>Pembacaan hari ini sudah tersimpan</strong><p>Token yang dicatat sekarang tidak mengubah pembacaan hari ini dan otomatis masuk ke pembacaan berikutnya.</p></div></div>` : ""}
      <label class="field"><span>Nomor referensi struk / transaksi</span><input id="tokenReferenceInput" maxlength="200" autocomplete="off" placeholder="Wajib unik untuk meter ini; bukan kode token 20 digit"><small>Referensi wajib agar retry atau dua HP tidak menggandakan transaksi. Jangan simpan kode token PLN yang dapat digunakan.</small></label>
      <div class="split-fields token-purchase-fields">
        <label class="field reading-field"><span>kWh pada struk</span><div class="reading-input-wrap"><input id="tokenKwhInput" type="text" inputmode="decimal" autocomplete="off" value="" placeholder="Contoh: 66,10"><b>kWh</b></div><small>Salin persis dari struk token.</small></label>
        <label class="field reading-field"><span>Ketik ulang kWh</span><div class="reading-input-wrap"><input id="tokenKwhConfirmInput" type="text" inputmode="decimal" autocomplete="off" value="" placeholder="Ulangi 66,10"><b>kWh</b></div><small>Kedua angka harus sama.</small></label>
      </div>
      <div class="split-fields token-purchase-fields">
        <label class="field"><span>Total dibayar (Rp)</span><input id="tokenAmountInput" type="text" inputmode="numeric" autocomplete="off" placeholder="Contoh: 100000"><small id="tokenAmountPreview">Masukkan angka tanpa Rp dan tanpa titik.</small></label>
        <label class="field"><span>Ketik ulang total dibayar</span><input id="tokenAmountConfirmInput" type="text" inputmode="numeric" autocomplete="off" placeholder="Ulangi 100000"><small>Kedua nominal harus sama.</small></label>
      </div>
      <label class="field"><span>Nama crew</span><input id="tokenCrewInput" value="${h(savedName)}" maxlength="100" autocomplete="name" placeholder="Nama pencatat"></label>
      <label class="token-declaration"><input id="tokenLoadedInput" type="checkbox"><span>Token sudah berhasil dimasukkan ke meter dan saldo kWh sudah bertambah.</span></label>
      <div class="dashboard-alert token-immutable-alert"><span>!</span><div><strong>Periksa sebelum simpan</strong><p>Transaksi menjadi audit permanen dan tidak dapat diedit oleh crew. Koreksi hanya melalui pengelola.</p></div></div>
      <div class="token-purchase-preview" id="tokenPurchasePreview"></div>
      <div class="form-message" id="tokenMessage" hidden></div>
      <button class="primary-button full save-button" id="saveTokenPurchase" disabled>Simpan pembelian token</button>
    </section>
    <section class="panel"><div class="panel-heading"><div><p class="section-kicker">RIWAYAT PEMBELIAN</p><h2>${h(store.name)}</h2></div><div class="panel-actions"><button class="secondary-button compact-button" id="refreshTokenHistory">↻ Refresh</button><button class="secondary-button compact-button" id="exportTokenCsv" disabled>Export CSV</button></div></div><div id="tokenHistoryContent"><div class="linked-token-loading"><span class="mini-spinner"></span><div><strong>Memuat riwayat token</strong><small>Mengambil transaksi dari server.</small></div></div></div></section>
  </div>`;

  document.querySelector("#tokenMeterSelect").addEventListener("change", (event) => {
    state.selectedTokenMeterId = event.target.value;
    renderTokenPurchase();
  });
  ["tokenKwhInput", "tokenKwhConfirmInput"].forEach((id) => {
    const input = document.querySelector(`#${id}`);
    input.addEventListener("input", () => {
      const standardized = standardizeDecimalSeparator(input.value);
      if (standardized !== input.value && readingPartialPattern.test(standardized)) input.value = standardized;
      input.dataset.rejected = readingPartialPattern.test(input.value) ? "false" : "true";
      updateTokenPurchaseForm();
    });
    input.addEventListener("blur", () => {
      const parsed = parseReadingText(input.value);
      if (parsed.valid) {
        input.value = parsed.normalized;
        input.dataset.rejected = "false";
      }
      updateTokenPurchaseForm();
    });
  });
  ["tokenAmountInput", "tokenAmountConfirmInput"].forEach((id) => {
    document.querySelector(`#${id}`).addEventListener("input", (event) => {
      event.target.value = sanitizeRupiahText(event.target.value);
      updateTokenPurchaseForm();
    });
  });
  document.querySelector("#tokenReferenceInput").addEventListener("input", updateTokenPurchaseForm);
  document.querySelector("#tokenCrewInput").addEventListener("input", updateTokenPurchaseForm);
  document.querySelector("#tokenLoadedInput").addEventListener("change", updateTokenPurchaseForm);
  document.querySelector("#saveTokenPurchase").addEventListener("click", saveTokenPurchase);
  document.querySelector("#refreshTokenHistory").addEventListener("click", () => hydrateTokenHistory(meter.id));
  document.querySelector("#exportTokenCsv").addEventListener("click", exportTokenCsv);
  updateTokenPurchaseForm();
  hydrateTokenHistory(meter.id);
}

function updateTokenPurchaseForm() {
  const tokenKwhInput = document.querySelector("#tokenKwhInput");
  const tokenKwhConfirmInput = document.querySelector("#tokenKwhConfirmInput");
  const tokenAmountInput = document.querySelector("#tokenAmountInput");
  const tokenAmountConfirmInput = document.querySelector("#tokenAmountConfirmInput");
  const preview = document.querySelector("#tokenPurchasePreview");
  const button = document.querySelector("#saveTokenPurchase");
  if (!tokenKwhInput || !tokenKwhConfirmInput || !tokenAmountInput || !tokenAmountConfirmInput || !preview || !button) return;
  const tokenKwh = parseReadingText(tokenKwhInput.value);
  const tokenKwhConfirm = parseReadingText(tokenKwhConfirmInput.value);
  const amount = parseRupiahText(tokenAmountInput.value);
  const amountConfirm = parseRupiahText(tokenAmountConfirmInput.value);
  const reference = normalizeTokenReference(document.querySelector("#tokenReferenceInput")?.value || "");
  const crew = document.querySelector("#tokenCrewInput")?.value.trim() || "";
  const loaded = Boolean(document.querySelector("#tokenLoadedInput")?.checked);
  const rejected = tokenKwhInput.dataset.rejected === "true" || tokenKwhConfirmInput.dataset.rejected === "true";
  const kwhMatches = tokenKwh.valid && tokenKwhConfirm.valid && tokenKwh.value === tokenKwhConfirm.value;
  const amountMatches = amount.valid && amountConfirm.valid && amount.value === amountConfirm.value;
  const valid = kwhMatches && amountMatches && reference.valid && crew && loaded && !rejected;
  document.querySelector("#tokenAmountPreview").textContent = amount.valid
    ? `Total pembelian: ${rupiah.format(amount.value)}`
    : "Masukkan angka rupiah lebih dari 0 tanpa titik.";
  tokenKwhInput.setAttribute("aria-invalid", String(rejected || (tokenKwhInput.value.length > 0 && (!tokenKwh.valid || tokenKwh.value <= 0))));
  tokenKwhConfirmInput.setAttribute("aria-invalid", String(tokenKwhConfirmInput.value.length > 0 && (!tokenKwhConfirm.valid || !kwhMatches)));
  tokenAmountConfirmInput.setAttribute("aria-invalid", String(tokenAmountConfirmInput.value.length > 0 && (!amountConfirm.valid || !amountMatches)));
  preview.innerHTML = tokenKwh.valid && tokenKwh.value > 0 && amount.valid
    ? `<div><span>Token masuk</span><strong>${meterReadingFormat.format(tokenKwh.value)} kWh</strong></div><div><span>Total dibayar</span><strong>${rupiah.format(amount.value)}</strong></div><small>${!reference.valid ? "Isi nomor referensi transaksi yang unik." : !kwhMatches || !amountMatches ? "Angka ulang belum sama." : loaded ? "Siap masuk saldo pending server dan ditautkan otomatis." : "Centang bahwa token sudah dimasukkan ke meter."}</small>`
    : `<small>Lengkapi referensi, kWh dan nominal dua kali, nama crew, serta konfirmasi pemasangan token.</small>`;
  button.disabled = !valid;
}

async function hydrateTokenHistory(meterId) {
  const requestEpoch = ++tokenHistoryRequestEpoch;
  const meter = state.meters.find((item) => item.id === meterId);
  const store = state.stores.find((item) => item.id === meter?.storeId);
  tokenHistoryMeterId = meterId;
  tokenHistoryRows = [];
  tokenHistoryState = null;
  tokenHistoryLoading = true;
  tokenHistoryError = "";
  renderTokenHistory();
  try {
    const [rows, meterTokenState] = await Promise.all([
      loadTokenPurchasesForMeter(meterId),
      loadTokenStateForMeter(meter, store),
    ]);
    if (requestEpoch !== tokenHistoryRequestEpoch || state.tab !== "token" || state.selectedTokenMeterId !== meterId) return;
    tokenHistoryRows = rows;
    tokenHistoryState = meterTokenState;
  } catch (error) {
    if (requestEpoch !== tokenHistoryRequestEpoch || state.tab !== "token" || state.selectedTokenMeterId !== meterId) return;
    tokenHistoryError = friendlyDataError(error, error.message || "Riwayat pembelian token belum dapat dimuat.");
  } finally {
    if (requestEpoch === tokenHistoryRequestEpoch && state.tab === "token" && state.selectedTokenMeterId === meterId) {
      tokenHistoryLoading = false;
      updateTokenServerBaseline();
      renderTokenHistory();
    }
  }
}

function renderTokenHistory() {
  const container = document.querySelector("#tokenHistoryContent");
  const exportButton = document.querySelector("#exportTokenCsv");
  if (!container) return;
  if (exportButton) exportButton.disabled = !tokenHistoryRows.length;
  if (tokenHistoryLoading) {
    container.innerHTML = `<div class="linked-token-loading"><span class="mini-spinner"></span><div><strong>Memuat riwayat token</strong><small>Mengambil transaksi dari server.</small></div></div>`;
    return;
  }
  if (tokenHistoryError) {
    container.innerHTML = `<div class="empty-list"><strong>Riwayat belum dapat dimuat</strong><p>${h(tokenHistoryError)}</p><button class="secondary-button compact-button" id="retryTokenHistory">Coba lagi</button></div>`;
    document.querySelector("#retryTokenHistory")?.addEventListener("click", () => hydrateTokenHistory(state.selectedTokenMeterId));
    return;
  }
  if (!tokenHistoryRows.length) {
    container.innerHTML = `<div class="empty-list">Belum ada pembelian token untuk meter ini.</div>`;
    return;
  }
  const summary = tokenPurchaseSummary(tokenHistoryRows);
  const pending = tokenStateSummary(tokenHistoryState);
  container.innerHTML = `<div class="token-history-summary"><div><span>Riwayat tampil</span><strong>${summary.count} transaksi</strong></div><div><span>Saldo pending</span><strong>${pending.count} · ${nf.format(pending.totalKwh)} kWh</strong></div><div><span>Nominal pending</span><strong>${rupiah.format(pending.totalAmountRp)}</strong></div></div><div class="token-history-list">${tokenHistoryRows.map((row) => {
    const linkedReadings = Number.isInteger(Number(row.revision))
      ? readingsLinkedToPurchaseRevision(row.meterId, row.revision)
      : readingsLinkedToPurchase(row.id);
    const validLink = linkedReadings.find((reading) => validEnergyReading(reading));
    const baselineLink = linkedReadings.find((reading) => reading.previousReadingKwh == null);
    const reviewLink = linkedReadings.find((reading) => dashboardReadingStatus(reading, state.meters.find((item) => item.id === reading.meterId)) === "anomaly");
    const linkedReading = validLink || baselineLink || reviewLink || linkedReadings[0];
    const isPending = tokenHistoryState
      && Number.isInteger(Number(row.revision))
      && Number(row.revision) > Number(tokenHistoryState.lastConsumedRevision)
      && Number(row.revision) <= Number(tokenHistoryState.revision);
    const oldOutsideLiveWindow = String(row.purchaseDate || "") < rollingStartDate(13);
    const linkLabel = validLink ? `Dikonsumsi ${formatReadingDateShort(validLink.readingDate)}` : baselineLink ? `Ditutup baseline ${formatReadingDateShort(baselineLink.readingDate)}` : reviewLink ? "Provisional · perlu cek" : isPending ? "Pending input meter" : oldOutsideLiveWindow ? "Cek riwayat lama" : "Menunggu input meter";
    const linkClass = validLink ? "valid" : baselineLink ? "baseline" : reviewLink ? "anomaly" : isPending ? "missing" : oldOutsideLiveWindow ? "legacy" : "missing";
    return `<article><div><span>${formatDateTime(row.purchasedAt)}</span><strong>${nf.format(row.tokenKwh)} kWh</strong><small>${rupiah.format(row.purchaseAmountRp)}${row.receiptReference ? ` · Ref ${h(row.receiptReference)}` : ""}</small></div><div><span>Crew</span><strong>${h(row.recordedBy)}</strong><small>${h(row.storeCode)} · ${h(row.meterSerial)}</small></div><span class="tracking-badge ${linkClass}" title="${linkedReading ? `Reading ${h(linkedReading.id)}` : "Belum tertaut"}">${linkLabel}</span></article>`;
  }).join("")}</div>`;
}

async function saveTokenPurchase() {
  const meter = state.meters.find((item) => item.id === state.selectedTokenMeterId);
  const store = state.stores.find((item) => item.id === meter?.storeId);
  const tokenKwhInput = document.querySelector("#tokenKwhInput");
  const tokenKwhConfirmInput = document.querySelector("#tokenKwhConfirmInput");
  const tokenAmountInput = document.querySelector("#tokenAmountInput");
  const tokenAmountConfirmInput = document.querySelector("#tokenAmountConfirmInput");
  const tokenReferenceInput = document.querySelector("#tokenReferenceInput");
  const tokenLoadedInput = document.querySelector("#tokenLoadedInput");
  const tokenKwhEntry = parseReadingText(tokenKwhInput?.value ?? "");
  const tokenKwhConfirmEntry = parseReadingText(tokenKwhConfirmInput?.value ?? "");
  const amountEntry = parseRupiahText(tokenAmountInput?.value ?? "");
  const amountConfirmEntry = parseRupiahText(tokenAmountConfirmInput?.value ?? "");
  const reference = normalizeTokenReference(tokenReferenceInput?.value || "");
  const crew = document.querySelector("#tokenCrewInput")?.value.trim() || "";
  const loaded = Boolean(tokenLoadedInput?.checked);
  const message = document.querySelector("#tokenMessage");
  const button = document.querySelector("#saveTokenPurchase");
  if (!meter || !store || store.electricityModel !== "prepaid") {
    message.hidden = false;
    message.textContent = "Store atau meter prabayar tidak valid.";
    return;
  }
  if (!navigator.onLine) {
    message.hidden = false;
    message.textContent = "Perangkat sedang offline. Sambungkan internet agar pembelian tersimpan ke server.";
    return;
  }
  if (!tokenKwhEntry.valid || tokenKwhEntry.value <= 0
    || !tokenKwhConfirmEntry.valid || tokenKwhConfirmEntry.value !== tokenKwhEntry.value
    || !amountEntry.valid || !amountConfirmEntry.valid || amountConfirmEntry.value !== amountEntry.value
    || !reference.valid || !crew || !loaded) {
    message.hidden = false;
    message.textContent = "Lengkapi referensi, kWh dan nominal dua kali dengan sama, nama crew, serta konfirmasi token sudah dimasukkan.";
    return;
  }
  const tokenKwhCenti = Math.round(tokenKwhEntry.value * 100);
  if (!Number.isSafeInteger(tokenKwhCenti) || tokenKwhCenti <= 0) {
    message.hidden = false;
    message.textContent = "Nilai kWh token tidak dapat disimpan dengan presisi dua desimal.";
    return;
  }
  button.disabled = true;
  button.textContent = "Memeriksa transaksi…";
  tokenHistoryRequestEpoch += 1;
  tokenHistoryLoading = false;
  tokenHistoryError = "";
  setFormSaveLock(true);
  try {
    const now = new Date();
    const ref = doc(db, "tokenPurchases", `${meter.id}_${reference.key}`);
    const tokenStateRef = doc(db, "tokenStates", meter.id);
    let savedPurchase = null;
    let savedState = null;
    let idempotentRetry = false;
    await runTransaction(db, async (transaction) => {
      const purchaseSnapshot = await transaction.get(ref);
      const tokenStateSnapshot = await transaction.get(tokenStateRef);
      const authoritativeState = normalizedTokenState(tokenStateSnapshot.exists() ? tokenStateSnapshot.data() : null, meter, store);
      if (purchaseSnapshot.exists()) {
        const existing = purchaseSnapshot.data();
        const sameTransaction = existing.meterId === meter.id
          && existing.referenceKey === reference.key
          && Number.isSafeInteger(Number(existing.revision))
          && Number(existing.revision) > 0
          && Number(existing.revision) <= Number(authoritativeState.revision)
          && Number(existing.tokenKwhCenti) === tokenKwhCenti
          && Number(existing.purchaseAmountRp) === amountEntry.value;
        if (!sameTransaction) throw new Error("REFERENSI_CONFLICT:Referensi sudah dipakai dengan kWh atau nominal berbeda. Hubungi pengelola.");
        savedPurchase = { id: ref.id, ...existing };
        savedState = authoritativeState;
        idempotentRetry = true;
        return;
      }
      const revision = Number(authoritativeState.revision) + 1;
      if (!Number.isSafeInteger(revision)
        || !Number.isSafeInteger(Number(authoritativeState.pendingTokenKwhCenti) + tokenKwhCenti)
        || !Number.isSafeInteger(Number(authoritativeState.pendingAmountRp) + amountEntry.value)) {
        throw new Error("STATE_OVERFLOW:Akumulasi token meter telah mencapai batas aman. Hubungi pengelola.");
      }
      const payload = {
        meterId: meter.id,
        storeId: store.id,
        storeCode: store.code,
        storeName: store.name,
        meterSerial: meter.serialNumber,
        purchaseDate: localDate(now),
        purchasedAt: now.toISOString(),
        serverRecordedAt: serverTimestamp(),
        revision,
        tokenKwh: tokenKwhEntry.value,
        tokenKwhCenti,
        purchaseAmountRp: amountEntry.value,
        receiptReference: reference.display,
        referenceKey: reference.key,
        status: "recorded",
        recordedBy: crew,
        createdByUid: userId,
        appVersion: APP_VERSION,
        masterVersion,
      };
      const nextState = nextTokenStateAfterPurchase(authoritativeState, payload, ref.id);
      transaction.set(ref, payload);
      transaction.set(tokenStateRef, nextState);
      savedPurchase = { id: ref.id, ...payload };
      savedState = nextState;
    });
    localStorage.setItem("energy-user-name", crew);
    tokenHistoryState = normalizedTokenState(savedState, meter, store);
    if (!tokenHistoryRows.some((row) => row.id === savedPurchase.id)) {
      tokenHistoryRows = [savedPurchase, ...tokenHistoryRows].slice(0, MAX_TOKEN_PURCHASE_HISTORY).sort(purchaseSort);
    }
    tokenKwhInput.value = "";
    tokenKwhConfirmInput.value = "";
    tokenAmountInput.value = "";
    tokenAmountConfirmInput.value = "";
    tokenReferenceInput.value = "";
    tokenLoadedInput.checked = false;
    message.hidden = true;
    button.textContent = "Simpan pembelian token";
    updateTokenPurchaseForm();
    updateTokenServerBaseline();
    renderTokenHistory();
    showToast(idempotentRetry
      ? "Transaksi ini sudah tersimpan sebelumnya; saldo token tidak digandakan."
      : "Pembelian token masuk saldo pending dan akan terhubung otomatis.");
  } catch (error) {
    message.hidden = false;
    const rawMessage = String(error.message || "");
    message.textContent = rawMessage.startsWith("REFERENSI_CONFLICT:")
      ? rawMessage.slice("REFERENSI_CONFLICT:".length)
      : rawMessage.startsWith("STATE_OVERFLOW:")
        ? rawMessage.slice("STATE_OVERFLOW:".length)
        : friendlyDataError(error, error.message || "Pembelian token belum dapat disimpan. Coba lagi.");
    button.disabled = false;
    button.textContent = "Simpan pembelian token";
    hydrateTokenHistory(meter.id);
  } finally {
    setFormSaveLock(false);
  }
}

function exportTokenCsv() {
  if (!tokenHistoryRows.length) return;
  const header = ["Tanggal Pembelian", "Waktu", "Store", "Meter", "Token kWh", "Total Dibayar Rp", "Referensi", "Crew", "Status Link", "ID Transaksi"];
  const rows = tokenHistoryRows.map((row) => {
    const linkedRows = Number.isInteger(Number(row.revision))
      ? readingsLinkedToPurchaseRevision(row.meterId, row.revision)
      : readingsLinkedToPurchase(row.id);
    const linked = linkedRows.find((reading) => validEnergyReading(reading)) || linkedRows[0];
    return [row.purchaseDate, row.purchasedAt, `${row.storeCode} · ${row.storeName}`, row.meterSerial, row.tokenKwh, row.purchaseAmountRp, row.receiptReference, row.recordedBy, linked ? `Reading ${linked.readingDate}` : "Menunggu input meter", row.id]
      .map(csvCell).join(",");
  });
  const blob = new Blob(["\uFEFF", [header.join(","), ...rows].join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `pembelian-token-${localDate()}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function renderHistory() {
  const historyRows = visibleHistoryReadings();
  const cards = historyRows.length
    ? historyRows.map((row) => {
      const store = state.stores.find((item) => item.id === row.storeId);
      const meter = state.meters.find((item) => item.id === row.meterId);
      const storeName = row.storeName || store?.name || row.storeId || "Store tidak dikenal";
      const storeCode = row.storeCode || store?.code || "";
      const meterSerial = row.meterSerial || meter?.serialNumber || row.meterId || "Meter tidak dikenal";
      const computedStatus = dashboardReadingStatus(row, meter);
      const statusMeta = dashboardStatusMeta[computedStatus];
      const rowModel = row.electricityModel || store?.electricityModel;
      const purchaseCount = Number(row.tokenPurchaseCount ?? (Number(row.tokenAddedKwh) > 0 ? 1 : 0));
      const purchaseKwh = Number(row.tokenPurchaseTotalKwh ?? row.tokenAddedKwh ?? 0);
      const purchaseAmount = Number(row.tokenPurchaseTotalAmountRp || 0);
      return `<article class="reading-card"><div class="reading-card-head"><div><span>${new Date(row.capturedAt).toLocaleString("id-ID", { timeZone: BUSINESS_TIME_ZONE })}</span><h3>${h(storeName)}</h3><small>${storeCode ? `${h(storeCode)} · ` : ""}${h(meter?.name || "Meter")} · ${h(meterSerial)}</small></div><span class="tracking-badge ${statusMeta.className}">${statusMeta.label}</span></div><div class="reading-numbers"><div><span>${row.readingBasis === "remaining_balance" ? "Sisa kWh" : "Angka meter"}</span><strong>${meterReadingFormat.format(row.readingKwh)}</strong></div><div><span>Pemakaian</span><strong>${row.usageKwh == null ? "Baseline" : `${nf.format(row.usageKwh)} kWh`}</strong></div><div><span>${rowModel === "prepaid" ? "Nilai energi" : "Biaya"}</span><strong>${row.estimatedCost == null ? "–" : rupiah.format(row.estimatedCost)}</strong></div></div><div class="reading-meta"><span>Model: <strong>${electricityModelLabel(rowModel)}</strong></span><span>Basis: <strong>${readingBasisLabel(row.readingBasis)}</strong></span>${purchaseCount > 0 ? `<span>Pembelian token: <strong>${purchaseCount} transaksi · ${nf.format(purchaseKwh)} kWh · ${rupiah.format(purchaseAmount)}${row.tokenLinkDisposition === "provisional" ? " · provisional" : row.tokenLinkDisposition === "consumed" ? " · dikonsumsi" : ""}</strong></span>` : ""}<span>Dicatat: <strong>${h(row.recordedBy)}</strong></span>${row.intervalHours ? `<span>Interval: <strong>${nf.format(row.intervalHours)} jam</strong></span>` : ""}${row.ocrConfidence != null ? `<span>OCR lama: <strong>${Math.round(row.ocrConfidence)}%</strong></span>` : ""}</div>${computedStatus === "legacy" ? `<div class="reading-reason legacy-note"><span>Data lama</span><p>Pembacaan ini tetap disimpan untuk audit, tetapi tidak dipakai pada KPI karena basis prabayar sebelumnya belum dibedakan.</p></div>` : ""}${row.reason?.trim() ? `<div class="reading-reason"><span>Catatan verifikasi</span><p>${h(row.reason)}</p></div>` : ""}${flags(row).length ? `<div class="flag-list">${flags(row).map((flag) => `<span>${h(flagLabel[flag] || flag)}</span>`).join("")}</div>` : ""}</article>`;
    }).join("")
    : `<div class="empty-list">Belum ada pembacaan.</div>`;
  const loadControl = historyFullyLoaded
    ? `<span class="history-complete">Semua riwayat sudah dimuat.</span>`
    : `<button class="secondary-button" id="loadMoreHistory" ${historyLoading ? "disabled" : ""}>${historyLoading ? "Memuat…" : "Muat riwayat lama"}</button>`;
  content.innerHTML = `<div class="page-stack"><section class="page-intro history-intro"><div><p class="section-kicker">AUDIT TRAIL</p><h2>Riwayat pembacaan</h2><p>Data 14 hari terakhir diperbarui live. Riwayat lebih lama dimuat saat diperlukan.</p></div><button class="secondary-button" id="exportCsv">Export CSV data tampil</button></section><section class="reading-list">${cards}</section><section class="history-footer">${loadControl}${historyLoadError ? `<span class="history-error">${h(historyLoadError)}</span>` : ""}<small>CSV berisi riwayat yang sudah tampil di perangkat ini.</small></section></div>`;
  document.querySelector("#exportCsv").addEventListener("click", exportCsv);
  document.querySelector("#loadMoreHistory")?.addEventListener("click", loadMoreHistory);
}

async function loadMoreHistory() {
  if (historyLoading || historyFullyLoaded || !db) return;
  historyLoading = true;
  historyLoadError = "";
  if (state.tab === "history") renderHistory();
  try {
    const constraints = [
      where("capturedAt", "<", historyBoundary || new Date().toISOString()),
      orderBy("capturedAt", "desc"),
    ];
    if (historyCursor) constraints.push(startAfter(historyCursor));
    constraints.push(queryLimit(100));
    const snapshot = await getDocs(query(collection(db, "readings"), ...constraints));
    const rows = snapshot.docs.map((row) => ({ id: row.id, ...row.data() }));
    rows.forEach((row) => historyReadingIds.add(row.id));
    mergeReadings(rows);
    historyCursor = snapshot.docs[snapshot.docs.length - 1] || historyCursor;
    historyFullyLoaded = snapshot.docs.length < 100;
  } catch (error) {
    historyLoadError = friendlyDataError(error, "Riwayat lama belum dapat dimuat. Coba lagi.");
  } finally {
    historyLoading = false;
    if (state.tab === "history") renderHistory();
  }
}

function exportCsv() {
  const header = [
    "Tanggal", "Store", "Meter", "Model Listrik", "Basis Pembacaan",
    "Angka Sekarang", "Angka Sebelumnya", "Token Masuk ke Rumus kWh",
    "Jumlah Pembelian Token", "Total Pembelian Token kWh",
    "Total Pembelian Token Rp", "Revisi Token Dari", "Revisi Token Sampai",
    "Status Tautan Token", "Pemakaian kWh",
    "Interval Jam", "kWh per 24 Jam", "Estimasi Biaya/Nilai Energi",
    "Status", "Pencatat", "Alasan",
  ];
  const rows = visibleHistoryReadings().map((reading) => {
    const store = state.stores.find((item) => item.id === reading.storeId);
    const meter = state.meters.find((item) => item.id === reading.meterId);
    const storeName = reading.storeName || store?.name || reading.storeId;
    const storeCode = reading.storeCode || store?.code || "";
    const storeLabel = [storeCode, storeName].filter(Boolean).join(" · ");
    const meterSerial = reading.meterSerial || meter?.serialNumber || reading.meterId;
    const model = reading.electricityModel || store?.electricityModel;
    return [
      reading.readingDate, storeLabel, meterSerial, electricityModelLabel(model),
      readingBasisLabel(reading.readingBasis), reading.readingKwh,
      reading.previousReadingKwh, reading.tokenAddedKwh ?? 0,
      reading.tokenPurchaseCount ?? 0,
      reading.tokenPurchaseTotalKwh ?? reading.tokenAddedKwh ?? 0,
      reading.tokenPurchaseTotalAmountRp ?? 0,
      reading.tokenRevisionStart ?? "", reading.tokenRevisionEnd ?? "",
      reading.tokenLinkDisposition ?? "legacy",
      reading.usageKwh, reading.intervalHours, reading.normalized24hKwh,
      reading.estimatedCost, reading.status, reading.recordedBy, reading.reason,
    ].map(csvCell).join(",");
  });
  const blob = new Blob(["\uFEFF", [header.join(","), ...rows].join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `riwayat-energi-${localDate()}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function renderMaster() {
  const prepaidCount = state.stores.filter((store) => store.electricityModel === "prepaid").length;
  const postpaidCount = state.stores.filter((store) => store.electricityModel === "postpaid").length;
  content.innerHTML = `<div class="page-stack"><section class="page-intro master-intro"><div><p class="section-kicker">MASTER TERKUNCI</p><h2>Master store & meter</h2><p>Data mengikuti ${h(masterSource)} dan hanya dapat berubah melalui pembaruan master resmi.</p></div><span class="locked-badge">▣ Tidak bisa ditambah manual</span></section><section class="master-summary"><article><span>Total store</span><strong>${state.stores.length}</strong></article><article><span>Prabayar</span><strong>${prepaidCount}</strong></article><article><span>Pascabayar</span><strong>${postpaidCount}</strong></article><article><span>Versi master</span><strong>${h(masterVersion)}</strong></article></section><section class="panel"><div class="panel-heading"><div><p class="section-kicker">DAFTAR RESMI</p><h2>Store dan meter aktif</h2></div></div><div class="master-list locked-master-list">${state.stores.map((store) => { const meter = state.meters.find((item) => item.storeId === store.id); return `<article><div><strong>${h(store.name)}</strong><small>${h(store.code)} · ${h(store.area)} · <span class="electricity-model-badge ${h(store.electricityModel)}">${electricityModelLabel(store.electricityModel)}</span></small></div><div class="master-tariff"><strong>${tariffRupiah.format(store.tariffPerKwh)}</strong><small>tarif per kWh</small></div><div class="master-detail-grid"><div><span>Nomor seri meter</span><strong>${h(meter?.serialNumber || "–")}</strong></div><div><span>Daya meteran</span><strong>${meter ? nf.format(meter.meterPower) : "–"}</strong></div><div><span>Koordinat store</span><strong>${h(store.coordinateText)}</strong></div></div></article>`; }).join("")}</div></section><section class="privacy-explainer">▣ <div><strong>Master dikunci</strong><p>User tidak dapat menambah, mengubah, atau menghapus store, model listrik, atau meter secara manual. Database hanya menerima pembacaan dari pasangan store–meter resmi.</p></div></section><section class="privacy-explainer">◆ <div><strong>Rumus mengikuti model listrik</strong><p>Prabayar dihitung dari sisa sebelumnya + total kWh pembelian token terkait − sisa sekarang. Pascabayar dihitung dari meter sekarang − meter sebelumnya. Nominal pembelian token tetap terpisah dari nilai konsumsi.</p></div></section></div>`;
}

document.querySelectorAll("[data-tab]").forEach((button) => button.addEventListener("click", () => {
  if (formSaveInFlight) return;
  if (button.dataset.tab === state.tab) return;
  state.tab = button.dataset.tab;
  render();
}));
document.querySelector("#refreshButton").addEventListener("click", () => {
  if (!formSaveInFlight) restartLiveData();
});
window.addEventListener("online", handleConnectionChange);
window.addEventListener("offline", handleConnectionChange);
window.addEventListener("pagehide", () => {
  unsubscribeReadings?.();
  unsubscribeReadings = null;
});
window.addEventListener("pageshow", () => {
  if (db && !unsubscribeReadings) restartLiveData({ silent: true });
});
window.addEventListener("beforeunload", () => {
  unsubscribeReadings?.();
});

/**
 * Service worker hanya menyimpan shell statis dengan strategi network-first.
 * Saat deploy baru aktif, halaman dimuat ulang satu kali agar crew tidak pernah
 * memakai rumus atau master versi lama.
 */
function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  if (window.location.protocol !== "https:" && window.location.hostname !== "localhost") return;
  let reloadingForUpdate = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloadingForUpdate) return;
    reloadingForUpdate = true;
    window.location.reload();
  });
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(`/sw.js?v=${APP_VERSION}`, { scope: "/" })
      .then((registration) => {
        registration.update().catch(() => {});
        window.setInterval(() => registration.update().catch(() => {}), 60 * 60 * 1000);
      })
      .catch((error) => console.warn("Service worker tidak terpasang:", error));
  });
}

registerServiceWorker();
init();
