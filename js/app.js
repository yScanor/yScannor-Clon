/* yScannor © 2026 — marca d'água: ys-51b312666cb3 */
/* ── Servidor do clonador ──
   Deixe "" quando o site e o servidor estão no mesmo endereço.
   Se o site fica no GitHub Pages, coloque o endereço do servidor. Ex.: "https://yscannor.onrender.com" */
var YS_API_BASE = "https://yscannor-clon.onrender.com";
YS_API_BASE = String(YS_API_BASE).replace(/\/+$/, ""); // remove barras no final
/* ── Web Cloner Application JavaScript ── */

/* ── DOM refs ── */
const form = document.getElementById("clonerForm");
const urlInput = document.getElementById("websiteUrl");
const depthSelect = document.getElementById("cloneDepth");
const cloneBtn = document.getElementById("cloneBtn");
const progressPanel = document.getElementById("progressPanel");
const progressIcon = document.getElementById("progressIcon");
const progressTitle = document.getElementById("progressTitle");
const progressSub = document.getElementById("progressSubtitle");
const progressFill = document.getElementById("progressFill");
const progressPct = document.getElementById("progressPercent");
const progressStat = document.getElementById("progressStatus");
const progressLog = document.getElementById("progressLog");
const downloadArea = document.getElementById("downloadArea");
const downloadLink = document.getElementById("downloadLink");
const statPages = document.getElementById("statPages");
const statAssets = document.getElementById("statAssets");
const statErrors = document.getElementById("statErrors");
const statTotal = document.getElementById("statTotal");

let eventSource = null;
let pages = 0,
  assets = 0,
  errors = 0,
  total = 0;

const APP_I18N = (() => {
  try {
    const raw = document.body?.dataset?.appI18n;
    return raw ? JSON.parse(raw) : {};
  } catch (_) {
    return {};
  }
})();

function t(key, fallback, vars) {
  const template = APP_I18N[key] || fallback;
  if (!vars) return template;

  return Object.keys(vars).reduce((acc, varName) => {
    return acc.replaceAll(`{${varName}}`, String(vars[varName]));
  }, template);
}

/**
 * Show toast notification
 */
function showToast(message, type = "info") {
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

/**
 * Paste URL from clipboard
 */
function pasteUrl() {
  navigator.clipboard.readText().then(function (t) {
    urlInput.value = t;
    urlInput.focus();
  });
}

/**
 * Reset cloner to initial state
 */
function resetCloner() {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
  progressPanel.classList.remove("active");
  downloadArea.classList.remove("active");
  progressFill.style.width = "0%";
  progressFill.classList.remove("done");
  progressLog.innerHTML = "";
  progressIcon.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
  progressIcon.className = "icon-wrap";
  progressTitle.textContent = t("cloningWebsite", "Cloning website…");
  progressSub.textContent = t(
    "fetchingPagesAssets",
    "Fetching pages and assets",
  );
  progressPct.textContent = "0%";
  progressStat.textContent = t("statusStarting", "Starting…");
  pages = 0;
  assets = 0;
  errors = 0;
  total = 0;
  statPages.textContent = "0";
  statAssets.textContent = "0";
  statErrors.textContent = "0";
  statTotal.textContent = "0";
  cloneBtn.disabled = false;
  cloneBtn.querySelector(".arrow-icon").style.display = "";
  cloneBtn.querySelector(".spinner-icon").style.display = "none";
  cloneBtn.querySelector(".btn-text").textContent = t(
    "cloneButtonIdle",
    "Start Clone",
  );
  urlInput.value = "";
  urlInput.focus();
}

/**
 * Escape HTML special characters
 */
function escHtml(s) {
  var d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

/**
 * Add log entry to progress log
 */
function addLog(text, type) {
  var div = document.createElement("div");
  div.className = "log-entry";
  var iconClass = "info",
    iconHtml = '<i class="fas fa-info"></i>';
  if (type === "fetch") {
    iconClass = "fetch";
    iconHtml = '<i class="fas fa-download"></i>';
  } else if (type === "ok" || type === "done") {
    iconClass = "ok";
    iconHtml = '<i class="fas fa-check"></i>';
  } else if (type === "error") {
    iconClass = "err";
    iconHtml = '<i class="fas fa-times"></i>';
  }
  div.innerHTML =
    '<div class="log-icon ' +
    iconClass +
    '">' +
    iconHtml +
    '</div><div class="log-text">' +
    escHtml(text) +
    "</div>";
  progressLog.appendChild(div);
  progressLog.scrollTop = progressLog.scrollHeight;
}

/**
 * Update progress bar
 */
function updateBar(pct) {
  progressFill.style.width = pct + "%";
  progressPct.textContent = Math.round(pct) + "%";
}

/**
 * Form submission handler
 */
form.addEventListener("submit", function (e) {
  e.preventDefault();
  var url = urlInput.value.trim();
  var depth = depthSelect.value;
  if (!url) {
    showToast(t("enterWebsiteUrl", "Please enter a website URL"), "error");
    urlInput.focus();
    return;
  }

  pages = 0;
  assets = 0;
  errors = 0;
  total = 0;
  statPages.textContent = "0";
  statAssets.textContent = "0";
  statErrors.textContent = "0";
  statTotal.textContent = "0";
  progressLog.innerHTML = "";
  progressFill.style.width = "0%";
  progressFill.classList.remove("done");
  progressIcon.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
  progressIcon.className = "icon-wrap";
  progressTitle.textContent = t("cloningWebsite", "Cloning website…");
  progressSub.textContent = url;
  progressPct.textContent = "0%";
  progressStat.textContent = t("statusConnecting", "Connecting…");
  downloadArea.classList.remove("active");

  progressPanel.classList.add("active");
  cloneBtn.disabled = true;
  cloneBtn.querySelector(".arrow-icon").style.display = "none";
  cloneBtn.querySelector(".spinner-icon").style.display = "";
  cloneBtn.querySelector(".btn-text").textContent = t(
    "cloneButtonLoading",
    "Cloning…",
  );

  showToast(
    t(
      "cloningStartedToast",
      "Cloning started — watch the live progress below!",
    ),
    "loading",
  );
  setTimeout(function () {
    progressPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  }, 200);

  var params = new URLSearchParams({ url: url, depth: depth });
  eventSource = new EventSource(YS_API_BASE + "/website-cloner/stream?" + params.toString());

  /**
   * Handle fetch event
   */
  eventSource.addEventListener("fetch", function (ev) {
    var d = JSON.parse(ev.data);
    addLog(t("fetchingLog", "Fetching: {url}", { url: d.url }), "fetch");
    progressStat.textContent = t("statusFetchingPages", "Fetching pages…");
  });

  /**
   * Handle downloaded event
   */
  eventSource.addEventListener("downloaded", function (ev) {
    var d = JSON.parse(ev.data);
    total++;
    statTotal.textContent = total;
    if (d.contentType && d.contentType.includes("text/html")) {
      pages++;
      statPages.textContent = pages;
      addLog(t("pageLog", "✓ Page: {url}", { url: d.url }), "ok");
    } else {
      assets++;
      statAssets.textContent = assets;
      addLog(t("assetLog", "✓ Asset: {url}", { url: d.url }), "ok");
    }
    if (d.progress) updateBar(d.progress);
  });

  /**
   * Handle error event
   */
  eventSource.addEventListener("error_item", function (ev) {
    var d = JSON.parse(ev.data);
    errors++;
    statErrors.textContent = errors;
    total++;
    statTotal.textContent = total;
    addLog(
      t("errorLog", "✗ Error: {url} — {message}", {
        url: d.url,
        message: d.message,
      }),
      "error",
    );
  });

  /**
   * Handle done event
   */
  eventSource.addEventListener("done", function (ev) {
    var d = JSON.parse(ev.data);
    eventSource.close();
    eventSource = null;

    statTotal.textContent = d.totalFiles;
    statErrors.textContent = d.errors;
    updateBar(100);
    progressFill.classList.add("done");
    progressIcon.innerHTML = '<i class="fas fa-check"></i>';
    progressIcon.classList.add("done");
    progressTitle.textContent = t("cloneComplete", "Clone Complete!");
    progressSub.textContent = t(
      "doneSubtitle",
      "{count} files downloaded from {domain}",
      {
        count: d.totalFiles,
        domain: d.domain,
      },
    );
    progressStat.textContent = t("statusDone", "Done!");
    addLog(
      t("doneLog", "Cloning completed — {count} files, {errors} errors", {
        count: d.totalFiles,
        errors: d.errors,
      }),
      "done",
    );

    downloadLink.href = YS_API_BASE + "/website-cloner/download/" + d.jobId;
    downloadArea.classList.add("active");

    cloneBtn.disabled = false;
    cloneBtn.querySelector(".arrow-icon").style.display = "";
    cloneBtn.querySelector(".spinner-icon").style.display = "none";
    cloneBtn.querySelector(".btn-text").textContent = t(
      "cloneButtonIdle",
      "Start Clone",
    );
    showToast(
      t("doneToast", "Website cloned! {count} files downloaded.", {
        count: d.totalFiles,
      }),
      "success",
    );
  });

  /**
   * Handle clone error event
   */
  eventSource.addEventListener("clone_error", function (ev) {
    var d = JSON.parse(ev.data);
    eventSource.close();
    eventSource = null;
    progressIcon.innerHTML = '<i class="fas fa-times"></i>';
    progressIcon.classList.add("error");
    progressTitle.textContent = t("cloneFailed", "Clone Failed");
    progressSub.textContent = d.message;
    progressStat.textContent = t("statusError", "Error");
    addLog(
      t("cloneFailedLog", "Clone failed: {message}", { message: d.message }),
      "error",
    );

    cloneBtn.disabled = false;
    cloneBtn.querySelector(".arrow-icon").style.display = "";
    cloneBtn.querySelector(".spinner-icon").style.display = "none";
    cloneBtn.querySelector(".btn-text").textContent = t(
      "cloneButtonIdle",
      "Start Clone",
    );
    showToast(d.message, "error");
  });

  /**
   * Handle connection error
   */
  eventSource.onerror = function () {
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
    progressIcon.innerHTML = '<i class="fas fa-times"></i>';
    progressIcon.classList.add("error");
    progressTitle.textContent = t("connectionLost", "Connection Lost");
    progressSub.textContent = t(
      "connectionInterrupted",
      "The connection to the server was interrupted.",
    );
    progressStat.textContent = t("statusDisconnected", "Disconnected");
    cloneBtn.disabled = false;
    cloneBtn.querySelector(".arrow-icon").style.display = "";
    cloneBtn.querySelector(".spinner-icon").style.display = "none";
    cloneBtn.querySelector(".btn-text").textContent = t(
      "cloneButtonIdle",
      "Start Clone",
    );
    showToast(
      t("connectionLostToast", "Connection lost. Please try again."),
      "error",
    );
  };
});

/* ── Extension Auto-Start ── */
(function handleExtensionAutoStart() {
  var params = new URLSearchParams(window.location.search);
  var autoUrl = params.get("url");
  var autoDepth = params.get("depth");
  var autoStart = params.get("autostart");

  if (autoStart !== "true" || !autoUrl) return;

  // Clean the URL bar to remove query params
  var cleanUrl = window.location.origin + window.location.pathname;
  window.history.replaceState({}, document.title, cleanUrl);

  // Fill the URL input (URLSearchParams.get() already decodes)
  urlInput.value = autoUrl;

  // Set depth if valid (1-5)
  if (autoDepth) {
    var depthVal = Math.min(Math.max(parseInt(autoDepth) || 2, 1), 5);
    depthSelect.value = String(depthVal);
  }

  // Auto-submit: use cloneBtn.click() which reliably triggers
  // native form submission and the submit event handler
  setTimeout(function () {
    if (cloneBtn && !cloneBtn.disabled) {
      cloneBtn.click();
    }
  }, 600);
})();
