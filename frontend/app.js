"use strict";
/* ==========================================================================
   KlearNow Tariff — browser app (Duty stack)
   ========================================================================== */

import { bindCountryField, countryIsoFrom, formatCountry, resolveCountryIso } from "./countries.js";
import { bindHtsSuggest } from "./htsSuggest.js";
import {
  SURFACE,
  apiKeyFromQuery,
  clientId,
  getAccessToken,
  getConfig,
  getDemoRole,
  initAuth,
  isAuthenticated,
  isEmbed,
  loadConfig,
  login,
  logout,
  refreshToken,
  rpsUrl,
  setDemoRole,
} from "./auth.js";
import goldens from "./qc-examples.json";

let KEY = apiKeyFromQuery();

const S = {
  me: null, pack: null, flags: [], programs: [], snapshots: [],
  lines: [], seq: 0, last: null, rules: [], selectedRule: null,
  parsed: null, parsedKind: null,
  engines: { auto: "Auto-parts stacking + 301-FL by COO", ch99: "Ch99 reciprocal / IEEPA pack" },
  engine: "auto",
  scenarios: { A: null, B: null },
  config: null,
};

const ENGINE_TITLE = {
  auto: "Auto stack",
  ch99: "Ch99 reciprocal",
};

const PROGRAM_COLOR = {
  s301: "var(--color-blue-500)", s301fl: "var(--color-indigo-500)",
  s232: "var(--color-teal-500)", s122: "var(--color-purple-500)",
  s338: "var(--color-orange-500)", ch98: "var(--color-blue-gray-600)",
  ieepa: "var(--color-cyan-500)", s201: "var(--color-pink-500)",
  ch99: "var(--color-blue-sapphire-500)", base: "var(--color-blue-gray-400)",
};
const PROGRAM_NAME = {
  s301: "Section 301", s301fl: "Section 301 forced labor", s232: "Section 232",
  s122: "Section 122", s338: "Section 338 Canada", ch98: "Chapter 98",
  ieepa: "IEEPA", s201: "Section 201",
  ch99: "Ch99 reciprocal", base: "Column 1",
};

/* ---------------------------------------------------------------- helpers */
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const esc = s => String(s ?? "").replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = v => {
  const n = Number(v);
  return Number.isFinite(n)
    ? n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—";
};
const pct = v => Number.isFinite(Number(v))
  ? String(Number(v).toFixed(4)).replace(/0+$/, "").replace(/\.$/, "") : "—";
const dshort = v => v ? String(v).slice(0, 10) : "—";

async function api(path, opts = {}) {
  await refreshToken();
  const headers = {
    "Content-Type": "application/json",
    "X-Client-Id": clientId(),
    ...(opts.headers || {}),
  };
  const token = getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  else if (KEY) headers["X-API-Key"] = KEY;

  const res = await fetch(path, { ...opts, headers });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) {
    let d = data && (data.detail ?? data.error ?? data.message);
    if (Array.isArray(d)) d = d.map(x => `${(x.loc || []).join(".")}: ${x.msg}`).join("; ");
    else if (d && typeof d === "object") d = JSON.stringify(d);
    const err = new Error(d || `${res.status} ${res.statusText}`);
    err.status = res.status;
    err.payload = data;
    throw err;
  }
  return data;
}

function banner(target, kind, title, msg) {
  $(target).innerHTML = kind
    ? `<div class="banner ${kind}"><b>${esc(title)}</b>${esc(msg || "")}</div>` : "";
}

/* ---------------------------------------------------------------- routing */
function show(view) {
  $$(".view").forEach(v => v.classList.toggle("hide", v.id !== "view-" + view));
  $$("nav.side button").forEach(b =>
    b.dataset.view === view ? b.setAttribute("aria-current", "page")
                            : b.removeAttribute("aria-current"));
  document.body.classList.toggle("view-chat-on", view === "chat");
  if (view === "rules") loadRules();
  if (view === "insights") loadInsights();
  if (view === "history") loadSnapshots();
  if (view === "reference") loadReference();
  if (view === "upload") {
    renderUploadHelp({ keepStaged: true });
    refreshHtsLive();
  }
  if (view === "lookup") initLookup();
  if (view === "audit") initEs003Audit();
  if (view === "chat") initChat();
  if (view === "csms") initCsms();
  if (view === "users") loadUsers();
}
$$("nav.side button").forEach(b => b.onclick = () => show(b.dataset.view));
$("#gotoaudit").onclick = () => show("calc");

/* ================================================================ BOOT */
async function boot() {
  document.body.dataset.surface = SURFACE;
  if (isEmbed()) document.body.classList.add("embed");

  try {
    S.config = await loadConfig();
    await initAuth();
  } catch (e) {
    console.warn("config/auth", e);
  }

  bindAuthChrome();
  bindRpsLink();

  try {
    const h = await api("/v1/health");
    S.pack = h.rulepack;
    if (h.engines && typeof h.engines === "object") S.engines = h.engines;
    $("#packtext").innerHTML =
      `pack ${esc(h.rulepack.version)} &middot; ${h.rulepack.rules} rules ` +
      `<code>${esc((h.rulepack.hash || "").slice(0, 19))}…</code>`;
    $("#nav-rules").textContent = h.rulepack.rules;
  } catch (e) {
    $("#packdot").classList.add("bad");
    $("#packtext").textContent = "engine unreachable";
    banner("#calcbanner", "err", "Cannot reach the engine",
      e.message + " — start it with: cd backend && npm run dev");
  }
  renderEnginePicker();
  renderScenarioSlots();
  try {
    S.me = await api("/v1/me");
    $("#whochip").hidden = false;
    const role = S.me.role || (S.me.can?.admin ? "admin" : S.me.can?.write_rules ? "admin" : "user");
    $("#whochip").innerHTML = `${esc(S.me.key_id || S.me.tenant_id)}`;
    renderRoleChip({ ...S.me, role });
    applyScopes();
    renderQuota(S.me.quota);
    if (!isEmbed()) {
      const notes = {
        admin: "You are Admin: sidebar shows Manage. Chat answers from the live tables; pack writes stay a preview.",
        user: "You are User: Duty stack, Coverage, Chat, CSMS, and Audit.",
        guest: "You are Guest: 5 stacks / 2 extracts per day. Sign in for unlimited.",
      };
      banner("#calcbanner", "info", notes[role] || "Signed in",
        role === "admin"
          ? "Switch View as → User or Guest to compare."
          : "Switch View as → Admin to unlock Manage.");
    }
  } catch { /* auth disabled or anonymous */ }
  try { S.flags = (await api("/v1/reference/claim-flags")).flags || []; } catch { S.flags = []; }
  try {
    const p = await api("/v1/programs");
    S.programs = p.evaluation_order.map(id => ({ id, ...(p.programs[id] || {}) }));
    if (p.engines && typeof p.engines === "object") {
      S.engines = p.engines;
      renderEnginePicker();
    }
    $("#f-program").innerHTML = '<option value="">All</option>' +
      S.programs.map(p => `<option value="${esc(p.id)}">${esc(p.id)} — ${esc(p.label || "")}</option>`).join("");
  } catch { /* no scope */ }
  if (!S.lines.length) addLine();
  initQuickCheck();
  if ("serviceWorker" in navigator && !isEmbed()) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
}

function bindRpsLink() {
  const a = $("#rps-link");
  if (!a) return;
  const url = rpsUrl();
  if (!url) {
    a.hidden = true;
    return;
  }
  a.hidden = false;
  a.href = url;
}

function bindAuthChrome() {
  const loginBtn = $("#auth-login");
  const logoutBtn = $("#auth-logout");
  const roleSel = $("#role-select");
  const roleWrap = $("#role-switch");

  // Local / playground demo: Admin vs User vs Guest. Hidden on WordPress embed.
  if (roleWrap) {
    const showSwitch = !isEmbed() && SURFACE !== "external";
    roleWrap.hidden = !showSwitch;
    if (roleSel && showSwitch) {
      roleSel.value = getDemoRole();
      roleSel.onchange = () => {
        setDemoRole(roleSel.value);
        KEY = apiKeyFromQuery();
        location.reload();
      };
    }
  }

  if (loginBtn) {
    loginBtn.onclick = async () => {
      try { await login(); }
      catch (e) { banner("#calcbanner", "err", "Sign-in unavailable", e.message); }
    };
  }
  if (logoutBtn) {
    logoutBtn.onclick = () => logout();
  }
  void isAuthenticated().then((ok) => {
    const auth0Ready = Boolean(import.meta.env.VITE_AUTH0_DOMAIN || S.config?.auth0);
    if (loginBtn) loginBtn.hidden = ok || !auth0Ready;
    if (logoutBtn) logoutBtn.hidden = !ok;
  });
}

function renderRoleChip(me) {
  const el = $("#rolechip");
  if (!el || !me) return;
  el.hidden = false;
  const role = me.role || "user";
  el.className = `chip role-chip role-${role}`;
  const labels = {
    admin: "Admin — Manage + Chat",
    user: "User — Duty stack · Chat · CSMS",
    guest: "Guest — limited tries. Sign in for unlimited.",
  };
  el.textContent = labels[role] || role;
  el.title = me.auth === "api_key"
    ? `Local demo key ${me.key_id}`
    : `Auth via ${me.auth}`;
}

function renderQuota(q) {
  const el = $("#quotachip");
  if (!el || !q) return;
  el.hidden = false;
  if (q.unlimited) {
    el.textContent = "Unlimited";
    el.title = "Signed in / internal — no daily caps";
    return;
  }
  el.textContent = `Stacks ${q.stacks_remaining}/${q.stacks_limit} · Extracts ${q.extracts_remaining}/${q.extracts_limit}`;
  el.title = `Guest daily cap. Resets ${q.day} (UTC). Sign in for unlimited.`;
}

async function refreshMeQuota() {
  try {
    S.me = await api("/v1/me");
    renderQuota(S.me.quota);
  } catch { /* ignore */ }
}

function renderEnginePicker() {
  const grid = $("#enginegrid");
  if (!grid) return;
  const order = ["auto", "ch99"].filter(id => S.engines[id] != null);
  const ids = order.length ? order : Object.keys(S.engines);
  grid.innerHTML = ids.map(id => {
    const checked = S.engine === id ? "checked" : "";
    const title = ENGINE_TITLE[id] || id;
    return `<label class="engine-opt">
      <input type="radio" name="engine" value="${esc(id)}" ${checked} />
      <span class="eng-title">${esc(title)}</span>
      <p class="eng-desc">${esc(S.engines[id] || "")}</p>
    </label>`;
  }).join("");
  grid.querySelectorAll('input[name="engine"]').forEach(inp => {
    inp.onchange = () => {
      S.engine = inp.value;
      syncEngineChrome();
    };
  });
  syncEngineChrome();
}

function syncEngineChrome() {
  const title = ENGINE_TITLE[S.engine] || S.engine;
  $("#enginehint").textContent = title;
  const audit = $("#auditbtn");
  if (audit) {
    const ch99 = S.engine === "ch99";
    audit.disabled = ch99 || !S.lines.some(l => (l.filed_ch99 || "").trim());
    audit.title = ch99
      ? "Audit as filed is available on the Auto stack engine"
      : "";
  }
  const note = $("#enginenote");
  if (note && S.engine === "ch99") {
    note.innerHTML = `<b>Ch99</b> applies the reciprocal / IEEPA country pack. Filed-code audit
      stays on the <b>Auto</b> engine — switch back to audit Chapter&nbsp;99 filings against the
      auto-parts stack.`;
  } else if (note) {
    note.innerHTML = `<b>Auto</b> stacks 301 / 301-FL / 232 for auto-parts style entries.
      <b>Ch99</b> runs the reciprocal / IEEPA country pack. They answer different questions —
      use scenario compare when you need both.`;
  }
}

function applyScopes() {
  const can = S.me?.can || {};
  const isAdmin = Boolean(can.admin || S.me?.role === "admin");
  const canManage = Boolean(can.write_rules || isAdmin);
  const canBrowseRules = Boolean(can.read_rules && canManage); // browse pack only with Manage
  const hideManage = !canManage || isEmbed() || SURFACE === "external";
  const hideUserSurface = isEmbed() || SURFACE === "external";

  $$("[data-admin-only]").forEach((el) => el.classList.toggle("hide", hideManage));
  $$("[data-rules-browse]").forEach((el) =>
    el.classList.toggle("hide", hideManage),
  );
  $$("[data-user-surface]").forEach((el) => el.classList.toggle("hide", hideUserSurface));
  $$("[data-admin-write]").forEach((el) => el.classList.toggle("hide", hideManage));

  const manageViews = new Set(["rules", "upload", "history", "insights", "reference", "users"]);
  if (hideManage) {
    manageViews.forEach((v) => {
      const b = document.querySelector(`nav.side button[data-view="${v}"]`);
      if (b) b.classList.add("hide");
    });
    $$("nav.side .navgroup").forEach((g) => {
      if (/manage|understand/i.test(g.textContent || "")) g.classList.add("hide");
    });
    const cur = document.querySelector("nav.side button[aria-current='page']");
    if (cur && manageViews.has(cur.dataset.view)) show("calc");
  } else {
    manageViews.forEach((v) => {
      const b = document.querySelector(`nav.side button[data-view="${v}"]`);
      if (b) b.classList.remove("hide");
    });
    $$("nav.side .navgroup").forEach((g) => g.classList.remove("hide"));
  }

  const fab = $("#chat-fab");
  if (fab) fab.hidden = hideUserSurface;
  if (hideUserSurface) {
    ["chat", "csms"].forEach((v) => {
      const b = document.querySelector(`nav.side button[data-view="${v}"]`);
      if (b) b.classList.add("hide");
    });
    const cur = document.querySelector("nav.side button[aria-current='page']");
    if (cur && (cur.dataset.view === "chat" || cur.dataset.view === "csms")) show("calc");
  }

  const pub = $("#publishcard");
  if (pub) pub.hidden = true;
  if (canBrowseRules && !hideManage) {
    banner("#rulesbanner", "info", "Live pack + MCP",
      "Browse the seeded pack. Hot-update 301-FL via PUT /v1/admin/s301fl/countries/{iso2} or the MCP server (mcp/) — no rebuild. Full file edits still live in tariff-rules/data/.");
    banner("#historybanner", "info", "Single seeded snapshot",
      "The active snapshot is the pack on disk (hash refreshes on admin reload). Activate/publish UI disabled in v1.");
  }
  // Snapshots publish stays off in v1; HTS Upload is live for admins with write_rules.
  ["dopublish"].forEach(id => {
    const el = $("#" + id);
    if (el) el.disabled = true;
  });
  const canUpload = Boolean(can.write_rules || can.admin);
  ["uploadpreview", "filepick", "uploadbox", "uploadtemplate"].forEach(id => {
    const el = $("#" + id);
    if (el) el.disabled = !canUpload;
  });
  const commit = $("#uploadcommit");
  if (commit) commit.disabled = true; // enabled after a successful preview / xlsx staged
  if (!can.write_rules) {
    const el = $("#runvalidate"); if (el) el.disabled = true;
  }
}

/* ================================================================ QUICK CHECK */
const QC_DEFAULT_VALUE = 10000;

function parseEnteredValue(raw) {
  const n = Number(String(raw ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : NaN;
}

function formatEnteredValue(n) {
  if (!Number.isFinite(n)) return "";
  const cents = Math.round(n * 100) % 100 !== 0;
  return n.toLocaleString("en-US", {
    maximumFractionDigits: cents ? 2 : 0,
    minimumFractionDigits: cents ? 2 : 0,
  });
}

function syncEnteredValueField(el, { defaultIfEmpty = false } = {}) {
  if (!el) return;
  const parsed = parseEnteredValue(el.value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    if (defaultIfEmpty) el.value = formatEnteredValue(QC_DEFAULT_VALUE);
    return;
  }
  el.value = formatEnteredValue(parsed);
}

function initCountryFields(root = document) {
  root.querySelectorAll("input.country-field, input[data-country]").forEach((el) => {
    bindCountryField(el);
  });
}

function initQuickCheck() {
  const d = $("#qc-date");
  if (d && !d.value) d.value = new Date().toISOString().slice(0, 10);
  if (d) d.addEventListener("change", () => previewHtsMeta());
  const hts = $("#qc-hts");
  if (hts) {
    bindHtsSuggest(hts, {
      fetchSuggestions: async (q) => {
        const asOf = $("#qc-date")?.value || new Date().toISOString().slice(0, 10);
        const r = await api(
          `/v1/hts:suggest?q=${encodeURIComponent(q)}&as_of=${encodeURIComponent(asOf)}&limit=12`,
        );
        return r.hits || [];
      },
      onCommit: () => previewHtsMeta(),
    });
    let t = null;
    hts.addEventListener("input", () => {
      clearTimeout(t);
      t = setTimeout(previewHtsMeta, 350);
    });
  }
  const valueEl = $("#qc-value");
  if (valueEl) {
    syncEnteredValueField(valueEl, { defaultIfEmpty: true });
    valueEl.addEventListener("blur", () => syncEnteredValueField(valueEl, { defaultIfEmpty: true }));
  }
  document.querySelectorAll("[data-metal-mode]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("[data-metal-mode]").forEach(b => b.classList.toggle("active", b === btn));
      syncMetalModeUi();
      updateMetalResolved();
    });
  });
  ["qc-value", "qc-hts", "qc-steel-content", "qc-aluminum-content", "qc-copper-content"].forEach(id => {
    const el = $("#" + id);
    if (el) el.addEventListener("input", updateMetalResolved);
  });
  syncMetalPanel(null);
  initCountryFields();
  const cooEl = $("#qc-coo");
  if (cooEl) {
    let tFta = null;
    const kick = () => {
      clearTimeout(tFta);
      tFta = setTimeout(() => {
        syncFtaClaimUi();
        previewHtsMeta();
      }, 250);
    };
    ["change", "blur", "input"].forEach((ev) => cooEl.addEventListener(ev, kick));
  }
  syncFtaClaimUi();
  syncPharmaClaimUi();
  const pharmaBox = $("#qc-pharma");
  const s232Box = $("#qc-s232-pharma");
  if (pharmaBox) {
    pharmaBox.addEventListener("change", () => {
      if (pharmaBox.checked && s232Box) s232Box.checked = false;
    });
  }
  if (s232Box) {
    s232Box.addEventListener("change", () => {
      if (s232Box.checked && pharmaBox) pharmaBox.checked = false;
    });
  }
  syncChina301AdvUi();
  syncClaimEmptyState();
}

function metalInputMode() {
  const active = document.querySelector("[data-metal-mode].active");
  return active?.dataset.metalMode === "PCT" ? "PCT" : "USD";
}

function syncMetalModeUi() {
  const mode = metalInputMode();
  $$(".metal-content").forEach((input) => {
    input.placeholder = (input.id === "qc-copper-content" && mode === "PCT") ? "e.g. 10" : "";
    input.title = mode === "PCT"
      ? "Percent of entered value for this metal"
      : "Dollar value of this metal’s content";
  });
}

function readMetalContentsFromQuick() {
  const mode = metalInputMode();
  const kinds = ["steel", "aluminum", "copper"];
  const out = {};
  for (const k of kinds) {
    const raw = ($(`#qc-${k}-content`)?.value || "").trim();
    const melt = countryIsoFrom($(`#qc-${k}-melt`));
    if (!raw && !melt) continue;
    const n = Number(String(raw).replace(/[$,\s]/g, ""));
    const row = {};
    if (Number.isFinite(n) && n > 0) {
      if (mode === "PCT") row.pct = n;
      else row.value = n;
    }
    if (melt) row.melt_pour = melt;
    if (row.value != null || row.pct != null || row.melt_pour) out[k] = row;
  }
  return out;
}

function updateMetalResolved() {
  const el = $("#qc-metal-resolved");
  if (!el) return;
  const entered = parseEnteredValue($("#qc-value")?.value);
  const mode = metalInputMode();
  const parts = [];
  let total = 0;
  let pctSum = 0;
  let hasPct = false;
  for (const k of ["steel", "aluminum", "copper"]) {
    const raw = Number(($(`#qc-${k}-content`)?.value || "").replace(/[$,\s]/g, ""));
    if (!Number.isFinite(raw) || raw <= 0) continue;
    let basis = raw;
    if (mode === "PCT") {
      hasPct = true;
      pctSum += raw;
      if (!(Number.isFinite(entered) && entered > 0)) {
        parts.push(`${k} ${raw}%`);
        continue;
      }
      basis = entered * raw / 100;
    }
    total += basis;
    parts.push(`${k} $${basis.toFixed(2)}`);
  }
  if (!parts.length) {
    el.textContent = "";
    const meta = $("#qc-metal-summary-meta");
    if (meta && $("#qc-metal-wrap")?.dataset.required !== "1") {
      meta.textContent = "Optional — expand to enter %";
    }
    return;
  }
  const pct = hasPct
    ? pctSum
    : (Number.isFinite(entered) && entered > 0 ? (total / entered) * 100 : null);
  const dig = ($("#qc-hts")?.value || "").replace(/\D/g, "");
  const ch = dig.slice(0, 2);
  const article = ["72", "73", "74", "76"].includes(ch);
  let path = "";
  if (pct != null && pct > 0) {
    if (article) {
      path = " Steel/aluminum/copper article → 9903.82.02 (needs melt/pour).";
    } else if (pct < 15) {
      path = " Under 15% → 9903.82.03 at 0%. 301-FL still applies.";
    } else {
      path = " 15% or more → 9903.82.09 at 25% on entered value (replaces 301-FL).";
    }
  }
  el.textContent = (hasPct && !(Number.isFinite(entered) && entered > 0)
    ? `Metal content ${parts.join(" + ")}`
    : `Metal-content basis ${parts.join(" + ")} = $${total.toFixed(2)}` +
      (Number.isFinite(entered) && entered > 0 ? ` (${((total / entered) * 100).toFixed(1)}% of entered)` : ""))
    + path;
  const meta = $("#qc-metal-summary-meta");
  if (meta) {
    meta.textContent = path.trim() || `${((pct != null) ? pct.toFixed(1) + "% of entered" : parts.join(" + "))}`;
  }
}

function syncMetalPanel(articleHit) {
  const wrap = $("#qc-metal-wrap");
  const panel = $("#qc-metal-panel");
  if (wrap) wrap.hidden = false;
  const required = Boolean(articleHit);
  if (wrap) wrap.dataset.required = required ? "1" : "";
  if (panel) panel.classList.toggle("is-required", required);
  const title = $("#qc-metal-title");
  const hint = $("#qc-metal-hint");
  const summaryMeta = $("#qc-metal-summary-meta");
  if (articleHit) {
    if (title) title.textContent = `Section 232 metals — ${articleHit.metal} (required)`;
    if (summaryMeta) summaryMeta.textContent = "Required for this HTS — enter content";
    if (hint) {
      hint.textContent = `Primary from HTS: ${articleHit.metal}. Enter steel, aluminum, and/or copper content (USD or %). Melt/pour (or smelt) is required for each metal you enter.`;
    }
    $$(".metal-row").forEach((row) => {
      row.style.outline = row.dataset.metal === articleHit.metal ? "2px solid var(--color-orange-500)" : "";
    });
    const excl = $("#qc-exclusions");
    if (excl) {
      excl.hidden = false;
      excl.innerHTML = `<span class="eyebrow">Potential exclusion codes</span>` +
        (articleHit.potential_exclusions || []).map(e =>
          `<div class="excl-item"><code class="mono">${esc(e.ch99)}</code> ${esc(e.label)}</div>`
        ).join("");
    }
  } else {
    if (title) title.textContent = "Metal / copper content";
    if (summaryMeta && !Object.keys(readMetalContentsFromQuick()).length) {
      summaryMeta.textContent = "Optional — expand to enter %";
    }
    if (hint) {
      hint.innerHTML = `Optional. Enter copper, steel, or aluminum as % of entered value.
        Under 15% on a non-article HTS files <span class="mono">9903.82.03</span> at 0% and keeps 301-FL.
        15% or more files <span class="mono">9903.82.09</span> at 25% (replaces 301-FL).`;
    }
    $$(".metal-row").forEach((row) => {
      row.style.outline = "";
    });
    const excl = $("#qc-exclusions");
    if (excl) excl.hidden = true;
  }
  const hasInput = Object.keys(readMetalContentsFromQuick()).length > 0;
  if (panel && required) panel.open = true;
  if (panel && !required && !hasInput && panel.dataset.wasRequired === "1") {
    panel.open = false;
  }
  if (panel) panel.dataset.wasRequired = required ? "1" : "";
  syncMetalModeUi();
  initCountryFields($("#qc-metal-wrap"));
  updateMetalResolved();
}

async function previewHtsMeta() {
  const el = $("#qc-htsmeta");
  const wrap = $("#qc-qty-wrap");
  const hts = ($("#qc-hts")?.value || "").trim();
  if (!el) return;
  if (!hts || hts.replace(/\D/g, "").length < 6) {
    el.innerHTML = "";
    clearHtsContext();
    if (wrap) wrap.hidden = true;
    syncMetalPanel(null);
    syncPharmaClaimUi();
    syncS232ClaimUi();
    syncS338ClaimUi();
    syncS201ClaimUi();
    sync232AutoPartClaimUi(null);
    syncChina301AdvUi();
    return;
  }
  syncPharmaClaimUi();
  syncChina301AdvUi();
  const asOf = $("#qc-date")?.value || new Date().toISOString().slice(0, 10);
  const coo = countryIsoFrom($("#qc-coo"));
  try {
    const qs = new URLSearchParams({ as_of: asOf });
    if (coo) qs.set("coo", coo);
    const r = await api(`/v1/hts/${encodeURIComponent(hts)}?${qs.toString()}`);
    const bits = [];
    if (r.window_status === "ended") {
      bits.push(
        `<span class="pill pill-ended" title="No Column-1 rate window covers the as-of date">Ended${r.ended_on ? ` ${esc(r.ended_on)}` : ""}</span>`,
      );
    }
    if (r.rate_label || r.col1_pct != null) {
      bits.push(`Column 1 <b class="mono">${esc(r.rate_label || formatQuickCol1(r))}</b>`);
    }
    if (r.start && r.end) bits.push(`<span class="cap">(${esc(r.start)} → ${esc(r.end)})</span>`);
    if (r.replacement_hts) {
      const replLabel = r.replacement_hts_display || r.replacement_hts;
      const replRate = r.replacement?.rate_label
        ? ` · ${esc(r.replacement.rate_label)}`
        : "";
      bits.push(
        `<span class="hts-repl">Suggested replacement <b class="mono">${esc(replLabel)}</b>${replRate}` +
          ` <button type="button" class="btn-secondary btn-sm" data-use-hts="${esc(replLabel)}">Use replacement</button></span>`,
      );
    }
    const china = r.china_301;
    if (china?.list) {
      bits.push(
        `<span class="pill pill-301" title="Resolved from 8-digit HTS membership">China 301 ${esc(china.list.replace(/_/g, " "))} → ${esc(china.ch99)}</span>`,
      );
    }
    const fy = r.china_301_fy;
    if (fy?.ch99) {
      bits.push(
        `<span class="pill pill-301" title="${esc(fy.reason || "U.S. note 31")}">China 301 note 31 → ${esc(fy.ch99)} @ ${esc(String(fy.rate_pct))}%</span>`,
      );
    }
    if (r.metals) {
      bits.push(
        `<span class="pill pill-metals">232 ${esc(r.metals.metal)} → ${esc(r.metals.duty_ch99)} @ ${esc(String(r.metals.rate_pct))}%</span>`,
      );
    }
    const uni = r.s232_universe || {};
    if (uni.passenger_vehicle) {
      bits.push(
        `<span class="pill pill-232" title="CSMS #64624801">232 passenger vehicle → ${esc(uni.passenger_vehicle.ch99)}</span>`,
      );
    }
    if (uni.mhdv_vehicle) {
      bits.push(
        `<span class="pill pill-232" title="CSMS #66665333">232 MHDV → ${esc(uni.mhdv_vehicle.ch99)}</span>`,
      );
    }
    if (uni.mhdv_bus) {
      bits.push(
        `<span class="pill pill-232" title="CSMS #66665333">232 bus → ${esc(uni.mhdv_bus.ch99)}</span>`,
      );
    }
    if (uni.wood) {
      bits.push(
        `<span class="pill pill-232" title="CSMS #66492057">232 wood ${esc(uni.wood.bucket)} → ${esc(uni.wood.ch99)}</span>`,
      );
    }
    const s338 = r.section_338 || {};
    if (s338.duty) {
      bits.push(
        `<span class="pill pill-232" title="CSMS #69668138">Section 338 Canada → ${esc(s338.duty.heading)} @ 50%</span>`,
      );
    }
    if (s338.aircraft) {
      bits.push(
        `<span class="pill pill-232" title="Civil aircraft list — claim General Note 6">Section 338 aircraft list → 9903.03.16</span>`,
      );
    }
    const s201 = r.section_201 || {};
    if (s201.covered || s201.in_quota) {
      bits.push(
        `<span class="pill pill-201" title="U.S. note 41 QSP TRQ">Section 201 QSP → ${esc(s201.in_quota || "9903.45.30")} (over ${esc(s201.over_quota || "9903.45.31")})</span>`,
      );
    }
    const uas = uni.uas || {};
    if (uas.annex_i) {
      bits.push(
        `<span class="pill pill-232" title="Proc. 11055 / U.S. note 43">232 UAS large → 9903.08.21 @ 100% from 2026-09-03</span>`,
      );
    } else if (uas.annex_ii) {
      bits.push(
        `<span class="pill pill-232" title="Proc. 11055 / U.S. note 43">232 UAS small → 9903.08.22 @ 25% from 2026-09-03</span>`,
      );
    }
    syncS338ClaimUi(s338);
    syncS201ClaimUi(s201);
    syncS232ClaimUi(uni);

    const annex = r.s232_auto_parts;
    sync232AutoPartClaimUi(r);
    if (annex?.in_annex) {
      bits.push(
        `<span class="pill pill-232" title="${esc(annex.source || "Proclamation 10908")}">232 autos annex ${esc(annex.matched_stem)} → ${esc(annex.ch99 || "9903.94.05")}</span>`,
      );
    } else {
      const dig = String(hts).replace(/\D/g, "");
      if (dig.startsWith("854442") || dig.startsWith("854449")) {
        bits.push(
          `<span class="pill pill-warn" title="CBP Auto Parts HTS list">Not 232 autos annex — list has 8544.30.00, not 8544.42/49</span>`,
        );
      }
      if (dig.startsWith("848350")) {
        bits.push(
          `<span class="pill pill-warn" title="CBP Auto Parts HTS list">Not 232 autos annex — list has 8483.10, not 8483.50. Check 232 auto part to self-cert 9903.94.07</span>`,
        );
      }
    }

    const url = r.usitc_url || `https://hts.usitc.gov/search?query=${encodeURIComponent(String(hts).replace(/\D/g, ""))}`;
    bits.push(`<a class="usitc-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">USITC HTS</a>`);

    // Rate / program feedback stays under the form; HTS narrative + compliance live in Stack result.
    el.innerHTML = `<div class="qc-meta-row">${bits.join(" · ")}</div>`;
    renderHtsContext(r, hts);

    const useBtn = el.querySelector("[data-use-hts]");
    if (useBtn) {
      useBtn.addEventListener("click", (e) => {
        e.preventDefault();
        const next = useBtn.getAttribute("data-use-hts");
        if (!next) return;
        const field = $("#qc-hts");
        if (field) field.value = next;
        previewHtsMeta();
      });
    }

    if (wrap) {
      const need = Boolean(r.needs_quantity);
      wrap.hidden = !need;
      const uom = (r.uom1 || "").toUpperCase();
      const uomEl = $("#qc-qty-uom");
      if (uomEl) uomEl.textContent = uom ? `(${uom})` : "";
      const hint = $("#qc-qty-hint");
      if (hint) {
        const pct = Number(r.col1_pct) || 0;
        const cents = r.col1_specific_cents ?? (r.col1_specific_usd != null
          ? Math.round(Number(r.col1_specific_usd) * 10000) / 100 : null);
        const parts = [];
        if (pct > 0) parts.push(`entered value × ${pct}%`);
        if (cents != null && Number(cents) > 0) {
          parts.push(`quantity (${uom || "UOM"}) × ${cents}¢/${uom || "unit"}`);
        }
        hint.textContent = need
          ? `Column 1 from this HTS: ${parts.join(" + ") || r.rate_label}. Enter the quantity reported on the entry in ${uom || "the HTS unit of quantity"}.`
          : "";
      }
      const qty = $("#qc-qty");
      if (qty) {
        qty.placeholder = "";
        qty.title = need
          ? `Quantity in ${uom || "the HTS unit of measure"} — required for specific Column-1 rates`
          : "Quantity in the HTS unit of measure";
      }
    }

    syncMetalPanel(r.metals);
  } catch (err) {
    clearHtsContext();
    const detail = err?.payload || null;
    if (detail?.replacement_hts) {
      const replLabel = detail.replacement_hts_display || detail.replacement_hts;
      el.innerHTML =
        `<span class="pill pill-ended">Not in HTS table</span> · Suggested replacement <b class="mono">${esc(replLabel)}</b> ` +
        `<button type="button" class="btn-secondary btn-sm" data-use-hts="${esc(replLabel)}">Use replacement</button> · ` +
        `<a class="usitc-link" href="https://hts.usitc.gov/search?query=${encodeURIComponent(String(hts).replace(/\D/g, ""))}" target="_blank" rel="noopener noreferrer">Look up on USITC</a>`;
      const useBtn = el.querySelector("[data-use-hts]");
      if (useBtn) {
        useBtn.addEventListener("click", (e) => {
          e.preventDefault();
          const next = useBtn.getAttribute("data-use-hts");
          if (!next) return;
          const field = $("#qc-hts");
          if (field) field.value = next;
          previewHtsMeta();
        });
      }
    } else {
      el.innerHTML =
        `<span class="pill pill-ended">Not in HTS table</span> · No Column-1 rate — duty will not calculate until this HTS is valid. ` +
        `<a class="usitc-link" href="https://hts.usitc.gov/search?query=${encodeURIComponent(String(hts).replace(/\D/g, ""))}" target="_blank" rel="noopener noreferrer">Look up on USITC</a>`;
    }
    if (wrap) wrap.hidden = true;
    syncMetalPanel(null);
    sync232AutoPartClaimUi(null);
  }
}

function clearHtsContext() {
  const ctx = $("#hts-context");
  if (!ctx) return;
  ctx.hidden = true;
  ctx.innerHTML = "";
  syncStackEmptyHint();
}

/** Map ACE PGA tariff-flag prefixes → agency names users recognize. */
const PGA_AGENCY_BY_PREFIX = {
  FD: { name: "FDA", detail: "Food and Drug Administration — PGA message set may be required" },
  AM: { name: "USDA AMS", detail: "USDA Agricultural Marketing Service (incl. National Organic Program)" },
  FS: { name: "USDA FSIS", detail: "USDA Food Safety and Inspection Service" },
  AQ: { name: "APHIS", detail: "USDA Animal and Plant Health Inspection Service" },
  AP: { name: "APHIS", detail: "USDA Animal and Plant Health Inspection Service" },
  AE: { name: "APHIS", detail: "USDA Animal and Plant Health Inspection Service" },
  EP: { name: "EPA", detail: "Environmental Protection Agency" },
  NW: { name: "NOAA Fisheries", detail: "National Marine Fisheries Service / NOAA" },
  NM: { name: "NOAA Fisheries", detail: "National Marine Fisheries Service / NOAA" },
  FW: { name: "Fish & Wildlife", detail: "U.S. Fish and Wildlife Service" },
  DT: { name: "DOT", detail: "Department of Transportation" },
  CP: { name: "CPSC", detail: "Consumer Product Safety Commission" },
  TT: { name: "TTB", detail: "Alcohol and Tobacco Tax and Trade Bureau" },
};

function agencyForPgaCode(code) {
  const c = String(code || "").trim().toUpperCase();
  if (!c) return null;
  const prefix = c.slice(0, 2);
  const known = PGA_AGENCY_BY_PREFIX[prefix];
  if (known) return { ...known, codes: [c] };
  return {
    name: "Partner agency",
    detail: `ACE PGA tariff flag ${c} — confirm which agency message set applies before filing`,
    codes: [c],
  };
}

/** Group PGA codes by agency; FDA first, then others by name. */
function groupPgaAgencies(flags) {
  const codes = Array.isArray(flags?.pga) ? flags.pga : [];
  const byName = new Map();
  for (const code of codes) {
    const agency = agencyForPgaCode(code);
    if (!agency) continue;
    const prev = byName.get(agency.name);
    if (prev) prev.codes.push(...agency.codes);
    else byName.set(agency.name, { ...agency, codes: [...agency.codes] });
  }
  return [...byName.values()].sort((a, b) => {
    if (a.name === "FDA") return -1;
    if (b.name === "FDA") return 1;
    return a.name.localeCompare(b.name);
  });
}

/** Human-readable compliance notices — collapsed one line; expand for detail (design: Watch for). */
function renderHtsFlagPills(flags) {
  if (!flags) return "";
  const rows = [];
  for (const agency of groupPgaAgencies(flags)) {
    const codeList = agency.codes.join(", ");
    rows.push(
      `<div class="hts-watch" data-expanded="0">` +
        `<button type="button" class="hts-watch-toggle" aria-expanded="false" data-hts-watch-toggle>` +
          `<span class="hts-watch-chevron" aria-hidden="true">▸</span>` +
          `<span class="hts-watch-agency">${esc(agency.name)}</span>` +
          `<span class="hts-watch-short">May need PGA filing</span>` +
        `</button>` +
        `<div class="hts-watch-detail" hidden>` +
          `<p>${esc(agency.detail)}</p>` +
          `<p class="cap">ACE flag${agency.codes.length > 1 ? "s" : ""}: ${esc(codeList)}</p>` +
        `</div>` +
      `</div>`,
    );
  }
  if (flags.add) {
    rows.push(
      `<div class="hts-watch hts-watch-warn" data-expanded="0">` +
        `<button type="button" class="hts-watch-toggle" aria-expanded="false" data-hts-watch-toggle>` +
          `<span class="hts-watch-chevron" aria-hidden="true">▸</span>` +
          `<span class="hts-watch-agency">Antidumping</span>` +
          `<span class="hts-watch-short">May apply — verify order</span>` +
        `</button>` +
        `<div class="hts-watch-detail" hidden>` +
          `<p>Confirm open antidumping orders for this HTS and exporter. Case rates are not calculated here.</p>` +
        `</div>` +
      `</div>`,
    );
  }
  if (flags.cvd) {
    rows.push(
      `<div class="hts-watch hts-watch-warn" data-expanded="0">` +
        `<button type="button" class="hts-watch-toggle" aria-expanded="false" data-hts-watch-toggle>` +
          `<span class="hts-watch-chevron" aria-hidden="true">▸</span>` +
          `<span class="hts-watch-agency">Countervailing</span>` +
          `<span class="hts-watch-short">May apply — verify order</span>` +
        `</button>` +
        `<div class="hts-watch-detail" hidden>` +
          `<p>Confirm open countervailing duty orders for this HTS and exporter. Case rates are not calculated here.</p>` +
        `</div>` +
      `</div>`,
    );
  }
  if (flags.add_hts) {
    rows.push(
      `<div class="hts-watch" data-expanded="0">` +
        `<button type="button" class="hts-watch-toggle" aria-expanded="false" data-hts-watch-toggle>` +
          `<span class="hts-watch-chevron" aria-hidden="true">▸</span>` +
          `<span class="hts-watch-agency">Additional HTS</span>` +
          `<span class="hts-watch-short">Reporting may be required</span>` +
        `</button>` +
        `<div class="hts-watch-detail" hidden>` +
          `<p>Classification table marks additional HTS reporting as required (beyond Chapter 99 layers in this stack).</p>` +
        `</div>` +
      `</div>`,
    );
  }
  return rows.join("");
}

/** Compact chips for Coverage table cells (not expandable). */
function renderHtsFlagChipsCompact(flags) {
  if (!flags) return "";
  const chips = [];
  for (const agency of groupPgaAgencies(flags)) {
    chips.push(`<span class="pill pill-flag" title="${esc(agency.detail)}">${esc(agency.name)}</span>`);
  }
  if (flags.add) chips.push(`<span class="pill pill-flag-warn" title="Antidumping may apply">AD</span>`);
  if (flags.cvd) chips.push(`<span class="pill pill-flag-warn" title="Countervailing may apply">CVD</span>`);
  if (flags.add_hts) chips.push(`<span class="pill pill-flag" title="Additional HTS reporting may be required">Add. HTS</span>`);
  return chips.join("");
}

function bindHtsWatchRows(root) {
  root?.querySelectorAll?.("[data-hts-watch-toggle]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const row = btn.closest(".hts-watch");
      if (!row) return;
      const on = row.dataset.expanded !== "1";
      row.dataset.expanded = on ? "1" : "0";
      btn.setAttribute("aria-expanded", on ? "true" : "false");
      const detail = row.querySelector(".hts-watch-detail");
      const chev = row.querySelector(".hts-watch-chevron");
      if (detail) detail.hidden = !on;
      if (chev) chev.textContent = on ? "▾" : "▸";
    });
  });
}

/** Soften the empty Stack card when HTS context is already visible above it. */
function syncStackEmptyHint() {
  const results = $("#results");
  const ctx = $("#hts-context");
  if (!results) return;
  const empty = results.querySelector(":scope > .empty");
  if (!empty) return;
  if (ctx && !ctx.hidden) {
    empty.innerHTML =
      `<h4>Ready to stack</h4>` +
      `<p class="cap" style="max-width:40ch;margin:0 auto">HTS notes are above. Add origin, value, and date — then <b>Run the stack</b> for duties and layer order.</p>`;
  } else {
    empty.innerHTML =
      `<h4>Stack is empty</h4>` +
      `<p class="cap" style="max-width:40ch;margin:0 auto">Drop in an HTS, origin, value, and rate date—` +
      ` then <b>Run the stack</b>. Rates, application order, and suppressions show here.</p>`;
  }
}

/** Primary HTS narrative + compliance — lives in Stack result where users look. */
function renderHtsContext(r, htsInput) {
  const ctx = $("#hts-context");
  if (!ctx) return;
  const display = r.hts_display || formatHtsDisplayClient(htsInput) || htsInput;
  const flagBits = renderHtsFlagPills(r.flags);
  const descHtml = renderHtsDescStack(r);
  const hasDesc = Boolean(descHtml);
  const hasFlags = Boolean(flagBits);
  // Only surface when there is something useful — never dump ACE codes or "nothing found" noise.
  if (!hasDesc && !hasFlags) {
    clearHtsContext();
    return;
  }
  ctx.hidden = false;
  ctx.innerHTML =
    `<div class="hts-context-head">` +
      `<div class="eyebrow">About this HTS</div>` +
      `<div class="hts-context-code mono">${esc(display)}</div>` +
    `</div>` +
    (hasFlags
      ? `<div class="hts-context-section">` +
          `<div class="hts-context-label">Watch for</div>` +
          `<div class="hts-notices">${flagBits}</div>` +
        `</div>`
      : "") +
    (hasDesc
      ? `<div class="hts-context-section">` +
          `<div class="hts-context-label">Description</div>` +
          descHtml +
        `</div>`
      : "");
  bindHtsDescStack(ctx);
  bindHtsWatchRows(ctx);
  syncStackEmptyHint();
}

function formatHtsDisplayClient(hts) {
  const d = String(hts || "").replace(/\D/g, "");
  if (d.length < 8) return String(hts || "");
  const ten = d.padEnd(10, "0").slice(0, 10);
  return `${ten.slice(0, 4)}.${ten.slice(4, 6)}.${ten.slice(6)}`;
}

/** Collapsible description: show readable summary; expand for full indent path. */
function renderHtsDescStack(r) {
  const path = Array.isArray(r.desc_path) && r.desc_path.length ? r.desc_path : null;
  const leaf = path ? path[path.length - 1] : (r.desc || "");
  if (!leaf && !path) return "";
  const full = r.desc_full || (path ? path.join(": ") : leaf);
  if (!path || path.length <= 1) {
    return `<div class="hts-desc-stack"><p class="hts-desc-summary">${esc(leaf)}</p></div>`;
  }
  const levels = path
    .map((seg, i) => {
      const label = i === 0 ? "Heading" : i === path.length - 1 ? "Line" : "Subheading";
      return (
        `<div class="hts-desc-level" style="--lvl:${i}" data-lvl="${i}">` +
          `<span class="hts-desc-lvl-label">${label}</span>` +
          `<span class="hts-desc-lvl-text">${esc(seg)}</span>` +
        `</div>`
      );
    })
    .join("");
  return (
    `<div class="hts-desc-stack" data-expanded="0">` +
    `<p class="hts-desc-summary" title="${esc(full)}">${esc(full)}</p>` +
    `<div class="hts-desc-toolbar">` +
    `<button type="button" class="btn-ghost btn-sm hts-desc-toggle" data-hts-desc-toggle>Show hierarchy</button>` +
    `</div>` +
    `<div class="hts-desc-levels" hidden>${levels}</div>` +
    `</div>`
  );
}

function bindHtsDescStack(root) {
  const stack = root?.querySelector?.(".hts-desc-stack");
  if (!stack) return;
  const toggle = stack.querySelector("[data-hts-desc-toggle]");
  const summary = stack.querySelector(".hts-desc-summary");
  const levels = stack.querySelector(".hts-desc-levels");
  if (!toggle || !levels) return;

  const setExpanded = (on) => {
    stack.dataset.expanded = on ? "1" : "0";
    levels.hidden = !on;
    if (summary) summary.hidden = on;
    toggle.textContent = on ? "Hide hierarchy" : "Show hierarchy";
    if (on) {
      levels.querySelectorAll(".hts-desc-level").forEach((n) => {
        n.hidden = false;
      });
    }
  };

  toggle.addEventListener("click", (e) => {
    e.preventDefault();
    setExpanded(stack.dataset.expanded !== "1");
  });

  levels.querySelectorAll(".hts-desc-level").forEach((node) => {
    node.addEventListener("click", (e) => {
      e.preventDefault();
      const lvl = Number(node.getAttribute("data-lvl") || 0);
      levels.querySelectorAll(".hts-desc-level").forEach((n) => {
        const nLvl = Number(n.getAttribute("data-lvl") || 0);
        n.hidden = nLvl > lvl;
      });
    });
  });
}

function formatQuickCol1(r) {
  const pct = Number(r.col1_pct);
  const shown = pct > 0 && pct < 1 ? pct * 100 : pct;
  const parts = [];
  if (shown > 0) parts.push(`${shown}%`);
  if (r.col1_specific_cents || r.col1_specific_usd) {
    const c = r.col1_specific_cents ?? Math.round(Number(r.col1_specific_usd) * 10000) / 100;
    parts.push(`${c}¢/${r.uom1 || "unit"}`);
  }
  return parts.length ? parts.join(" + ") : "Free";
}

function applyQuickToLines() {
  const hts = ($("#qc-hts").value || "").trim();
  const coo = countryIsoFrom($("#qc-coo"));
  const parsed = parseEnteredValue($("#qc-value").value);
  const value = Number.isFinite(parsed) && parsed > 0 ? String(parsed) : "";
  const date = $("#qc-date").value || new Date().toISOString().slice(0, 10);
  const quantity = ($("#qc-qty")?.value || "").trim();
  const metal_contents = readMetalContentsFromQuick();
  const flags = {};
  const cn = $("#qc-cnlist")?.value || "auto";
  if (cn === "list_1") flags.s301_list_1 = true;
  if (cn === "list_2") flags.s301_list_2 = true;
  if (cn === "list_3") flags.s301_list_3 = true;
  if (cn === "list_4a") flags.s301_list_4a = true;
  if ($("#qc-232")?.checked) flags.s232_auto_part = true;
  if ($("#qc-s232-mhdv")?.checked) flags.s232_mhdv_part = true;
  if ($("#qc-s232-mhdv-not")?.checked) flags.s232_mhdv_not_part = true;
  if ($("#qc-s232-semi")?.checked) flags.s232_semiconductor = true;
  if ($("#qc-s232-vintage")?.checked) flags.s232_vehicle_vintage = true;
  if ($("#qc-gn6")?.checked) flags.civil_aircraft_gn6 = true;
  if ($("#qc-s201-over")?.checked) flags.s201_qsp_over_quota = true;
  if ($("#qc-s232-uas-thermal")?.checked) flags.s232_uas_thermal = true;
  const ftaWrap = $("#qc-fta-wrap");
  const ftaClaimId = ftaWrap?.dataset?.claimId || "";
  if ($("#qc-fta")?.checked && ftaClaimId) {
    if (ftaClaimId === "USMCA") flags.fta_usmca = true;
    else if (ftaClaimId === "CAFTA_DR") flags.fta_cafta_dr = true;
    else flags.fta_note_52 = true;
  }
  if ($("#qc-pharma")?.checked) flags.s301fl_pharma = true;
  if ($("#qc-s232-pharma")?.checked) flags.s232_pharma_patented = true;
  S.engine = "auto";
  const radio = document.querySelector('input[name="engine"][value="auto"]');
  if (radio) radio.checked = true;
  syncEngineChrome();
  const qtyUom = ($("#qc-qty-uom")?.textContent || "").replace(/[()]/g, "").trim();
  // Backward-compat single fields from primary metal if only one present
  const kinds = Object.keys(metal_contents);
  const over = {
    hts, coo, entered_value: value, entry_date: date, release_date: date, flags,
    quantity: quantity || undefined,
    quantity_uom: quantity ? qtyUom : undefined,
    metal_contents: kinds.length ? metal_contents : undefined,
  };
  if (kinds.length === 1) {
    const k = kinds[0];
    const row = metal_contents[k];
    if (row.value != null) over.metal_content_value = String(row.value);
    if (row.pct != null) over.metal_content_pct = String(row.pct);
    if (row.melt_pour) over.country_of_melt_pour = row.melt_pour;
  }
  S.lines = [blankLine(over)];
  renderLines();
  const modeEl = $("#mode");
  const qcMode = $("#qc-mode")?.value || "OCEAN";
  if (modeEl) modeEl.value = qcMode;
}

async function runQuickCheck() {
  applyQuickToLines();
  const bad = [];
  if (!($("#qc-hts").value || "").trim()) bad.push("HTS");
  if (!countryIsoFrom($("#qc-coo"))) bad.push("origin (ISO-2 or country name)");
  const entered = parseEnteredValue($("#qc-value").value);
  if (!Number.isFinite(entered) || entered <= 0) bad.push("entered value");
  const qtyWrap = $("#qc-qty-wrap");
  if (qtyWrap && !qtyWrap.hidden && !($("#qc-qty")?.value || "").trim()) {
    bad.push("quantity (" + (($("#qc-qty-uom")?.textContent || "").replace(/[()]/g, "").trim() || "UOM") + ")");
  }
  const metalWrap = $("#qc-metal-wrap");
  const contents = readMetalContentsFromQuick();
  const withVal = Object.entries(contents).filter(([, r]) => r.value != null || r.pct != null);
  if (metalWrap?.dataset.required === "1") {
    if (!withVal.length) bad.push("at least one metal content (steel, aluminum, or copper)");
    for (const [k, r] of withVal) {
      if (!r.melt_pour) bad.push(`${k} melt/pour country`);
    }
  }
  if (bad.length) {
    banner("#calcbanner", "err", "Need a few fields", bad.join(", ") + " required for a quick check.");
    return;
  }
  await run("assess");
  previewHtsMeta();
}

const QC_EXAMPLES = Object.fromEntries(
  (goldens.examples || []).map((ex) => [ex.id, ex]),
);

async function loadQuickExample(id) {
  const ex = QC_EXAMPLES[id];
  if (!ex) return;
  $("#qc-hts").value = ex.hts;
  $("#qc-coo").value = ex.coo;
  $("#qc-value").value = ex.value;
  syncEnteredValueField($("#qc-value"), { defaultIfEmpty: true });
  $("#qc-date").value = ex.date;
  if ($("#qc-mode")) $("#qc-mode").value = ex.mode || "OCEAN";
  if ($("#mode")) $("#mode").value = $("#qc-mode")?.value || "OCEAN";
  if ($("#qc-cnlist")) $("#qc-cnlist").value = "auto";
  if ($("#qc-qty")) $("#qc-qty").value = "";
  $("#qc-232").checked = Boolean(ex.flags?.s232_auto_part);
  if ($("#qc-fta")) $("#qc-fta").checked = Boolean(ex.flags?.fta_usmca || ex.flags?.fta_note_52);
  if ($("#qc-s232-pharma")) $("#qc-s232-pharma").checked = Boolean(ex.flags?.s232_pharma_patented);
  if ($("#qc-pharma")) $("#qc-pharma").checked = Boolean(ex.flags?.s301fl_pharma);
  if ($("#qc-s232-mhdv")) $("#qc-s232-mhdv").checked = Boolean(ex.flags?.s232_mhdv_part);
  if ($("#qc-s232-mhdv-not")) $("#qc-s232-mhdv-not").checked = Boolean(ex.flags?.s232_mhdv_not_part);
  if ($("#qc-s232-semi")) $("#qc-s232-semi").checked = Boolean(ex.flags?.s232_semiconductor);
  if ($("#qc-s232-vintage")) $("#qc-s232-vintage").checked = Boolean(ex.flags?.s232_vehicle_vintage);
  await syncFtaClaimUi();
  await syncPharmaClaimUi();
  if (ex.flags?.s301fl_pharma && $("#qc-pharma")) $("#qc-pharma").checked = true;
  previewHtsMeta();
  await runQuickCheck();
}

const qcRun = $("#qc-run");
if (qcRun) qcRun.onclick = () => runQuickCheck();
document.querySelectorAll(".qc-example[data-example]").forEach((btn) => {
  btn.onclick = () => loadQuickExample(btn.dataset.example);
});
$("#qc-mode")?.addEventListener("change", () => {
  if ($("#mode")) $("#mode").value = $("#qc-mode").value;
});
$("#mode")?.addEventListener("change", () => {
  if ($("#qc-mode") && $("#mode").value) $("#qc-mode").value = $("#mode").value;
});

function guestQuotaHtml() {
  const q = S.me?.quota;
  if (!q || q.unlimited) return "";
  const left = q.stacks_remaining ?? Math.max(0, (q.stacks_limit || 0) - (q.stacks_used || 0));
  return `<p class="guest-quota">Guest: <b>${left}</b> of ${q.stacks_limit} stacks left today.
    Sign in for unlimited.</p>`;
}

function syncClaimEmptyState() {
  const empty = $("#qc-flags-empty");
  if (!empty) return;
  const flags = $("#qc-flags");
  if (!flags) return;
  const visible = [...flags.querySelectorAll(".check, #qc-cn-adv")].some((el) => !el.hidden);
  empty.hidden = visible;
}

function syncChina301AdvUi() {
  const wrap = $("#qc-cn-adv");
  if (!wrap) return;
  const coo = countryIsoFrom($("#qc-coo"));
  const show = coo === "CN" || coo === "HK";
  wrap.hidden = !show;
  if (!show && $("#qc-cnlist")) $("#qc-cnlist").value = "auto";
  syncClaimEmptyState();
}

/** 232 auto-part checkbox: only for off-list self-cert. Annex HTS auto-applies without a claim. */
function sync232AutoPartClaimUi(r) {
  const wrap = $("#qc-232-wrap");
  const box = $("#qc-232");
  const hint = $("#qc-232-hint");
  if (!wrap || !box) return;
  const annex = r?.s232_auto_parts;
  const hts = String(r?.hts || $("#qc-hts")?.value || "");
  const dig = hts.replace(/\D/g, "");
  const offListFamily = /^(8483|8708|8544)/.test(dig);
  if (annex?.in_annex) {
    wrap.hidden = true;
    box.checked = false;
    delete box.dataset.autoAnnex;
    if (hint) hint.textContent = "(annex — auto-applied)";
    syncClaimEmptyState();
    return;
  }
  const show = Boolean(r) && offListFamily && !annex?.in_annex;
  wrap.hidden = !show;
  if (!show) {
    box.checked = false;
    delete box.dataset.autoAnnex;
  }
  if (hint) hint.textContent = "(off-list self-cert 9903.94.07)";
  syncClaimEmptyState();
}

/** Show FTA / USMCA claim when origin has a Note 52 economy exemption. */
async function syncFtaClaimUi() {
  const wrap = $("#qc-fta-wrap");
  const label = $("#qc-fta-label");
  const box = $("#qc-fta");
  if (!wrap || !label || !box) {
    syncChina301AdvUi();
    return;
  }
  const coo = countryIsoFrom($("#qc-coo"));
  if (!coo) {
    wrap.hidden = true;
    wrap.dataset.claimId = "";
    box.checked = false;
    syncChina301AdvUi();
    return;
  }
  try {
    const r = await api(`/v1/reference/fta-claim/${encodeURIComponent(coo)}`);
    if (!r.available) {
      wrap.hidden = true;
      wrap.dataset.claimId = "";
      box.checked = false;
      syncChina301AdvUi();
      return;
    }
    wrap.hidden = false;
    wrap.dataset.claimId = r.claim_id || "";
    const spi = Boolean(r.zeros_col1_and_mpf);
    label.innerHTML = spi
      ? `Claim <b>${esc(r.label)}</b> <span class="cap">(Free Col-1 + MPF${
          r.heading ? `; ${esc(r.heading)} for 301-FL` : ""
        })</span>`
      : `Claim <b>${esc(r.label)}</b> <span class="cap">(301-FL only${
          r.heading ? ` — ${esc(r.heading)}` : ""
        }; Col-1 and MPF still apply)</span>`;
    wrap.title =
      r.hint ||
      `${r.label}: SPI preference zeros Column-1 and MPF. Other programs need their own ${r.label} Chapter 99 exception.`;
    syncChina301AdvUi();
  } catch {
    wrap.hidden = true;
    wrap.dataset.claimId = "";
    syncChina301AdvUi();
  }
}

/** Show Pharma use claim when HTS is on the seeded Note 52(e) list or Ch.29/30 (claim-gated). */
async function syncPharmaClaimUi() {
  const wrap = $("#qc-pharma-wrap");
  const label = $("#qc-pharma-label");
  const box = $("#qc-pharma");
  if (!wrap || !label || !box) return;
  const hts = ($("#qc-hts")?.value || "").trim();
  const digits = hts.replace(/\D/g, "");
  const ch = digits.length >= 2 ? Number(digits.slice(0, 2)) : 0;
  const userOn = Boolean(box.checked);
  if (!hts || digits.length < 6) {
    wrap.hidden = true;
    if (!userOn) box.checked = false;
    syncS232PharmaClaimUi();
    return;
  }
  try {
    const r = await api(`/v1/reference/fl-pharma/${encodeURIComponent(hts)}`);
    const chPharma = ch === 29 || ch === 30;
    if (!r.available && !chPharma && !userOn) {
      wrap.hidden = true;
      box.checked = false;
    } else {
      wrap.hidden = false;
      const heading = r.heading || "9903.05.89";
      label.innerHTML = r.available
        ? `Pharma use <span class="cap">(${esc(heading)} — 301-FL only; not the EU cap)</span>`
        : `Pharma use <span class="cap">(${esc(heading)} — 301-FL only; confirm Note 52(e) list)</span>`;
      wrap.title = r.hint
        || "Claim when actual use is pharmaceutical. Reports 9903.05.89 @ 0% instead of 301-FL EU combined-to-cap (9903.05.38/.39). Does not zero Column-1 or MPF. Do not check 232 patented pharma unless filing 9903.04.xx.";
    }
  } catch {
    if (!userOn) wrap.hidden = true;
  }
  syncS232PharmaClaimUi();
  syncClaimEmptyState();
}

/** Show Section 232 patented-pharma claim for Chapter 29/30 HTS (Proclamation 11020). */
function syncS232PharmaClaimUi() {
  const wrap = $("#qc-s232-pharma-wrap");
  const label = $("#qc-s232-pharma-label");
  const box = $("#qc-s232-pharma");
  if (!wrap || !label || !box) return;
  const hts = ($("#qc-hts")?.value || "").trim();
  const digits = hts.replace(/\D/g, "");
  const ch = digits.length >= 2 ? Number(digits.slice(0, 2)) : 0;
  if (ch !== 29 && ch !== 30) {
    wrap.hidden = true;
    box.checked = false;
    syncClaimEmptyState();
    return;
  }
  wrap.hidden = false;
  const coo = countryIsoFrom($("#qc-coo"));
  if (coo === "GB") {
    label.innerHTML =
      `232 patented pharma <span class="cap">(GB → 9903.04.63 @ 0% — CSMS #69415934)</span>`;
  } else {
    label.innerHTML =
      `232 patented pharma <span class="cap">(Proclamation 11020 / 9903.04.xx)</span>`;
  }
  wrap.title =
    "Claim when goods are patented pharmaceuticals / ingredients under U.S. note 40. UK additional duty is 0% from 2026-07-31. Suppresses 301-FL via 9903.05.90.";
  syncClaimEmptyState();
}

function syncS232ClaimUi(uni = {}) {
  const mhdvWrap = $("#qc-s232-mhdv-wrap");
  const mhdvBox = $("#qc-s232-mhdv");
  const mhdvLabel = $("#qc-s232-mhdv-label");
  const mhdvNotWrap = $("#qc-s232-mhdv-not-wrap");
  const mhdvNotBox = $("#qc-s232-mhdv-not");
  const mhdvNotLabel = $("#qc-s232-mhdv-not-label");
  const onMhdvParts = Boolean(uni.mhdv_part_list);
  // Dual-list (auto-parts annex + MHDV parts): .11 stacks automatically — hide
  // the exclusion checkbox so operators are not asked to re-assert a list fact.
  const dualList = onMhdvParts && Boolean(uni.auto_parts);
  if (mhdvWrap && mhdvBox) {
    const show = onMhdvParts;
    mhdvWrap.hidden = !show;
    if (!show) mhdvBox.checked = false;
    if (mhdvLabel && uni.mhdv_part_list) {
      mhdvLabel.innerHTML = `232 MHDV part <span class="cap">(list stem ${esc(uni.mhdv_part_list.matched_stem)} → 9903.74.08 @ 25%)</span>`;
    }
    mhdvWrap.title =
      "Claim when the article is a part of a medium- or heavy-duty vehicle. Leave unchecked (or use Not an MHDV part) when the HTS is on the MHDV parts list but the article is not an MHDV part — then 9903.74.11 @ 0%.";
  }
  if (mhdvNotWrap && mhdvNotBox) {
    // Show exclusion only for MHDV-parts-list-only HTS (not dual-list auto-stack).
    const show = onMhdvParts && !dualList;
    mhdvNotWrap.hidden = !show;
    if (!show) mhdvNotBox.checked = false;
    if (mhdvNotLabel && uni.mhdv_part_list) {
      mhdvNotLabel.innerHTML =
        `Not an MHDV part <span class="cap">(list stem ${esc(uni.mhdv_part_list.matched_stem)} → 9903.74.11 @ 0%)</span>`;
    }
    mhdvNotWrap.title =
      "On the MHDV parts list but the article is not a part of a medium- or heavy-duty vehicle. Reports 9903.74.11 @ 0%. Mutually exclusive with 232 MHDV part.";
  }
  if (mhdvBox && mhdvNotBox) {
    mhdvBox.onchange = () => {
      if (mhdvBox.checked) mhdvNotBox.checked = false;
    };
    mhdvNotBox.onchange = () => {
      if (mhdvNotBox.checked) mhdvBox.checked = false;
    };
  }
  const semiWrap = $("#qc-s232-semi-wrap");
  const semiBox = $("#qc-s232-semi");
  if (semiWrap && semiBox) {
    const show = Boolean(uni.semiconductor);
    semiWrap.hidden = !show;
    if (!show) semiBox.checked = false;
    semiWrap.title = "Claim only if the article is a logic IC (or contains one) meeting U.S. note 39(b) TPP and DRAM bandwidth bands. HTS 8471.50 / 8471.80 / 8473.30 alone is not enough.";
  }
  const vinWrap = $("#qc-s232-vintage-wrap");
  const vinBox = $("#qc-s232-vintage");
  if (vinWrap && vinBox) {
    const show = Boolean(uni.passenger_vehicle || uni.mhdv_vehicle || uni.mhdv_bus);
    vinWrap.hidden = !show;
    if (!show) vinBox.checked = false;
  }
  const thermWrap = $("#qc-s232-uas-thermal-wrap");
  const thermBox = $("#qc-s232-uas-thermal");
  if (thermWrap && thermBox) {
    const show = Boolean(uni.uas?.annex_ii);
    thermWrap.hidden = !show;
    if (!show) thermBox.checked = false;
    thermWrap.title =
      "Small-UAS HTS (8806.21–.23 / .91–.93) defaults to 9903.08.22 @ 25%. Tick if the aircraft integrates a thermal imager — then 9903.08.21 @ 100% (note 43(c)(3)).";
  }
  syncClaimEmptyState();
}

function syncS201ClaimUi(s201 = {}) {
  const wrap = $("#qc-s201-over-wrap");
  const box = $("#qc-s201-over");
  if (!wrap || !box) return;
  const show = Boolean(s201.covered);
  wrap.hidden = !show;
  if (!show) box.checked = false;
  wrap.title =
    "Section 201 QSP defaults to in-quota 9903.45.30. Tick this when the quarterly TRQ is exhausted so the stack uses 9903.45.31.";
  syncClaimEmptyState();
}

function syncS338ClaimUi(s338 = {}) {
  const wrap = $("#qc-gn6-wrap");
  const box = $("#qc-gn6");
  if (!wrap || !box) return;
  const show = Boolean(s338.aircraft);
  wrap.hidden = !show;
  if (!show) box.checked = false;
  wrap.title =
    "Claim when the article is civil aircraft (not military/unmanned) meeting General Note 6. Reports 9903.03.16 @ 0% additional (CSMS #69668138). Default is off — dual-list HTS then takes the 50% 338 duty heading.";
  syncClaimEmptyState();
}

/* ================================================================ CALCULATOR */
function blankLine(over = {}) {
  const today = new Date().toISOString().slice(0, 10);
  return Object.assign({
    _id: ++S.seq, _open: false, line_id: "", hts: "", coo: "", entered_value: "",
    col1_rate_pct: "", entry_date: today, release_date: today, it_date: "", loaded_date: "",
    warehouse_withdrawal_date: "", entry_type: "CONSUMPTION",     metal_content_value: "", metal_content_pct: "", metal_contents: null,
    country_of_melt_pour: "", ch98_provision: "", ch98_us_content_value: "", ch98_repair_value: "",
    quantity: "", quantity_uom: "", net_weight_kg: "", filed_ch99: "",
    filed_duty_total: "", flags: {},
  }, over);
}
const addLine = (over = {}) => { S.lines.push(blankLine(over)); renderLines(); };

function renderLines() {
  const tb = $("#linebody");
  tb.innerHTML = "";
  S.lines.forEach((L, i) => {
    const n = Object.values(L.flags).filter(Boolean).length;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><button class="disclose" data-act="toggle" data-i="${i}"
            aria-expanded="${L._open}" title="More fields">${L._open ? "&minus;" : "+"}</button></td>
      <td><input type="text" class="mono" data-f="hts" data-i="${i}" value="${esc(L.hts)}"
            spellcheck="false" title="10-digit HTS" /></td>
      <td><input type="text" class="country-field" data-country data-f="coo" data-i="${i}"
            value="${esc(L.coo && L.coo.length === 2 ? formatCountry(L.coo) : L.coo)}"
            title="Origin — ISO-2 or country name" /></td>
      <td><input type="text" class="num" data-f="entered_value" data-i="${i}"
            value="${esc(L.entered_value)}" inputmode="decimal" title="Entered value (USD)" /></td>
      <td><input type="text" class="num" data-f="col1_rate_pct" data-i="${i}"
            value="${esc(L.col1_rate_pct)}" inputmode="decimal" title="Column-1 % if overriding HTS table" /></td>
      <td><input type="date" data-f="entry_date" data-i="${i}" value="${esc(L.entry_date)}" /></td>
      <td><span class="claimcount ${n ? "" : "none"}">${n ? n + " set" : "none"}</span></td>
      <td><button class="btn-danger" data-act="del" data-i="${i}"
            aria-label="Remove line ${i + 1}">&times;</button></td>`;
    tb.appendChild(tr);
    if (L._open) tb.appendChild(lineDetail(L, i));
  });
  $("#linecount").textContent = S.lines.length === 1 ? "1 line" : S.lines.length + " lines";
  $("#assess").disabled = !S.lines.length;
  const runBoth = $("#runboth");
  if (runBoth) runBoth.disabled = !S.lines.length;
  syncEngineChrome();
  initCountryFields(tb);
}

function lineDetail(L, i) {
  const tr = document.createElement("tr");
  tr.className = "detail";
  const td = document.createElement("td");
  td.colSpan = 8;
  const groups = {
    annex_membership: "Annex membership — set from the USTR or 232 annex",
    fta: "Trade-agreement qualification",
    exclusion: "Granted exclusions",
    claim: "Importer claims",
  };
  let claims = "";
  for (const [kind, title] of Object.entries(groups)) {
    const items = S.flags.filter(f => f.kind === kind);
    if (!items.length) continue;
    claims += `<fieldset class="claims"><legend>${esc(title)}</legend><div class="claimgrid">` +
      items.map(f => `<label class="check" title="${esc((f.headings || []).join(", "))}">
        <input type="checkbox" data-flag="${esc(f.flag)}" data-i="${i}"
          ${L.flags[f.flag] ? "checked" : ""} />
        <span>${esc(f.label)}<br><span class="flagname">${esc(f.flag)}</span></span></label>`).join("") +
      `</div></fieldset>`;
  }
  const fld = (lab, f, extra = "", cls = "", tip = "") =>
    `<div class="field"><label class="label">${lab}</label>
      <input type="${extra.includes("date") ? "date" : "text"}" class="${cls}"
        data-f="${f}" data-i="${i}" value="${esc(L[f])}"
        ${tip ? `title="${esc(tip)}"` : ""} ${extra.replace("date", "")} /></div>`;
  td.innerHTML = `
    <div class="grid4">
      ${fld("Line reference", "line_id", "", "", "Optional line id; blank uses sequence")}
      <div class="field"><label class="label">Entry type</label>
        <select data-f="entry_type" data-i="${i}">${
          ["CONSUMPTION", "IT", "WAREHOUSE", "OVERCARRIED", "FTZ"].map(v =>
            `<option value="${v}" ${L.entry_type === v ? "selected" : ""}>${v}</option>`).join("")
        }</select></div>
      ${fld("Release date", "release_date", "date")}
      ${fld("IT date", "it_date", "date")}
      ${fld("Warehouse withdrawal", "warehouse_withdrawal_date", "date")}
      ${fld("Loaded on final mode", "loaded_date", "date")}
      ${fld("Metal content USD", "metal_content_value", 'inputmode="decimal"', "num", "Dollar value of metal content (or use % field)")}
      ${fld("Metal content % of entered", "metal_content_pct", 'inputmode="decimal"', "num", "Percent of entered value that is metal content")}
      ${fld("Country of melt &amp; pour", "country_of_melt_pour", "data-country", "country-field", "Primary melt/pour ISO-2 or name")}
      ${fld("Chapter 98 provision", "ch98_provision", "", "mono", "e.g. 9802.00.50 — reports first; may change dutiable basis or suppress 301/FL")}
      ${fld("US content value", "ch98_us_content_value", 'inputmode="decimal"', "num", "For 9802.00.80 — US-content cost/value (duty on entered − US content)")}
      ${fld("Repair / processing value", "ch98_repair_value", 'inputmode="decimal"', "num", "For 9802.00.40 / .50 / .60 — 301/232/Col-1 on this value (9802.00.60 + 232 uses full entered value)")}
      ${fld("Net weight (kg)", "net_weight_kg", 'inputmode="decimal"', "num")}
      ${fld("Quantity", "quantity", 'inputmode="decimal"', "num", "HTS quantity when Column 1 is specific")}
    </div>
    <p class="cap" style="margin:var(--sp-2) 0">Mixed metals: set steel / aluminum / copper content on Quick Check, or pass <span class="mono">metal_contents</span> in paste/API. Advanced single melt/pour is the fallback primary.</p>
    <div class="grid2">
      <div class="field"><label class="label">Chapter 99 codes as filed</label>
        <input type="text" class="mono" data-f="filed_ch99" data-i="${i}"
          value="${esc(L.filed_ch99)}" title="Space or comma separated Chapter 99 codes as filed" />
        <span class="cap">Space or comma separated. Enables <b>Audit as filed</b>.</span></div>
      ${fld("Duty as filed", "filed_duty_total", 'inputmode="decimal"', "num")}
    </div>
    ${claims || '<p class="cap">No claim flags in the current rule pack.</p>'}`;
  tr.appendChild(td);
  initCountryFields(tr);
  return tr;
}

$("#linebody").addEventListener("input", e => {
  const t = e.target, i = t.dataset.i;
  if (i === undefined) return;
  if (t.dataset.f) {
    let v = t.value;
    if (["coo", "country_of_melt_pour"].includes(t.dataset.f)) {
      v = countryIsoFrom(t) || resolveCountryIso(v) || v.toUpperCase();
      if (countryIsoFrom(t) || resolveCountryIso(t.value)) {
        // keep formatted display; store ISO on line
        S.lines[i][t.dataset.f] = countryIsoFrom(t) || resolveCountryIso(t.value);
        return;
      }
    }
    S.lines[i][t.dataset.f] = v;
    if (v !== t.value) t.value = v;
  } else if (t.dataset.flag) {
    S.lines[i].flags[t.dataset.flag] = t.checked;
    const n = Object.values(S.lines[i].flags).filter(Boolean).length;
    const cell = $(`.disclose[data-i="${i}"]`)?.closest("tr")?.querySelector(".claimcount");
    if (cell) { cell.textContent = n ? n + " set" : "none"; cell.classList.toggle("none", !n); }
  }
});
$("#linebody").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  const i = Number(b.dataset.i);
  if (b.dataset.act === "toggle") { S.lines[i]._open = !S.lines[i]._open; renderLines(); }
  if (b.dataset.act === "del") { S.lines.splice(i, 1); renderLines(); }
});

$("#addline").onclick = () => addLine();
$("#clearall").onclick = () => {
  S.lines = []; addLine();
  $("#results").innerHTML = '<div class="empty"><h4>Cleared</h4></div>';
  $("#exportcsv").hidden = $("#copyall").hidden = true;
  banner("#calcbanner", null);
};
$("#togglepaste").onclick = () => {
  const w = $("#pastewrap"); w.hidden = !w.hidden;
  if (!w.hidden) $("#pastebox").focus();
};
$("#loadsample").onclick = () => {
  S.lines = [];
  [
    { line_id: "1", hts: "8708.29.5160", coo: "CN", entered_value: "10000", col1_rate_pct: "2.5",
      entry_date: "2026-07-25", release_date: "2026-07-25",
      flags: { s301_list_3: true, s232_auto_part: true },
      filed_ch99: "9903.88.03 9903.94.05 9903.05.90" },
    { line_id: "2", hts: "8708.29.5160", coo: "JP", entered_value: "10000", col1_rate_pct: "2.5",
      entry_date: "2026-07-25", release_date: "2026-07-25",
      flags: { s232_auto_part: true },
      filed_ch99: "9903.94.43 9903.05.90" },
    { line_id: "3", hts: "8708.29.5160", coo: "JP", entered_value: "10000", col1_rate_pct: "2.5",
      entry_date: "2026-07-25", release_date: "2026-07-25",
      flags: {},
      filed_ch99: "9903.05.49" },
    { line_id: "4", hts: "7326.90.8688", coo: "DE", entered_value: "10000", col1_rate_pct: "2.9",
      entry_date: "2026-07-25", release_date: "2026-07-25", metal_content_value: "4000",
      country_of_melt_pour: "DE" },
  ].forEach(o => S.lines.push(blankLine(o)));
  $("#mode").value = "OCEAN";
  renderLines();
};

const LINE_COLS = ["line_id", "hts", "coo", "entered_value", "col1_rate_pct", "entry_date",
  "release_date", "it_date", "loaded_date", "warehouse_withdrawal_date", "metal_content_value",
  "metal_content_pct", "country_of_melt_pour", "ch98_provision", "ch98_us_content_value", "ch98_repair_value", "net_weight_kg",
  "quantity", "filed_ch99", "filed_duty_total", "flags"];

$("#doparse").onclick = () => {
  const raw = $("#pastebox").value.trim();
  if (!raw) return;
  const rows = raw.split(/\r?\n/).filter(r => r.trim());
  const split = r => r.includes("\t") ? r.split("\t") : r.split(",");
  let header = null;
  const first = split(rows[0]).map(c => c.trim().toLowerCase());
  if (first.some(c => LINE_COLS.includes(c))) { header = first; rows.shift(); }
  let added = 0, skipped = 0;
  rows.forEach(r => {
    const cells = split(r).map(c => c.trim());
    const o = {};
    if (header) header.forEach((h, i) => { if (LINE_COLS.includes(h)) o[h] = cells[i] ?? ""; });
    else ["hts", "coo", "entered_value", "col1_rate_pct", "entry_date", "flags"]
      .forEach((h, i) => o[h] = cells[i] ?? "");
    if (!o.hts || !o.coo) { skipped++; return; }
    const fl = o.flags || ""; delete o.flags; o.flags = {};
    fl.split(/[;\s,]+/).filter(Boolean).forEach(f => o.flags[f] = true);
    o.coo = o.coo.toUpperCase();
    if (!o.entry_date) o.entry_date = new Date().toISOString().slice(0, 10);
    if (!o.release_date) o.release_date = o.entry_date;
    S.lines.push(blankLine(o)); added++;
  });
  renderLines();
  $("#pastebox").value = ""; $("#pastewrap").hidden = true;
  banner("#calcbanner", skipped ? "warn" : "ok",
    `${added} row${added === 1 ? "" : "s"} added`,
    skipped ? `${skipped} skipped for missing an HTS or origin.` : "");
};

function payload() {
  const num = v => (v === "" || v == null) ? null : String(v).replace(/[$,\s]/g, "");
  const lines = S.lines.map((L, i) => {
    const o = {
      line_id: L.line_id || String(i + 1), hts: L.hts.trim(),
      coo: (resolveCountryIso(L.coo) || String(L.coo || "").trim().toUpperCase().slice(0, 2)),
      entered_value: num(L.entered_value) ?? "0",
      entry_type: L.entry_type || "CONSUMPTION",
      flags: Object.fromEntries(Object.entries(L.flags).filter(([, v]) => v)),
    };
    ["col1_rate_pct", "metal_content_value", "metal_content_pct", "ch98_us_content_value", "ch98_repair_value", "net_weight_kg",
     "quantity", "filed_duty_total"].forEach(k => {
      const v = num(L[k]); if (v) o[k] = v;
    });
    if (L.metal_contents && typeof L.metal_contents === "object") o.metal_contents = L.metal_contents;
    if ((L.quantity_uom || "").trim()) o.quantity_uom = L.quantity_uom.trim();
    ["entry_date", "release_date", "it_date", "loaded_date", "warehouse_withdrawal_date"]
      .forEach(k => { if (L[k]) o[k] = L[k]; });
    const melt = resolveCountryIso(L.country_of_melt_pour) || String(L.country_of_melt_pour || "").trim().toUpperCase().slice(0, 2);
    if (melt) o.country_of_melt_pour = melt;
    if ((L.ch98_provision || "").trim()) o.ch98_provision = L.ch98_provision.trim();
    if ((L.entry_type || "").toUpperCase() === "FTZ") o.ftz = true;
    const filed = (L.filed_ch99 || "").split(/[;\s,]+/).filter(Boolean);
    if (filed.length) o.filed_ch99 = filed;
    return o;
  });
  const body = { lines, formal_entry: $("#formal").value === "1",
                 mode_of_transport: $("#mode").value || null,
                 engine: S.engine };
  if ($("#entryno").value.trim()) body.entry_number = $("#entryno").value.trim();
  if ($("#knowledge").value) body.knowledge_date = $("#knowledge").value + "T00:00:00Z";
  return body;
}

function validateLines() {
  const bad = [];
  S.lines.forEach((L, i) => {
    const n = L.line_id || (i + 1);
    if (!L.hts.trim()) bad.push(`Line ${n}: no HTS`);
    if (!L.coo.trim()) bad.push(`Line ${n}: no origin`);
    if (!String(L.entered_value).trim()) bad.push(`Line ${n}: no entered value`);
    if (!L.entry_date && !L.release_date && !L.it_date && !L.warehouse_withdrawal_date)
      bad.push(`Line ${n}: needs a date — the rate-determination date selects the rules`);
  });
  return bad;
}

function focusResultsPane() {
  const el = $(".calc-result") || $("#results");
  if (!el) return;
  // On phone / installed PWA the result sits under the form — bring it into view.
  const narrow = window.matchMedia("(max-width:1100px), (display-mode: standalone)").matches;
  if (narrow) el.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function run(mode) {
  const bad = validateLines();
  if (bad.length) { banner("#calcbanner", "err", "Fix these first", bad.join(" · ")); return; }
  if (mode === "audit" && S.engine === "ch99") {
    banner("#calcbanner", "err", "Switch rule set",
      "Audit as filed uses the Auto stack. Select Auto, then try again.");
    return;
  }
  banner("#calcbanner", null);
  const btn = mode === "audit" ? $("#auditbtn") : $("#assess");
  const was = btn.textContent;
  btn.disabled = true; btn.innerHTML = '<span class="busy"></span>';
  try {
    const path = mode === "audit" ? "/v1/entries:audit" : "/v1/entries:assess";
    S.last = await api(path, { method: "POST", body: JSON.stringify(payload()) });
    S.last._mode = mode;
    S.last._engine = mode === "audit" ? "auto" : S.engine;
    renderResults(S.last);
    focusResultsPane();
    const blocked = (S.last.lines || []).filter(l => l.blocked ||
      (l.diagnostics || []).some(d => d.severity === "ERROR" && (d.code === "UNKNOWN_HTS" || d.code === "MISSING_COL1")));
    if (blocked.length) {
      const first = blocked[0];
      const err = (first.diagnostics || []).find(d => d.severity === "ERROR") || {};
      banner("#calcbanner", "err", "No duty rate",
        err.message || "One or more HTS codes are not in the baseline table. Fix the HTS (or use a mapped replacement) before stacking.");
    }
    updateScenarioActions();
    void refreshMeQuota();
  } catch (e) {
    const msg = String(e.message || e);
    const unreachable =
      e.status === 502 || e.status === 503 || e.status === 504 ||
      /ECONNREFUSED|Failed to fetch|NetworkError|502|503|504/i.test(msg) ||
      (e.status === 500 && /Internal Server Error/i.test(msg) && !e.payload?.detail);
    banner(
      "#calcbanner",
      "err",
      mode === "audit" ? "Audit failed" : "Assessment failed",
      unreachable
        ? "Engine is unreachable — restart backend (cd backend && npm run dev), then retry. " + msg
        : msg,
    );
    if (e.status === 429) void refreshMeQuota();
  } finally { btn.disabled = false; btn.textContent = was; renderLines(); syncEngineChrome(); }
}
$("#assess").onclick = () => run("assess");
$("#auditbtn").onclick = () => run("audit");

function engineLabel(id) {
  return ENGINE_TITLE[id] || id || "—";
}

function scenarioStamp(R) {
  const duty = money(R.totals?.duty);
  const n = (R.lines || []).length;
  const eng = engineLabel(R._engine);
  const mode = R._mode === "audit" ? "audit" : "assess";
  return `${eng} · ${mode} · ${n} line${n === 1 ? "" : "s"} · $${duty}`;
}

function saveScenario(slot) {
  if (!S.last) return;
  S.scenarios[slot] = {
    at: new Date().toISOString(),
    engine: S.last._engine || S.engine,
    mode: S.last._mode || "assess",
    result: structuredClone(S.last),
  };
  renderScenarioSlots();
  banner("#calcbanner", "ok", `Pinned to ${slot}`, scenarioStamp(S.last));
}

function showScenario(slot) {
  const sc = S.scenarios[slot];
  if (!sc) return;
  S.last = structuredClone(sc.result);
  S.last._engine = sc.engine;
  S.last._mode = sc.mode;
  renderResults(S.last);
  updateScenarioActions();
  banner("#calcbanner", null);
}

function renderScenarioSlots() {
  ["A", "B"].forEach(slot => {
    const sc = S.scenarios[slot];
    const el = document.querySelector(`.scenario-slot[data-slot="${slot}"]`);
    const label = $(`#slot${slot}-label`);
    const meta = $(`#slot${slot}-meta`);
    const showBtn = $(`#show${slot}`);
    if (!label) return;
    if (!sc) {
      label.textContent = "Empty";
      meta.textContent = slot === "A"
        ? "Save an assessment to pin it here."
        : "Save another run (or a second engine) here.";
      el?.classList.remove("filled");
      if (showBtn) showBtn.disabled = true;
    } else {
      label.textContent = engineLabel(sc.engine);
      const when = sc.at ? new Date(sc.at).toLocaleString() : "";
      meta.textContent = `${scenarioStamp(sc.result)}${when ? " · " + when : ""}`;
      el?.classList.add("filled");
      if (showBtn) showBtn.disabled = false;
    }
  });
  const both = S.scenarios.A && S.scenarios.B;
  $("#compareAB").disabled = !both;
  updateScenarioActions();
}

function updateScenarioActions() {
  const has = !!S.last;
  $("#saveA").disabled = !has;
  $("#saveB").disabled = !has;
}

function deltaClass(n) {
  if (!Number.isFinite(n) || Math.abs(n) < 0.005) return "flat";
  return n > 0 ? "up" : "down";
}

function deltaFmt(n) {
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) < 0.005) return "$0.00";
  const sign = n > 0 ? "+" : "−";
  return `${sign}$${money(Math.abs(n))}`;
}

function renderCompare() {
  const A = S.scenarios.A?.result;
  const B = S.scenarios.B?.result;
  if (!A || !B) return;
  $("#resulttitle").textContent = "Scenario compare";
  $("#exportcsv").hidden = $("#copyall").hidden = true;
  const engChip = $("#resultengine");
  engChip.hidden = false;
  engChip.textContent = `${engineLabel(S.scenarios.A.engine)} ↔ ${engineLabel(S.scenarios.B.engine)}`;

  const dutyA = Number(A.totals?.duty) || 0;
  const dutyB = Number(B.totals?.duty) || 0;
  const dDuty = dutyB - dutyA;
  const mapA = Object.fromEntries((A.lines || []).map(L => [String(L.line_id), L]));
  const mapB = Object.fromEntries((B.lines || []).map(L => [String(L.line_id), L]));
  const ids = [...new Set([...Object.keys(mapA), ...Object.keys(mapB)])];

  let rows = ids.map(id => {
    const La = mapA[id], Lb = mapB[id];
    const da = Number(La?.totals?.duty) || 0;
    const db = Number(Lb?.totals?.duty) || 0;
    const dd = db - da;
    const seqA = (La?.ch99_sequence || []).join(" → ") || "—";
    const seqB = (Lb?.ch99_sequence || []).join(" → ") || "—";
    const changed = Math.abs(dd) >= 0.005 || seqA !== seqB;
    return `<tr class="${changed ? "diff" : ""}">
      <td class="mono">${esc(id)}</td>
      <td><span class="hts">${esc(La?.hts || Lb?.hts || "")}</span>
        <span class="coo">${esc(La?.coo || Lb?.coo || "")}</span></td>
      <td class="r mono">$${money(da)}</td>
      <td class="r mono">$${money(db)}</td>
      <td class="r"><span class="compare-delta ${deltaClass(dd)}">${deltaFmt(dd)}</span></td>
      <td><div class="seq">A: ${esc(seqA)}</div>
        <div class="seq">B: ${esc(seqB)}</div></td>
    </tr>`;
  }).join("");

  $("#results").innerHTML = `<div class="compare-wrap">
    <div class="summary">
      <div class="stat"><div class="k">Duty A</div><div class="v">$${money(dutyA)}</div>
        <div class="cap">${esc(engineLabel(S.scenarios.A.engine))}</div></div>
      <div class="stat"><div class="k">Duty B</div><div class="v">$${money(dutyB)}</div>
        <div class="cap">${esc(engineLabel(S.scenarios.B.engine))}</div></div>
      <div class="stat"><div class="k">Δ (B − A)</div>
        <div class="v compare-delta ${deltaClass(dDuty)}">${deltaFmt(dDuty)}</div></div>
      <div class="stat"><div class="k">Lines</div><div class="v">${ids.length}</div></div>
    </div>
    <p class="cap" style="margin:var(--sp-3) 0 0">Yellow rows differ in duty or Chapter&nbsp;99
      sequence. Use <b>Show</b> on a slot to open its full ledger.</p>
    <table class="compare"><thead><tr>
      <th>Line</th><th>HTS / COO</th><th class="r">Duty A</th><th class="r">Duty B</th>
      <th class="r">Δ</th><th>Ch99 sequence</th>
    </tr></thead><tbody>${rows || `<tr><td colspan="6" class="cap">No lines.</td></tr>`}</tbody></table>
  </div>`;
}

async function runBothEngines() {
  const bad = validateLines();
  if (bad.length) { banner("#calcbanner", "err", "Fix these first", bad.join(" · ")); return; }
  banner("#calcbanner", null);
  const btn = $("#runboth");
  const was = btn.textContent;
  btn.disabled = true; btn.innerHTML = '<span class="busy"></span> both engines';
  try {
    const base = payload();
    const [autoR, ch99R] = await Promise.all([
      api("/v1/entries:assess", { method: "POST", body: JSON.stringify({ ...base, engine: "auto" }) }),
      api("/v1/entries:assess", { method: "POST", body: JSON.stringify({ ...base, engine: "ch99" }) }),
    ]);
    autoR._mode = "assess"; autoR._engine = "auto";
    ch99R._mode = "assess"; ch99R._engine = "ch99";
    S.scenarios.A = { at: new Date().toISOString(), engine: "auto", mode: "assess", result: autoR };
    S.scenarios.B = { at: new Date().toISOString(), engine: "ch99", mode: "assess", result: ch99R };
    S.last = structuredClone(ch99R);
    renderScenarioSlots();
    renderCompare();
    banner("#calcbanner", "ok", "Both engines assessed",
      `Auto $${money(autoR.totals?.duty)} · Ch99 $${money(ch99R.totals?.duty)} · Δ ${deltaFmt((Number(ch99R.totals?.duty) || 0) - (Number(autoR.totals?.duty) || 0))}`);
  } catch (e) {
    banner("#calcbanner", "err", "Dual assess failed", e.message);
  } finally {
    btn.disabled = false; btn.textContent = was;
  }
}

$("#saveA").onclick = () => saveScenario("A");
$("#saveB").onclick = () => saveScenario("B");
$("#showA").onclick = () => showScenario("A");
$("#showB").onclick = () => showScenario("B");
$("#compareAB").onclick = () => {
  if (!S.scenarios.A || !S.scenarios.B) return;
  renderCompare();
};
$("#clearscenarios").onclick = () => {
  S.scenarios = { A: null, B: null };
  renderScenarioSlots();
  banner("#calcbanner", null);
};
$("#runboth").onclick = () => runBothEngines();

function renderResults(R) {
  const audit = R._mode === "audit";
  $("#resulttitle").textContent = audit ? "Audit against filed" : "Results";
  $("#exportcsv").hidden = $("#copyall").hidden = false;
  const engChip = $("#resultengine");
  if (engChip) {
    engChip.hidden = false;
    engChip.textContent = engineLabel(R._engine || S.engine);
  }
  const lines = R.lines || [];
  const count = sev => lines.reduce((a, l) =>
    a + (l.diagnostics || []).filter(d => d.severity === sev).length, 0);
  const nErr = count("ERROR"), nWarn = count("WARNING"), nInfo = count("INFO");
  const landed = R.totals?.landed_cost ?? ((Number(R.totals?.entered_value)||0) + (Number(R.totals?.duty)||0) + (Number(R.totals?.fees)||0));
  const rateTxt = nErr || R.totals?.effective_duty_rate_pct == null
    ? "—"
    : `${pct(R.totals?.effective_duty_rate_pct)}%`;
  const dutyTxt = nErr ? "—" : `$${money(R.totals?.duty)}`;

  let html = `<div class="body" style="padding:var(--sp-4) var(--sp-4) 0">
    ${guestQuotaHtml()}
    <div class="result-hero">
      <div class="stat duty-rate${nErr ? " bad" : ""}">
        <div class="k">Duty rate</div>
        <div class="v">${rateTxt}</div>
        <div class="foot">Total duties <b>${dutyTxt}</b></div>
      </div>
      <div class="cost-break">
        <div class="eyebrow">Cost breakdown</div>
        <div class="cost-row"><span>Entered value</span><span>$${money(R.totals?.entered_value)}</span></div>
        <div class="cost-row"><span>Total duties</span><span>${dutyTxt}</span></div>`;

  if (R.entry_fees?.length && !nErr) {
    html += R.entry_fees.map(f =>
      `<div class="cost-row"><span>${esc(f.label)}${f.floored ? " (floor)" : f.capped ? " (cap)" : ""}${
        f.code === "HMF" && f.rate_note ? ` <span class="cap">${esc(f.rate_note)}</span>` : ""
      }</span><span>$${money(f.amount)}</span></div>`
    ).join("");
  } else {
    html += `<div class="cost-row"><span>Fees</span><span>$${money(R.totals?.fees ?? 0)}</span></div>`;
  }

  html += `<div class="cost-row total"><span>Landed cost</span><span>${
    nErr ? "—" : `$${money(landed)}`
  }</span></div>
      </div>
    </div>
    <p class="cap" style="margin:0 0 var(--sp-2)">${
      nErr ? `<b style="color:var(--color-red-700)">${nErr} error${nErr > 1 ? "s" : ""}</b> — the duty is wrong or indeterminate until resolved. `
           : `<b style="color:var(--color-green-700)">No errors.</b> `}${
      nWarn ? `${nWarn} warning${nWarn > 1 ? "s" : ""} worth a look` : "No warnings"}${
      nInfo ? `, ${nInfo} note${nInfo > 1 ? "s" : ""}` : ""}.</p>
  </div>
  <div class="stack-section-label">Layer stack · reporting order</div>`;

  if (audit) {
    const F = R.findings || [];
    html += `<div style="margin-top:var(--sp-2);border-top:1px solid var(--color-blue-gray-200)">
      <div style="padding:var(--sp-3) var(--sp-4) var(--sp-2)"><span class="eyebrow">Findings</span>
      <span class="cap"> — net duty impact $${money(R.summary?.net_duty_impact ?? 0)}</span></div>`;
    html += F.length ? F.map(f => `<div class="finding ${esc(f.severity)}">
        <div class="hd"><span class="cat">${esc(f.category)}</span>
        <span class="cap">line ${esc(f.line_id)}</span>
        ${Number(f.duty_impact) ? `<span class="impact">$${money(f.duty_impact)}</span>` : ""}</div>
        <div>${esc(f.message)}</div>
        ${f.remediation ? `<div class="why"><b>Do this:</b> ${esc(f.remediation)}</div>` : ""}
      </div>`).join("")
      : `<div class="empty" style="padding:var(--sp-4)">
          <b style="color:var(--color-green-700)">No findings.</b>
          <p class="cap" style="margin:var(--sp-1) 0 0">Every required Chapter 99 code was filed and
          none was over-applied.</p></div>`;
    html += `</div>`;
  }

  html += lines.map(renderLedger).join("");
  const v = R.rulepack?.rulepack_version || R.rulepack?.version || "?";
  const h = R.rulepack?.rulepack_hash || R.rulepack?.hash || "";
  html += `<div class="body" style="border-top:1px solid var(--color-blue-gray-200)">
    <p class="cap" style="margin:0">Engine <b>${esc(engineLabel(R._engine || S.engine))}</b>
    · Snapshot <b class="mono">${esc(v)}</b>
    <span class="mono">${esc(h)}</span>. Pin this hash to reproduce the assessment exactly.</p></div>`;
  $("#results").innerHTML = html;
  bindStackLayers($("#results"));
}

function ftaCompareHtml(fc) {
  if (!fc || !fc.available) return "";
  const claimed = fc.claimed;
  const without = fc.without_claim || {};
  const withC = fc.with_claim || {};
  const bits = [];
  if (fc.col1_suppressed || fc.spi_applied) bits.push("Col-1 Free");
  if (fc.mpf_suppressed) bits.push("MPF exempt");
  if (fc.exemption_heading) bits.push(`${fc.exemption_heading} @ 0%`);
  return `<div class="fta-compare">
    <div class="eyebrow">${esc(fc.label || "FTA")} duty comparison</div>
    <p class="cap" style="margin:0 0 var(--sp-2)">
      ${claimed
        ? `<b>${esc(fc.label)}</b> claimed${bits.length ? ` — ${esc(bits.join(" · "))}` : ""}.`
        : `<b>${esc(fc.label)}</b> available but not claimed — check the claim box to apply${
            fc.exemption_heading ? ` <span class="mono">${esc(fc.exemption_heading)}</span>` : ""
          }.`}
      Duty saved if claimed: <b>$${money(fc.duty_saved)}</b>.
      <span class="cap">SPI alone zeros Col-1 + MPF; other programs need their own exception.</span>
    </p>
    <div class="fta-compare-grid">
      <div class="fta-col ${claimed ? "" : "is-active"}">
        <div class="k">Without claim</div>
        <div class="v">${pct(without.effective_duty_rate_pct)}%</div>
        <div class="cap">$${money(without.line_duty)} duty
          ${without.col1_duty != null ? ` · Col-1 $${money(without.col1_duty)}` : ""}
          ${without.fl_heading ? ` · ${esc(without.fl_heading)} $${money(without.fl_duty)}` : ""}</div>
      </div>
      <div class="fta-col ${claimed ? "is-active" : ""}">
        <div class="k">With ${esc(fc.label || "FTA")}</div>
        <div class="v">${pct(withC.effective_duty_rate_pct)}%</div>
        <div class="cap">$${money(withC.line_duty)} duty
          ${fc.spi_applied || fc.claim_id === "USMCA" || fc.claim_id === "CAFTA_DR"
            ? " · Col-1 Free"
            : withC.col1_duty != null
              ? ` · Col-1 $${money(withC.col1_duty)}`
              : ""}
          ${withC.fl_heading || fc.exemption_heading
            ? ` · ${esc(withC.fl_heading || fc.exemption_heading)} @ 0%`
            : ""}</div>
      </div>
    </div>
  </div>`;
}

function pharmaCompareHtml(pc) {
  if (!pc || !pc.claimed) return "";
  const withC = pc.with_claim || {};
  const without = pc.without_claim || {};
  const cap = pc.kind === "threshold_topup" || pc.kind === "threshold_no_add";
  const capLabel = pc.eu_cap ? "EU cap" : "301-FL";
  const expl = pc.kind === "threshold_topup"
    ? `Pharma use skipped this ${esc(capLabel)}. Without it, this line would have been capped at ${pct(pc.cap_pct)}% — that's Column-1 ${pct(pc.col1_pct)}% plus an extra ${pct(pc.additional_pct)}% ($${money(pc.additional_duty)}), not a second ${pct(pc.cap_pct)}%.`
    : pc.kind === "threshold_no_add"
      ? `Pharma use skipped <span class="mono">${esc(pc.instead_of)}</span>. Column-1 is already at ${pct(pc.col1_pct)}%, so the ${esc(capLabel)} would not have added extra duty.`
      : `Pharma use skipped <span class="mono">${esc(pc.instead_of)}</span>. Without it, 301-FL would have added a flat ${pct(pc.additional_pct)}% ($${money(pc.additional_duty)}) on top of Column-1 ${pct(pc.col1_pct)}%.`;
  return `<div class="fta-compare">
    <div class="eyebrow">Pharma use vs ${esc(capLabel)}</div>
    <p class="cap" style="margin:0 0 var(--sp-2)">
      ${expl}
      Difference: <b>${pct(pc.additional_pct)}% / $${money(pc.additional_duty)}</b>. Column-1 and MPF still apply.
    </p>
    <div class="fta-compare-grid">
      <div class="fta-col">
        <div class="k">Without Pharma use</div>
        <div class="v">${pct(without.effective_duty_rate_pct)}%</div>
        <div class="cap">$${money(without.line_duty)} duty
          ${cap
            ? ` · Col-1 ${pct(pc.col1_pct)}% + extra ${pct(pc.additional_pct)}%`
            : ` · Col-1 ${pct(pc.col1_pct)}% + ${esc(pc.instead_of)} ${pct(pc.additional_pct)}%`}</div>
      </div>
      <div class="fta-col is-active">
        <div class="k">With Pharma use</div>
        <div class="v">${pct(withC.effective_duty_rate_pct)}%</div>
        <div class="cap">$${money(withC.line_duty)} duty · Column-1 ${pct(pc.col1_pct)}% only · MPF still due</div>
      </div>
    </div>
  </div>`;
}

function renderLedger(L) {
  const layers = L.layers || [], supp = L.suppressed || [];
  const diag = L.diagnostics || [];
  const unknown = L.blocked && diag.some(d => d.code === "UNKNOWN_HTS" || d.code === "MISSING_COL1");
  if (unknown) {
    const err = diag.find(d => d.severity === "ERROR") || diag[0];
    return `<div class="ledger">
      <div class="ledger-hd">
        <div><span class="eyebrow">Line ${esc(L.line_id)}</span>
          <b class="mono">${esc(L.hts)}</b> · ${esc(L.coo || "—")}</div>
        <div class="r"><span class="pill" style="background:var(--color-red-50);color:var(--color-red-700)">Blocked</span></div>
      </div>
      <div class="banner err" style="margin:var(--sp-3)">
        <b>No duty rate</b>
        ${esc(err?.message || "HTS is not in the baseline table.")}
        ${err?.remediation ? `<div class="why" style="margin-top:var(--sp-1)">${esc(err.remediation)}</div>` : ""}
        ${L.replacement_hts
          ? `<div class="why" style="margin-top:var(--sp-1)">Suggested replacement <b class="mono">${esc(L.replacement_hts_display || L.replacement_hts)}</b></div>`
          : ""}
        ${L.usitc_url ? `<div style="margin-top:var(--sp-2)"><a class="usitc-link" href="${esc(L.usitc_url)}" target="_blank" rel="noopener noreferrer">Look up on USITC</a></div>` : ""}
      </div>
    </div>`;
  }
  const paying = layers.filter(x => Number(x.duty_amount) > 0);
  const total = Number(L.totals?.duty) || 0;
  const bar = paying.length
    ? `<div class="compbar">` + paying.map(x =>
        `<span style="width:${(Number(x.duty_amount) / total * 100).toFixed(2)}%;background:${
          PROGRAM_COLOR[x.program] || "var(--color-blue-gray-400)"}"
          title="${esc(PROGRAM_NAME[x.program] || x.program)} $${money(x.duty_amount)}"></span>`
      ).join("") + `</div><div class="complegend">` + paying.map(x =>
        `<span><i style="background:${PROGRAM_COLOR[x.program] || "var(--color-blue-gray-400)"}"></i>${
          esc(PROGRAM_NAME[x.program] || x.program)} $${money(x.duty_amount)}</span>`).join("") +
      `</div>` : "";

  const lineKey = `L${esc(String(L.line_id || "0"))}`;
  const layerBlocks = [
    ...layers.map((x, i) => renderStackLayerRow({
      id: `${lineKey}-a${i}`,
      slot: x.stack_slot,
      code: x.ch99 || (x.program === "base" ? (L.hts || "commodity") : (x.label || "")),
      program: x.program,
      label: x.label || "",
      reason: x.reason || "",
      sourceRef: x.source_ref || "",
      rate: x.rate || "",
      duty: x.duty_amount,
      basisAmount: x.basis_amount,
      basisKind: x.basis === "QUANTITY"
        ? `${String(x.basis_amount)} ${(L.quantity_uom || "").toLowerCase() || "units"}`
        : `entered value`,
      basisFmt: x.basis === "QUANTITY"
        ? null
        : money(x.basis_amount),
      suppressed: false,
      exempt: Number(x.duty_amount) === 0 && Boolean(x.ch99),
    })),
    ...supp.map((x, i) => renderStackLayerRow({
      id: `${lineKey}-s${i}`,
      slot: x.stack_slot,
      code: x.ch99 || x.rule_id || "",
      program: "suppressed",
      label: x.label || "Suppressed",
      reason: x.reason || "",
      sourceRef: "",
      rate: x.rate || "",
      duty: 0,
      basisAmount: x.basis_amount,
      basisKind: "entered value",
      basisFmt: money(x.basis_amount),
      suppressed: true,
      exempt: false,
    })),
  ].join("");

  const diags = (L.diagnostics || []).map(d => `<div class="diag ${esc(d.severity)}">
      <span class="sev">${esc(d.severity)}</span>
      <div><div>${esc(d.message)} <code>${esc(d.code)}</code></div>
      ${d.remediation ? `<div class="fix"><b>Do this:</b> ${esc(d.remediation)}</div>` : ""}</div>
    </div>`).join("");

  return `<div class="lineresult">
    <div class="head"><span class="cap">line ${esc(L.line_id)}</span>
      <span class="hts">${esc(L.hts)}</span><span class="coo">${esc(L.coo)}</span>
      <span class="mono cap">$${money(L.entered_value)} entered</span>
      ${L.quantity != null ? `<span class="mono cap">${esc(String(L.quantity))} ${esc(L.quantity_uom || "")}</span>` : ""}
      <span class="spacer"></span>
      ${L.china_301_fy?.ch99
        ? `<span class="pill pill-301">301 note 31 → ${esc(L.china_301_fy.ch99)}</span>`
        : L.china_301?.list
        ? `<span class="pill pill-301">301 ${esc(L.china_301.list.replace(/_/g, " "))} → ${esc(L.china_301.ch99)}</span>`
        : ""}
      ${L.pharma_compare?.claimed
        ? `<span class="pill" style="background:var(--color-green-50);color:var(--color-green-700)">Pharma use claimed</span>`
        : L.fta_compare?.claimed
        ? `<span class="pill" style="background:var(--color-green-50);color:var(--color-green-700)">${esc(L.fta_compare.label)} claimed</span>`
        : L.fta_compare?.available
          ? `<span class="pill" style="background:var(--color-blue-50);color:var(--color-blue-700)">${esc(L.fta_compare.label)} available</span>`
          : ""}
      ${L.usitc_url
        ? `<a class="usitc-link" href="${esc(L.usitc_url)}" target="_blank" rel="noopener noreferrer">USITC</a>`
        : ""}
      <span class="cap mono">${(L.filing_sequence || L.ch99_sequence || []).join(" → ") || "no filing sequence"}</span></div>
    <div class="ratedate"><span>Rate-determination date</span>
      <b>${esc(L.rate_determination_date)}</b>
      <span class="cap">${esc(L.rate_date_basis || "")}</span>
      ${L.col1_rate_label ? `<span class="cap"> · Column 1 <b class="mono">${esc(L.col1_rate_label)}</b></span>` : ""}
    </div>
    ${pharmaCompareHtml(L.pharma_compare)}
    ${L.pharma_compare ? "" : ftaCompareHtml(L.fta_compare)}
    <div class="stack-layers-toolbar">
      <span class="eyebrow">Chapter 99 / provisions</span>
      <button type="button" class="btn-ghost btn-sm" data-stack-expand-all>Expand all</button>
    </div>
    <div class="stack-layers" data-stack-layers>${layerBlocks}</div>
    ${bar}
    <div class="totalrow">
      <div><span class="t">Total duty</span><br><span class="amt">$${money(L.totals?.duty)}</span></div>
      <div style="text-align:right"><span class="t">Effective rate</span><br>
        <span class="eff">${pct(L.totals?.effective_duty_rate_pct)}%</span></div></div>
    ${diags}</div>`;
}

/** One Ch.99 / commodity layer — collapsed summary, expand for reason/source/basis (design). */
function renderStackLayerRow(row) {
  const codeClass = row.suppressed || row.exempt ? "ch99 exempt" : "ch99";
  const basisLine = row.basisFmt != null
    ? `Basis <b class="mono">$${esc(row.basisFmt)}</b> · ${esc(row.basisKind || "")}`
    : `Basis <b class="mono">${esc(String(row.basisAmount ?? ""))}</b> · ${esc(row.basisKind || "")}`;
  return (
    `<div class="stack-layer${row.suppressed ? " is-suppressed" : ""}${row.program === "base" ? " is-commodity" : ""}" data-expanded="0" data-stack-layer>` +
      `<button type="button" class="stack-layer-toggle" aria-expanded="false" aria-controls="${esc(row.id)}" data-stack-layer-toggle>` +
        `<span class="stack-layer-chevron" aria-hidden="true">▸</span>` +
        `<span class="slot p-${esc(row.program || "base")}">${esc(row.slot || "")}</span>` +
        `<span class="${codeClass} mono">${esc(row.code || "")}</span>` +
        (row.suppressed ? `<span class="tag">suppressed</span>` : "") +
        `<span class="spacer"></span>` +
        `<span class="stack-layer-rate">${esc(row.rate || "")}</span>` +
        (row.duty == null
          ? (row.basisKind ? `<span class="cap stack-layer-status">${esc(row.basisKind)}</span>` : "")
          : `<span class="stack-layer-duty mono"><b>$${money(row.duty)}</b></span>`) +
      `</button>` +
      `<div class="stack-layer-detail" id="${esc(row.id)}" hidden>` +
        (row.label ? `<div class="stack-layer-label">${esc(row.label)}</div>` : "") +
        (row.reason ? `<div class="why">${esc(row.reason)}</div>` : "") +
        (row.sourceRef ? `<div class="src">${esc(row.sourceRef)}</div>` : "") +
        (row.duty != null
          ? `<div class="cap stack-layer-basis">${basisLine}</div>`
          : "") +
      `</div>` +
    `</div>`
  );
}

function bindStackLayers(root) {
  root?.querySelectorAll?.("[data-stack-layers]").forEach((wrap) => {
    const setRow = (row, on) => {
      row.dataset.expanded = on ? "1" : "0";
      const btn = row.querySelector("[data-stack-layer-toggle]");
      const detail = row.querySelector(".stack-layer-detail");
      const chev = row.querySelector(".stack-layer-chevron");
      if (btn) btn.setAttribute("aria-expanded", on ? "true" : "false");
      if (detail) detail.hidden = !on;
      if (chev) chev.textContent = on ? "▾" : "▸";
    };
    wrap.querySelectorAll("[data-stack-layer-toggle]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        const row = btn.closest("[data-stack-layer]");
        if (!row) return;
        setRow(row, row.dataset.expanded !== "1");
        syncExpandAllLabel(wrap);
      });
    });
    const toolbarBtn = wrap.parentElement?.querySelector?.("[data-stack-expand-all]");
    if (toolbarBtn) {
      toolbarBtn.addEventListener("click", (e) => {
        e.preventDefault();
        const rows = [...wrap.querySelectorAll("[data-stack-layer]")];
        const allOpen = rows.length && rows.every((r) => r.dataset.expanded === "1");
        rows.forEach((r) => setRow(r, !allOpen));
        syncExpandAllLabel(wrap);
      });
    }
    syncExpandAllLabel(wrap);
  });
}

function syncExpandAllLabel(wrap) {
  const btn = wrap.parentElement?.querySelector?.("[data-stack-expand-all]");
  if (!btn) return;
  const rows = [...wrap.querySelectorAll("[data-stack-layer]")];
  const allOpen = rows.length && rows.every((r) => r.dataset.expanded === "1");
  btn.textContent = allOpen ? "Collapse all" : "Expand all";
}

$("#exportcsv").onclick = () => {
  if (!S.last) return;
  const q = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = [["line_id", "hts", "coo", "entered_value", "rate_determination_date",
    "ch99_sequence", "total_duty", "effective_rate_pct", "layers", "diagnostics",
    "snapshot_version", "snapshot_hash"].join(",")];
  (S.last.lines || []).forEach(L => rows.push([
    L.line_id, L.hts, L.coo, L.entered_value, L.rate_determination_date,
    (L.ch99_sequence || []).join(" "), L.totals?.duty, L.totals?.effective_duty_rate_pct,
    (L.layers || []).map(x => `${x.ch99 || "base"}@${x.rate}=$${x.duty_amount}`).join(" | "),
    (L.diagnostics || []).map(d => `${d.severity}:${d.code}`).join(" "),
    S.last.rulepack?.rulepack_version || "", S.last.rulepack?.rulepack_hash || "",
  ].map(q).join(",")));
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([rows.join("\n")], { type: "text/csv" }));
  a.download = `duty-allocation-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click(); URL.revokeObjectURL(a.href);
};

$("#copyall").onclick = async () => {
  if (!S.last) return;
  const txt = (S.last.lines || []).map(L => [
    `${L.hts}  ${L.coo}  $${money(L.entered_value)}  rate date ${L.rate_determination_date} (${L.rate_date_basis})`,
    ...(L.layers || []).map(x =>
      `  ${x.stack_slot}  ${(x.ch99 || "commodity").padEnd(12)} ${String(x.rate || "").padEnd(26)} $${money(x.duty_amount)}`),
    ...(L.suppressed || []).map(x => `  --  ${x.ch99 || x.rule_id} SUPPRESSED — ${x.reason}`),
    `  TOTAL $${money(L.totals?.duty)}  effective ${pct(L.totals?.effective_duty_rate_pct)}%`,
  ].join("\n")).join("\n\n");
  try {
    await navigator.clipboard.writeText(txt +
      `\nSnapshot ${S.last.rulepack?.rulepack_version} ${S.last.rulepack?.rulepack_hash}`);
    const b = $("#copyall"); b.textContent = "Copied";
    setTimeout(() => b.textContent = "Copy", 1400);
  } catch { banner("#calcbanner", "err", "Could not copy", "The browser refused clipboard access."); }
};

/* ================================================================ RULES */
async function loadRules() {
  const p = new URLSearchParams();
  const g = id => $(id).value.trim();
  if (g("#f-program")) p.set("program", g("#f-program"));
  if (g("#f-action")) p.set("action", g("#f-action"));
  if (g("#f-status")) p.set("status", g("#f-status"));
  if (g("#f-coo")) p.set("coo", g("#f-coo").toUpperCase());
  if (g("#f-ch99")) p.set("ch99", g("#f-ch99"));
  if (g("#f-q")) p.set("q", g("#f-q"));
  p.set("limit", "400");
  $("#rulesbody").innerHTML = `<tr><td colspan="4"><span class="busy"></span></td></tr>`;
  try {
    const r = await api("/v1/rules?" + p.toString());
    S.rules = r.rules || [];
    $("#rulesfound").textContent = `${r.count ?? S.rules.length} matching`;
    $("#rulesbody").innerHTML = S.rules.length ? S.rules.map((x, i) => {
      const expired = x.effective_end && new Date(x.effective_end) < new Date();
      return `<tr class="clickable" data-i="${i}">
        <td><b class="mono" style="font-size:.857rem">${esc(x.id)}</b>
          <div class="cap">${esc(x.label || "")}</div>
          <div>${x.status ? `<span class="pill ${esc(x.status)}">${esc(x.status)}</span> ` : ""}
            ${x.confidence && x.confidence !== "VERIFIED"
              ? `<span class="pill ${esc(x.confidence)}">${esc(x.confidence)}</span>` : ""}</div></td>
        <td><span class="pill ${esc(x.action)}">${esc(x.action)}</span>
          <div class="cap mono">${esc(x.program)}</div></td>
        <td><span class="ch99">${esc(x.ch99 || "—")}</span>
          <div class="cap"><span class="slot p-${esc(x.program)}">${esc(x.stack_slot)}</span></div></td>
        <td class="cap mono">${dshort(x.effective_start)}<br>${
          x.effective_end ? `${dshort(x.effective_end)} ${expired
            ? '<span class="pill expired">ended</span>' : ""}` : "open"}</td></tr>`;
    }).join("") : `<tr><td colspan="4" class="cap" style="padding:var(--sp-4)">
        No rules match those filters.</td></tr>`;
  } catch (e) {
    $("#rulesbody").innerHTML = `<tr><td colspan="4">
      <div class="banner err"><b>Could not load rules</b>${esc(e.message)}</div></td></tr>`;
  }
}
$("#f-apply").onclick = loadRules;
$("#f-reset").onclick = () => {
  ["#f-program", "#f-action", "#f-status", "#f-coo", "#f-ch99", "#f-q"]
    .forEach(id => $(id).value = "");
  loadRules();
};
$("#f-q").addEventListener("keydown", e => { if (e.key === "Enter") loadRules(); });

$("#rulesbody").addEventListener("click", e => {
  const tr = e.target.closest("tr[data-i]"); if (!tr) return;
  $$("#rulesbody tr").forEach(r => r.classList.remove("sel"));
  tr.classList.add("sel");
  showRule(S.rules[Number(tr.dataset.i)]);
});

function showRule(r) {
  S.selectedRule = r;
  $("#ruleraw").hidden = false;
  const w = r.when || {};
  const preds = Object.entries(w).filter(([, v]) =>
    Array.isArray(v) ? v.length : (v !== null && v !== undefined && v !== ""));
  const rate = r.rate || {};
  const rateBits = Object.entries(rate).filter(([, v]) => v !== null && v !== "NONE" && v !== undefined);
  $("#ruledetail").innerHTML = `<div class="body">
    <div style="margin-bottom:var(--sp-3)">
      <span class="pill ${esc(r.action)}">${esc(r.action)}</span>
      ${r.status ? `<span class="pill ${esc(r.status)}">${esc(r.status)}</span>` : ""}
      ${r.confidence ? `<span class="pill ${esc(r.confidence)}">${esc(r.confidence)}</span>` : ""}
    </div>
    <h5 class="mono" style="margin-bottom:var(--sp-1)">${esc(r.id)}</h5>
    <p style="margin:0 0 var(--sp-3)">${esc(r.label || "")}</p>
    <dl class="kv">
      <dt>Program</dt><dd class="mono">${esc(r.program)}${r.layer && r.layer !== "default"
        ? ` &middot; layer ${esc(r.layer)}` : ""}</dd>
      <dt>Chapter 99</dt><dd class="mono">${esc(r.ch99 || "—")}</dd>
      <dt>Reporting slot</dt><dd class="mono">${esc(r.stack_slot)}</dd>
      <dt>Value basis</dt><dd class="mono">${esc(r.basis)}</dd>
      ${rateBits.length ? `<dt>Rate</dt><dd class="mono">${
        rateBits.map(([k, v]) => `${esc(k)}=${esc(v)}`).join(", ")}</dd>` : ""}
      ${r.threshold_pair_ge ? `<dt>If col-1 ≥ threshold</dt>
        <dd class="mono">${esc(r.threshold_pair_ge)}</dd>` : ""}
      ${r.threshold_pair_lt ? `<dt>If col-1 &lt; threshold</dt>
        <dd class="mono">${esc(r.threshold_pair_lt)}</dd>` : ""}
      <dt>Effective</dt><dd class="mono">${dshort(r.effective_start)} → ${
        r.effective_end ? dshort(r.effective_end) : "open"}</dd>
      ${r.recorded_start ? `<dt>Recorded from</dt>
        <dd class="mono">${dshort(r.recorded_start)}</dd>` : ""}
      <dt>Authority</dt><dd>${esc(r.authority || "—")}</dd>
      <dt>Citation</dt><dd class="mono">${esc(r.source_ref || "—")}</dd>
      ${r.note52_subdivision ? `<dt>Note 52</dt><dd class="mono">${esc(r.note52_subdivision)}</dd>` : ""}
      ${r.fta_preservation ? `<dt>FTA preserved</dt><dd>${esc(r.fta_preservation)}</dd>` : ""}
      ${r.reviewed_by ? `<dt>Reviewed by</dt><dd>${esc(r.reviewed_by)}</dd>` : ""}
    </dl>
    <div style="margin-top:var(--sp-4)"><span class="eyebrow">Matches when</span>
      ${preds.length ? `<dl class="kv" style="margin-top:var(--sp-2)">${preds.map(([k, v]) =>
        `<dt class="mono">${esc(k)}</dt><dd class="mono">${esc(
          Array.isArray(v) ? v.map(x => typeof x === "object" ? JSON.stringify(x) : x).join(", ")
                           : String(v))}</dd>`).join("")}</dl>`
        : `<p class="cap" style="margin:var(--sp-2) 0 0">No conditions — applies to every line the
           program sees.</p>`}</div>
    ${r.notes ? `<div style="margin-top:var(--sp-4)"><span class="eyebrow">Notes</span>
      <p style="margin:var(--sp-2) 0 0">${esc(r.notes)}</p></div>` : ""}
  </div>`;
}

$("#ruleraw").onclick = () => {
  if (!S.selectedRule) return;
  $("#ruledetail").innerHTML = `<div class="body"><pre class="json">${
    esc(JSON.stringify(S.selectedRule, null, 2))}</pre></div>`;
};

$("#runvalidate").onclick = async () => {
  const out = $("#validateout");
  out.innerHTML = '<span class="busy"></span>';
  try {
    const v = await api("/v1/rules:validate", { method: "POST" });
    const ok = v.result === "PASS";
    out.innerHTML = `<div class="banner ${ok ? "ok" : "err"}">
      <b>${esc(v.result)} — ${v.failures.length} failure(s), ${v.warnings.length} warning(s)</b>
      ${v.rule_count} rules would freeze as <span class="mono">${esc(v.would_hash || "")}</span>
      </div>` + (v.failures.length ? `<div class="banner err"><b>Must fix</b>${
        v.failures.map(f => `${esc(f.check)}${f.rule_id ? ` [${esc(f.rule_id)}]` : ""}: ${esc(f.message)}`).join("<br>")
      }</div>` : "") + (v.warnings.length ? `<div class="banner warn"><b>Warnings</b>${
        v.warnings.map(f => `${esc(f.check)}${f.rule_id ? ` [${esc(f.rule_id)}]` : ""}: ${esc(f.message)}`).join("<br>")
      }</div>` : "");
    $("#dopublish").disabled = !ok;
  } catch (e) {
    out.innerHTML = `<div class="banner err"><b>Validation failed to run</b>${esc(e.message)}</div>`;
  }
};

$("#dopublish").onclick = async () => {
  const version = $("#snapversion").value.trim();
  const by = $("#snapby").value.trim();
  if (!version || !by) {
    banner("#rulesbanner", "err", "Version and your name are both required",
      "A snapshot records who published it."); return;
  }
  const b = $("#dopublish"); b.disabled = true; b.innerHTML = '<span class="busy"></span>';
  try {
    const r = await api("/v1/snapshots", { method: "POST", body: JSON.stringify({
      version, created_by: by, notes: $("#snapnote").value.trim(), activate: true }) });
    banner("#rulesbanner", "ok", `Published ${esc(version)}`,
      `${r.rule_count ?? ""} rules frozen as ${r.hash || ""}. Reload to assess against it.`);
    await boot(); loadRules();
  } catch (e) {
    banner("#rulesbanner", "err", "Publish refused", e.message);
  } finally { b.disabled = false; b.textContent = "Publish & activate"; }
};

/* ================================================================ UPLOAD */
const TEMPLATES = {
  hts: `hts,effective_start,col1_rate_pct,description
6203.42.0711,2026-01-01,16.6,"Men's cotton trousers"
8708.29.5160,2026-01-01,2.5,"Motor vehicle body parts"
3303.00.3000,2026-01-01,0,"Perfumes and toilet waters"`,
  rules: JSON.stringify({
    actor: "your.name", status: "DRAFT",
    source_ref: "CSMS #XXXXXXXX",
    rules: [{
      id: "s232.example.new", program: "s232", action: "DUTY", ch99: "9903.99.99",
      label: "Example — replace with the real provision",
      when: { hts_prefix_any: ["7208"], coo_in: ["CN"] },
      rate: { kind: "AD_VALOREM", pct: 25 }, basis: "ENTERED_VALUE", stack_slot: "3.3",
      effective_start: "2026-08-01T00:01:00-04:00",
      authority: "Section 232, Trade Expansion Act of 1962",
      source_ref: "CSMS #XXXXXXXX — 9903.99.99",
      confidence: "AI_EXTRACTED",
    }],
  }, null, 2),
};

function renderUploadHelp(opts = {}) {
  const kind = $("#uploadkind").value;
  $("#uploadhelp").innerHTML = kind === "hts"
    ? `<div class="banner info"><b>HTSUS Column-1 rates</b>
        Preferred: drop the full <b>classification workbook</b> (.xlsx) — same format as
        <span class="mono">npm run import:hts</span> — to <b>replace</b> the live table.
        Or paste / CSV with <span class="mono">hts, effective_start</span> plus
        <span class="mono">col1_rate_pct</span> (and optional specific/UOM/description) to
        <b>merge</b> rows. Reloads in-process; no server restart.</div>`
    : `<div class="banner info"><b>Tariff rules</b>
        JSON with a <span class="mono">rules</span> array, matching the schema shown in the
        template. Everything loads as <b>DRAFT</b> — invisible to the engine until you validate
        and publish a snapshot. Mark anything AI-drafted
        <span class="mono">confidence: AI_EXTRACTED</span> and leave
        <span class="mono">reviewed_by</span> unset so the validator forces a human sign-off.</div>`;
  if (opts.keepStaged) return;
  $("#previewcard").hidden = true;
  $("#uploadcommit").disabled = true;
  S.parsed = null;
  S.parsedKind = null;
  UploadXlsx.b64 = null;
  UploadXlsx.name = null;
}

async function refreshHtsLive(meta) {
  const el = $("#hts-live");
  if (!el) return;
  let t = meta;
  if (!t) {
    try {
      const r = await api("/v1/reference/stacking-order");
      t = r.hts_table;
    } catch (e) {
      el.innerHTML = `<p class="cap">Could not read the live table (${esc(e.message)}).</p>`;
      return;
    }
  }
  const n = Number(t.row_count || 0).toLocaleString();
  const repl = t.replacements != null ? Number(t.replacements).toLocaleString() : "—";
  el.innerHTML = `<dl class="kv">
      <dt>Source</dt><dd class="mono">${esc(t.source || "—")}</dd>
      <dt>As of</dt><dd class="mono">${esc(t.as_of || "—")}</dd>
      <dt>Rate windows</dt><dd class="mono">${n}</dd>
      <dt>Replacements</dt><dd class="mono">${esc(String(repl))}</dd>
    </dl>
    <p class="cap" style="margin:var(--sp-2) 0 0">Duty stack and HTS list use this table. A successful Load updates these fields immediately.</p>`;
}

const UploadXlsx = { b64: null, name: null };

$("#uploadkind").onchange = renderUploadHelp;
$("#uploadtemplate").onclick = () => {
  $("#uploadbox").value = TEMPLATES[$("#uploadkind").value];
  $("#uploadbox").focus();
};

const dz = $("#dropzone");
["dragenter", "dragover"].forEach(ev => dz.addEventListener(ev, e => {
  e.preventDefault(); dz.classList.add("over");
}));
["dragleave", "drop"].forEach(ev => dz.addEventListener(ev, e => {
  e.preventDefault(); dz.classList.remove("over");
}));
dz.addEventListener("drop", e => {
  const f = e.dataTransfer.files?.[0]; if (f) readFile(f);
});
$("#filepick").onchange = e => { const f = e.target.files?.[0]; if (f) readFile(f); };

function readFile(f) {
  const name = f.name || "upload";
  if (/\.(xlsx|xls)$/i.test(name)) {
    const r = new FileReader();
    r.onload = () => {
      const buf = new Uint8Array(r.result);
      let bin = "";
      for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
      UploadXlsx.b64 = btoa(bin);
      UploadXlsx.name = name;
      S.parsed = { xlsx: true, filename: name, bytes: f.size };
      S.parsedKind = "hts_xlsx";
      $("#uploadkind").value = "hts";
      $("#uploadbox").value = "";
      $("#previewcard").hidden = false;
      $("#previewcount").textContent = "classification workbook";
      $("#previewout").innerHTML = `<div class="body"><div class="banner info">
        <b>${esc(name)}</b> · ${(f.size / 1024 / 1024).toFixed(2)} MB<br>
        Click <b>Load</b> to replace the live Column-1 table (same as
        <span class="mono">npm run import:hts</span>). Hot-reloads — no restart.</div></div>`;
      $("#uploadcommit").disabled = !S.me?.can?.write_rules;
      $("#uploadcommit").textContent = "Replace HTS table from workbook";
      banner("#uploadbanner", "ok", `Workbook staged: ${esc(name)}`,
        "Preview looks good — Load to replace baseline rates.");
    };
    r.onerror = () => banner("#uploadbanner", "err", "Could not read the workbook", "");
    r.readAsArrayBuffer(f);
    return;
  }

  UploadXlsx.b64 = null;
  UploadXlsx.name = null;
  const r = new FileReader();
  r.onload = () => {
    $("#uploadbox").value = r.result;
    if (/\.json$/i.test(name)) $("#uploadkind").value = "rules";
    else if (/\.(csv|tsv|txt)$/i.test(name)) $("#uploadkind").value = "hts";
    renderUploadHelp();
    banner("#uploadbanner", "ok", `Loaded ${esc(name)}`,
      `${(f.size / 1024).toFixed(1)} KB read. Preview it before committing.`);
  };
  r.onerror = () => banner("#uploadbanner", "err", "Could not read the file", "");
  r.readAsText(f);
}

$("#uploadpreview").onclick = () => {
  if (UploadXlsx.b64) {
    S.parsed = { xlsx: true, filename: UploadXlsx.name, bytes: 0 };
    S.parsedKind = "hts_xlsx";
    $("#previewcard").hidden = false;
    $("#previewcount").textContent = "classification workbook";
    $("#previewout").innerHTML = `<div class="body"><div class="banner info">
      <b>${esc(UploadXlsx.name || "workbook")}</b> staged — Load to replace the HTS table.</div></div>`;
    $("#uploadcommit").disabled = !S.me?.can?.write_rules;
    $("#uploadcommit").textContent = "Replace HTS table from workbook";
    return;
  }
  const raw = $("#uploadbox").value.trim();
  const kind = $("#uploadkind").value;
  if (!raw) { banner("#uploadbanner", "err", "Nothing to preview", "Paste or drop content first."); return; }
  banner("#uploadbanner", null);
  try {
    if (kind === "rules") previewRules(raw); else previewHts(raw);
  } catch (e) {
    banner("#uploadbanner", "err", "Could not parse that", e.message);
    $("#previewcard").hidden = true; $("#uploadcommit").disabled = true;
  }
};

function previewRules(raw) {
  const doc = JSON.parse(raw);
  const rules = Array.isArray(doc) ? doc : doc.rules;
  if (!Array.isArray(rules)) throw new Error("expected a 'rules' array");
  const problems = [];
  rules.forEach((r, i) => {
    const where = r.id || `rule ${i + 1}`;
    if (!r.id) problems.push(`${where}: no id`);
    if (!r.program) problems.push(`${where}: no program`);
    if (!r.action) problems.push(`${where}: no action`);
    if (!r.source_ref && !doc.source_ref) problems.push(`${where}: no source_ref — required to publish`);
    if (r.action === "THRESHOLD" && (r.rate || {}).kind !== "COMBINED_TO_CAP")
      problems.push(`${where}: THRESHOLD must use rate.kind COMBINED_TO_CAP, never a flat add-on`);
    if (["EXEMPTION", "INTRANSIT", "SUPPRESSION"].includes(r.action)
        && (r.rate || {}).kind && r.rate.kind !== "NONE")
      problems.push(`${where}: a suppression must not carry a rate`);
  });
  S.parsed = { ...doc, rules }; S.parsedKind = "rules";
  $("#previewcount").textContent = `${rules.length} rule(s)`;
  $("#previewout").innerHTML =
    (problems.length ? `<div class="body"><div class="banner err">
      <b>${problems.length} problem(s) — fix before loading</b>${problems.map(esc).join("<br>")}</div></div>` : "") +
    `<table class="data"><thead><tr><th>Rule</th><th>Action</th><th>Ch.99</th><th>Rate</th>
      <th>Effective</th></tr></thead><tbody>` + rules.map(r => `<tr>
        <td><b class="mono" style="font-size:.857rem">${esc(r.id || "—")}</b>
          <div class="cap">${esc(r.label || "")}</div></td>
        <td><span class="pill ${esc(r.action || "")}">${esc(r.action || "?")}</span>
          <div class="cap mono">${esc(r.program || "?")}</div></td>
        <td class="mono">${esc(r.ch99 || "—")}</td>
        <td class="mono">${esc(Object.entries(r.rate || {})
          .filter(([, v]) => v != null).map(([k, v]) => `${k}=${v}`).join(" ") || "—")}</td>
        <td class="cap mono">${dshort(r.effective_start)}</td></tr>`).join("") + `</tbody></table>`;
  $("#previewcard").hidden = false;
  $("#uploadcommit").disabled = problems.length > 0 || !S.me?.can?.write_rules;
  $("#uploadcommit").textContent = `Load ${rules.length} rule(s) as draft`;
}

function previewHts(raw) {
  const lines = raw.split(/\r?\n/).filter(r => r.trim());
  const split = r => r.includes("\t") ? r.split("\t") : splitCsv(r);
  const header = split(lines[0]).map(c => c.trim().toLowerCase());
  if (!header.includes("hts")) throw new Error("first row must be a header containing 'hts'");
  const rows = [], problems = [];
  lines.slice(1).forEach((l, i) => {
    const cells = split(l);
    const o = {};
    header.forEach((h, j) => { if (cells[j] !== undefined) o[h] = String(cells[j]).trim(); });
    if (!o.hts) { problems.push(`row ${i + 2}: no hts`); return; }
    if (!o.effective_start) o.effective_start = "2026-01-01";
    ["col1_rate_pct", "col1_specific_amount"].forEach(k => {
      if (o[k] === "") delete o[k];
      else if (o[k] != null && isNaN(Number(o[k]))) problems.push(`row ${i + 2}: ${k} is not a number`);
    });
    rows.push(o);
  });
  S.parsed = rows; S.parsedKind = "hts";
  $("#previewcount").textContent = `${rows.length} rate row(s)`;
  $("#previewout").innerHTML =
    (problems.length ? `<div class="body"><div class="banner err">
      <b>${problems.length} problem(s)</b>${problems.slice(0, 20).map(esc).join("<br>")}</div></div>` : "") +
    `<table class="data"><thead><tr><th>HTS</th><th class="r">Col-1 %</th><th class="r">Specific</th>
      <th>Effective</th><th>Description</th></tr></thead><tbody>` +
    rows.slice(0, 300).map(r => `<tr><td class="mono">${esc(r.hts)}</td>
      <td class="r">${esc(r.col1_rate_pct ?? "—")}</td>
      <td class="r">${esc(r.col1_specific_amount ?? "—")}</td>
      <td class="cap mono">${esc(r.effective_start)}</td>
      <td class="cap">${esc(r.description || "")}</td></tr>`).join("") +
    `</tbody></table>` + (rows.length > 300
      ? `<div class="body cap">Showing the first 300 of ${rows.length}.</div>` : "");
  $("#previewcard").hidden = false;
  $("#uploadcommit").disabled = problems.length > 0 || !S.me?.can?.write_rules;
  $("#uploadcommit").textContent = `Load ${rows.length} rate row(s)`;
}

function splitCsv(line) {
  const out = []; let cur = "", q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === "," && !q) { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

$("#uploadcommit").onclick = async () => {
  if (!S.parsed) return;
  const b = $("#uploadcommit"); const was = b.textContent;
  b.disabled = true; b.innerHTML = '<span class="busy"></span>';
  let successTitle = "";
  let successMsg = "";
  let live = null;
  try {
    if (S.parsedKind === "rules") {
      const r = await api("/v1/rules:bulk", { method: "POST", body: JSON.stringify({
        actor: S.parsed.actor || "upload", status: S.parsed.status || "DRAFT",
        source_ref: S.parsed.source_ref || "", rules: S.parsed.rules }) });
      successTitle = `${r.upserted} rule(s) loaded as draft`;
      successMsg = (r.blocked_pending_review?.length
        ? `${r.blocked_pending_review.length} need a named reviewer before they can publish. `
        : "") + "Go to Rules to validate and publish a snapshot.";
    } else if (S.parsedKind === "hts_xlsx") {
      if (!UploadXlsx.b64) throw new Error("Workbook not staged — drop the .xlsx again.");
      const r = await api("/v1/admin/hts:import", {
        method: "POST",
        body: JSON.stringify({
          xlsx_base64: UploadXlsx.b64,
          filename: UploadXlsx.name || "hts-upload.xlsx",
          as_of: new Date().toISOString().slice(0, 10),
        }),
      });
      const n = r.row_count?.toLocaleString?.() || r.row_count;
      successTitle = `HTS table replaced · ${n} rate windows`;
      successMsg = `${r.source || UploadXlsx.name} · hash ${r.hash || "—"} · ` +
        `${r.with_specific || 0} with specific rates. Live for Duty stack / HTS list now.`;
      live = r.hts || {
        source: r.source, as_of: r.as_of, row_count: r.row_count,
        replacements: r.replacements_total,
      };
      UploadXlsx.b64 = null;
      UploadXlsx.name = null;
    } else {
      const rows = S.parsed.map(o => ({
        hts: o.hts, effective_start: o.effective_start,
        col1_rate_pct: o.col1_rate_pct ?? null,
        col1_specific_amount: o.col1_specific_amount ?? null,
        col1_specific_uom: o.col1_specific_uom ?? null,
        unit_of_quantity: o.unit_of_quantity ?? null,
        description: o.description ?? "", effective_end: o.effective_end ?? null,
        source_ref: o.source_ref ?? "HTSUS upload",
      }));
      const r = await api("/v1/reference/hts", {
        method: "POST",
        body: JSON.stringify({
          rows,
          source_ref: "HTSUS CSV upload",
          as_of: new Date().toISOString().slice(0, 10),
        }),
      });
      successTitle = `${r.loaded} rate row(s) merged`;
      successMsg = `Table now has ${r.row_count?.toLocaleString?.() || r.row_count} windows · hash ${r.hash || r.reference_epoch || "—"}.`;
      live = r.hts || {
        source: r.source, as_of: r.as_of, row_count: r.row_count,
        replacements: r.replacements_total,
      };
    }
    $("#previewcard").hidden = true; $("#uploadbox").value = ""; S.parsed = null; S.parsedKind = null;
    banner("#uploadbanner", "ok", successTitle, successMsg);
    if (live) refreshHtsLive(live);
    await boot();
    banner("#uploadbanner", "ok", successTitle, successMsg);
    if (live) refreshHtsLive(live);
  } catch (e) {
    banner("#uploadbanner", "err", "Load failed", e.message);
  } finally { b.disabled = false; b.textContent = was; }
};

/* ================================================================ USERS (admin) */
async function loadUsers() {
  const out = $("#usersout");
  if (!out) return;
  if (!S.me?.can?.admin) {
    out.innerHTML = `<div class="body"><div class="banner warn"><b>Admin only</b>Sign in as an admin to manage users.</div></div>`;
    return;
  }
  const q = ($("#user-q")?.value || "").trim();
  const status = ($("#user-status-filter")?.value || "").trim();
  const qs = new URLSearchParams();
  if (q) qs.set("q", q);
  if (status) qs.set("status", status);
  try {
    const r = await api("/v1/admin/users" + (qs.toString() ? `?${qs}` : ""));
    const users = r.users || [];
    if (!users.length) {
      out.innerHTML = `<div class="empty cap">No users yet. Add the first admin via Add user or ADMIN_BOOTSTRAP_EMAILS.</div>`;
      return;
    }
    out.innerHTML = `<table class="data"><thead><tr>
      <th>Email</th><th>Name</th><th>Role</th><th>Status</th><th>Last login</th><th></th>
      </tr></thead><tbody>` + users.map((u) => `<tr data-uid="${esc(u.id)}">
        <td class="mono">${esc(u.email)}</td>
        <td>${esc(u.name || "—")}</td>
        <td>
          <select data-user-role="${esc(u.id)}" ${u.email === S.me?.email ? "disabled" : ""}>
            <option value="user"${u.role === "user" ? " selected" : ""}>user</option>
            <option value="admin"${u.role === "admin" ? " selected" : ""}>admin</option>
          </select>
        </td>
        <td>
          <select data-user-status="${esc(u.id)}" ${u.email === S.me?.email ? "disabled" : ""}>
            <option value="active"${u.status === "active" ? " selected" : ""}>active</option>
            <option value="disabled"${u.status === "disabled" ? " selected" : ""}>disabled</option>
          </select>
        </td>
        <td class="cap mono">${u.last_login_at ? dshort(u.last_login_at) : "—"}</td>
        <td>${u.email === S.me?.email
          ? `<span class="cap">you</span>`
          : `<button type="button" class="btn-ghost btn-sm" data-user-del="${esc(u.id)}">Delete</button>`}</td>
      </tr>`).join("") + `</tbody></table>`;
    banner("#usersbanner", "ok", `${users.length} user(s)`,
      S.me?.users_db === false ? "DB flag missing on /v1/me — refresh after enabling DATABASE_URL." : "");
  } catch (e) {
    out.innerHTML = "";
    banner("#usersbanner", "err", "Could not load users", e.message);
  }
}

async function patchUser(id, body) {
  try {
    await api(`/v1/admin/users/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    banner("#usersbanner", "ok", "Updated", "");
    await loadUsers();
  } catch (e) {
    banner("#usersbanner", "err", "Update failed", e.message);
  }
}

$("#user-add")?.addEventListener("click", async () => {
  const email = ($("#user-email")?.value || "").trim();
  const name = ($("#user-name")?.value || "").trim();
  const role = $("#user-role")?.value || "user";
  if (!email) {
    banner("#usersbanner", "err", "Email required", "");
    return;
  }
  try {
    await api("/v1/admin/users", {
      method: "POST",
      body: JSON.stringify({ email, name: name || null, role }),
    });
    if ($("#user-email")) $("#user-email").value = "";
    if ($("#user-name")) $("#user-name").value = "";
    banner("#usersbanner", "ok", "User added", email);
    await loadUsers();
  } catch (e) {
    banner("#usersbanner", "err", "Add failed", e.message);
  }
});

$("#user-refresh")?.addEventListener("click", () => loadUsers());
$("#user-q")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") loadUsers();
});
$("#user-status-filter")?.addEventListener("change", () => loadUsers());

$("#usersout")?.addEventListener("change", async (e) => {
  const t = e.target;
  if (!(t instanceof HTMLSelectElement)) return;
  const id = t.getAttribute("data-user-role") || t.getAttribute("data-user-status");
  if (!id) return;
  if (t.hasAttribute("data-user-role")) await patchUser(id, { role: t.value });
  if (t.hasAttribute("data-user-status")) await patchUser(id, { status: t.value });
});

$("#usersout")?.addEventListener("click", async (e) => {
  const btn = e.target?.closest?.("[data-user-del]");
  if (!btn) return;
  const id = btn.getAttribute("data-user-del");
  if (!id || !confirm("Delete this user permanently?")) return;
  try {
    await api(`/v1/admin/users/${encodeURIComponent(id)}`, { method: "DELETE" });
    banner("#usersbanner", "ok", "Deleted", "");
    await loadUsers();
  } catch (err) {
    banner("#usersbanner", "err", "Delete failed", err.message);
  }
});

/* ================================================================ SNAPSHOTS */
async function loadSnapshots() {
  try {
    const r = await api("/v1/snapshots");
    S.snapshots = r.snapshots || [];
    $("#nav-snaps").textContent = S.snapshots.length;
    $("#snapsout").innerHTML = `<table class="data"><thead><tr>
      <th>Version</th><th>Hash</th><th class="r">Rules</th><th>Created</th><th>By</th>
      <th>Notes</th><th></th></tr></thead><tbody>` + S.snapshots.map(s => `<tr>
        <td><b class="mono">${esc(s.version)}</b>${s.active
          ? ' <span class="pill PUBLISHED">active</span>' : ""}</td>
        <td class="mono cap">${esc((s.hash || "").replace("sha256:", "").slice(0, 16))}…</td>
        <td class="r">${s.rule_count}</td>
        <td class="cap mono">${dshort(s.created_at)}</td>
        <td class="cap">${esc(s.created_by || "—")}</td>
        <td class="cap">${esc(s.notes || "")}</td>
        <td>${!s.active && S.me?.can?.write_rules
          ? `<button class="btn-secondary btn-sm" data-activate="${esc(s.version)}">Activate</button>`
          : ""}</td></tr>`).join("") + `</tbody></table>`;
    const opts = S.snapshots.map(s =>
      `<option value="${esc(s.version)}">${esc(s.version)}</option>`).join("");
    $("#diff-from").innerHTML = opts;
    $("#diff-to").innerHTML = opts;
    if (S.snapshots.length > 1) $("#diff-to").selectedIndex = 1;
  } catch (e) {
    $("#snapsout").innerHTML = `<div class="body">
      <div class="banner err"><b>Could not load snapshots</b>${esc(e.message)}</div></div>`;
  }
}
$("#snapsout").addEventListener("click", async e => {
  const v = e.target.dataset?.activate; if (!v) return;
  e.target.disabled = true;
  try {
    await api(`/v1/snapshots/${encodeURIComponent(v)}:activate`, { method: "POST" });
    banner("#historybanner", "ok", `Activated ${esc(v)}`,
      "Assessments now evaluate against this snapshot.");
    await boot(); loadSnapshots();
  } catch (err) {
    banner("#historybanner", "err", "Could not activate", err.message);
    e.target.disabled = false;
  }
});
$("#dodiff").onclick = async () => {
  const from = $("#diff-from").value, to = $("#diff-to").value;
  if (!from || !to) return;
  $("#diffout").innerHTML = '<span class="busy"></span>';
  try {
    const d = await api(`/v1/snapshots:diff?from_version=${encodeURIComponent(from)}` +
      `&to_version=${encodeURIComponent(to)}`);
    const list = (label, arr) => arr?.length
      ? `<div style="margin-top:var(--sp-3)"><span class="eyebrow">${label} (${arr.length})</span>
         <div class="mono cap" style="margin-top:var(--sp-1)">${
           arr.map(x => esc(typeof x === "string" ? x : x.id || JSON.stringify(x))).join("<br>")
         }</div></div>` : "";
    $("#diffout").innerHTML = `<div class="banner info"><b>${esc(from)} → ${esc(to)}</b>
      ${esc(d.summary || "")}</div>` + list("Added", d.added) + list("Removed", d.removed) +
      list("Changed", d.changed);
  } catch (e) {
    $("#diffout").innerHTML = `<div class="banner err"><b>Could not diff</b>${esc(e.message)}</div>`;
  }
};

/* ================================================================ INSIGHTS */
function barChart(rows, opts = {}) {
  if (!rows.length) return `<p class="cap">Nothing to show.</p>`;
  const max = Math.max(...rows.map(r => r.value)) || 1;
  const rowH = 24, padL = opts.padL ?? 118, w = 460;
  const h = rows.length * rowH + 8;
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img"
    aria-label="${esc(opts.title || "bar chart")}">` + rows.map((r, i) => {
      const y = i * rowH + 4;
      const bw = Math.max(2, (r.value / max) * (w - padL - 46));
      return `<text class="glabel" x="${padL - 8}" y="${y + 13}" text-anchor="end">${
          esc(r.label)}</text>
        <rect x="${padL}" y="${y + 3}" width="${bw}" height="14" rx="2"
          fill="${r.color || "var(--color-primary-500)"}"><title>${esc(r.label)}: ${r.value}</title></rect>
        <text class="gval" x="${padL + bw + 6}" y="${y + 14}">${esc(r.display ?? r.value)}</text>`;
    }).join("") + `</svg>`;
}

async function loadInsights() {
  const out = $("#insightsout");
  try {
    const d = await api("/v1/insights");
    const att = d.attention;
    const totalRules = d.rulepack.rule_count;

    const progRows = d.programs.map(p => ({
      label: p.program, value: p.rule_count, display: p.rule_count,
      color: PROGRAM_COLOR[p.program] || "var(--color-primary-500)",
    }));
    const cooRows = d.countries.top.map(c => ({
      label: c.coo, value: c.rules, display: c.rules, color: "var(--color-blue-sapphire-500)",
    }));
    const ACTION_COLOR = { DUTY: "var(--color-blue-500)", THRESHOLD: "var(--color-yellow-500)",
      EXEMPTION: "var(--color-green-500)", INTRANSIT: "var(--color-cyan-500)",
      SUPPRESSION: "var(--color-orange-500)" };
    const actionRows = Object.entries(d.action_mix).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({
      label: k, value: v, display: v, color: ACTION_COLOR[k] || "var(--color-blue-gray-400)" }));
    const slotRows = Object.entries(d.slot_mix).map(([k, v]) => ({
      label: "slot " + k, value: v, display: v, color: "var(--color-primary-400)" }));

    const conf = d.confidence_mix;
    const confTotal = Object.values(conf).reduce((a, b) => a + b, 0) || 1;
    const CONF_COLOR = { VERIFIED: "var(--color-green-500)", DRAFT: "var(--color-orange-500)",
      AI_EXTRACTED: "var(--color-purple-500)" };
    const confBar = `<div class="stackbar">` + Object.entries(conf).map(([k, v]) =>
      `<span style="width:${(v / confTotal * 100).toFixed(1)}%;background:${
        CONF_COLOR[k] || "var(--color-blue-gray-400)"}" title="${esc(k)}: ${v}">${
        v / confTotal > .12 ? v : ""}</span>`).join("") + `</div><div class="legend">` +
      Object.entries(conf).map(([k, v]) =>
        `<span><i style="background:${CONF_COLOR[k] || "var(--color-blue-gray-400)"}"></i>${
          esc(k.replace("_", " ").toLowerCase())} ${v}</span>`).join("") + `</div>`;

    const expired = d.expiring.expired, soon = d.expiring.soon;
    const expRow = e => `<tr><td><b class="mono" style="font-size:.857rem">${esc(e.rule_id)}</b>
        <div class="cap">${esc(e.label || "")}</div></td>
      <td class="mono">${esc(e.ch99 || "—")}</td>
      <td class="cap mono">${dshort(e.effective_end)}</td>
      <td class="r">${e.expired ? `<span class="pill expired">${Math.abs(e.days_remaining)}d ago</span>`
        : `<span class="pill DRAFT">in ${e.days_remaining}d</span>`}</td></tr>`;

    out.innerHTML = `
      <div class="card"><div class="body">
        <div class="summary">
          <div class="stat"><div class="k">Live rules</div><div class="v">${totalRules}</div>
            <div class="foot">snapshot ${esc(d.rulepack.version)}</div></div>
          <div class="stat"><div class="k">Programs</div><div class="v">${d.programs.length}</div>
            <div class="foot">${d.programs.filter(p => p.rule_count).length} with rules</div></div>
          <div class="stat"><div class="k">Origins covered</div>
            <div class="v">${d.countries.distinct}</div>
            <div class="foot">named in a rule predicate</div></div>
          <div class="stat ${att.expired_still_present ? "flagged" : "good"}">
            <div class="k">Lapsed rules</div><div class="v">${att.expired_still_present}</div>
            <div class="foot">window already closed</div></div>
        </div>
      </div></div>

      ${(att.draft_rules || att.ai_unreviewed || att.no_effective_start || expired.length)
        ? `<div class="card"><header><h5>Needs attention</h5></header><div class="body">
          <div class="grid4">
            <div class="stat ${att.draft_rules ? "flagged" : ""}"><div class="k">Draft</div>
              <div class="v">${att.draft_rules}</div>
              <div class="foot">awaiting a published scope</div></div>
            <div class="stat ${att.ai_unreviewed ? "bad" : ""}"><div class="k">AI unreviewed</div>
              <div class="v">${att.ai_unreviewed}</div>
              <div class="foot">cannot publish without a reviewer</div></div>
            <div class="stat ${att.no_effective_start ? "flagged" : ""}">
              <div class="k">No start date</div><div class="v">${att.no_effective_start}</div>
              <div class="foot">treated as always in effect</div></div>
            <div class="stat ${expired.length ? "flagged" : "good"}"><div class="k">Expired</div>
              <div class="v">${expired.length}</div>
              <div class="foot">kept for audit and refunds</div></div>
          </div>
          ${(expired.length || soon.length) ? `<div style="margin-top:var(--sp-4)">
            <span class="eyebrow">Effective windows closing or closed</span>
            <table class="data" style="margin-top:var(--sp-2)"><thead><tr>
              <th>Rule</th><th>Ch.99</th><th>Ends</th><th class="r">When</th>
            </tr></thead><tbody>${soon.map(expRow).join("")}${expired.map(expRow).join("")}
            </tbody></table>
            <p class="cap" style="margin-top:var(--sp-2)">A lapsed rule is not automatically a
              problem — historical rules stay in the pack so a post-entry audit can reproduce what
              was correct at filing. It is a problem when a successor program should have started
              and did not.</p></div>` : ""}
        </div></div>` : ""}

      <div class="chartgrid">
        <div class="card"><header><h5>Rules by program</h5></header>
          <div class="body">${barChart(progRows, { title: "Rules by program" })}
          <p class="cap" style="margin-top:var(--sp-2)">Programs are listed in evaluation order —
            which is dependency order, not reporting order. Section 232 runs first because both
            Section 122 and Section 301 forced labor carve it out.</p></div></div>
        <div class="card"><header><h5>Rules by action</h5></header>
          <div class="body">${barChart(actionRows, { padL: 96, title: "Rules by action" })}
          <p class="cap" style="margin-top:var(--sp-2)">Exemptions and suppressions outnumbering
            duties is normal and healthy — carve-outs are where the detail lives.</p></div></div>
        <div class="card"><header><h5>Top origins by rule count</h5></header>
          <div class="body">${barChart(cooRows, { padL: 52, title: "Rules by origin" })}</div></div>
        <div class="card"><header><h5>Reporting slot distribution</h5></header>
          <div class="body">${barChart(slotRows, { padL: 74, title: "Rules by reporting slot" })}
          <p class="cap" style="margin-top:var(--sp-2)">3.1 is Section 301, 3.2 Section 338,
            3.3 Section 232, 3.4 Section 201 (CSMS #69668138).</p></div></div>
        <div class="card"><header><h5>Confidence</h5></header>
          <div class="body">${confBar}
          <p class="cap" style="margin-top:var(--sp-3)">Draft rules are claim-gated: they fire only
            on an explicit importer claim, so the risk direction is overpayment rather than
            under-collection. They convert to verified when the annex scope is published.</p></div></div>
        <div class="card"><header><h5>Reference tables</h5></header>
          <div class="body"><dl class="kv">${Object.entries(d.table_counts).map(([k, v]) =>
            `<dt class="mono">${esc(k)}</dt><dd class="mono">${v}</dd>`).join("")}</dl>
          <p class="cap" style="margin-top:var(--sp-3)">Reference epoch ${d.reference_epoch}.
            ${d.table_counts.hts_rate < 500
              ? `<b>Only ${d.table_counts.hts_rate} HTSUS rate rows are loaded</b> — threshold
                 economies will report MISSING_COL1_FOR_THRESHOLD until the real table is uploaded.`
              : ""}</p></div></div>
      </div>

      <div class="card"><header><h5>Program detail</h5></header>
        <div class="body flush"><table class="data"><thead><tr>
          <th>Program</th><th>Authority</th><th class="r">Rules</th><th class="r">Ch.99</th>
          <th class="r">Origins</th><th>Slot</th></tr></thead><tbody>` +
        d.programs.map(p => `<tr><td><b class="mono">${esc(p.program)}</b>
            <div class="cap">${esc(p.label || "")}</div></td>
          <td class="cap">${esc(p.authority || "—")}</td>
          <td class="r">${p.rule_count}</td><td class="r">${p.headings}</td>
          <td class="r">${p.country_count}</td>
          <td><span class="slot p-${esc(p.program)}">${esc(p.stack_slot || "—")}</span></td>
        </tr>`).join("") + `</tbody></table></div></div>`;
  } catch (e) {
    out.innerHTML = `<div class="card"><div class="body">
      <div class="banner err"><b>Could not load insights</b>${esc(e.message)}</div></div></div>`;
  }
}

/* ================================================================ REFERENCE */
let refLoaded = false;
async function loadReference() {
  if (refLoaded) return;
  refLoaded = true;
  try {
    const r = await api("/v1/reference/rate-date-hierarchy");
    $("#ref-ratedate").innerHTML = `<p style="margin:0 0 var(--sp-2)">Resolved under
      ${esc(r.authority)} — never the entry date as a proxy. The branch used is shown on every
      result.</p><table>` + r.hierarchy.map(h =>
      `<tr><td class="mono">${esc(h.cite)}</td><td><b>${esc(h.branch)}</b><br>
        <span class="cap">${esc(h.explanation)}</span></td></tr>`).join("") + `</table>`;
  } catch (e) { $("#ref-ratedate").innerHTML = `<p class="cap">${esc(e.message)}</p>`; }
  try {
    const s = await api("/v1/reference/stacking-order");
    $("#ref-stacking").innerHTML = `<p class="cap" style="margin:0 0 var(--sp-2)">
      ${esc(s.authority)}</p><table>` + s.sequence.map(x =>
      `<tr><td class="mono">${esc(x.slot)}</td><td>${esc(x.line)}</td></tr>`).join("") +
      `</table><p class="cap" style="margin-top:var(--sp-2)">${esc(s.note || "")}</p>`;
  } catch (e) { $("#ref-stacking").innerHTML = `<p class="cap">${esc(e.message)}</p>`; }
  if (S.flags.length) {
    $("#ref-flags").innerHTML = `<table class="data"><thead><tr>
      <th>Flag</th><th>Kind</th><th>Programs</th><th>Headings it unlocks</th><th class="r">Rules</th>
      </tr></thead><tbody>` + S.flags.map(f => `<tr>
        <td><b class="mono" style="font-size:.857rem">${esc(f.flag)}</b>
          <div class="cap">${esc(f.label)}</div></td>
        <td class="cap">${esc(String(f.kind).replace(/_/g, " "))}</td>
        <td class="cap mono">${esc((f.programs || []).join(" "))}</td>
        <td class="cap mono">${esc((f.headings || []).slice(0, 6).join(" "))}${
          (f.headings || []).length > 6 ? " …" : ""}</td>
        <td class="r">${f.rule_count}</td></tr>`).join("") + `</tbody></table>`;
  } else {
    $("#ref-flags").innerHTML = `<div class="empty cap">No claim flags available.</div>`;
  }
}

/* ================================================================ HTS LIST / COVERAGE */
const Lookup = { fileB64: null, fileName: null, last: null, open: new Set(), inited: false };

function initLookup() {
  const d = $("#lookup-date");
  if (d && !d.value) d.value = new Date().toISOString().slice(0, 10);
  if (Lookup.inited) return;
  Lookup.inited = true;

  const drop = $("#lookup-drop");
  const file = $("#lookup-file");
  $("#lookup-browse").onclick = (e) => { e.stopPropagation(); file.click(); };
  drop.onclick = () => file.click();
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("drag"); };
  drop.ondragleave = () => drop.classList.remove("drag");
  drop.ondrop = (e) => {
    e.preventDefault(); drop.classList.remove("drag");
    const f = e.dataTransfer?.files?.[0];
    if (f) ingestLookupFile(f);
  };
  file.onchange = () => { const f = file.files?.[0]; if (f) ingestLookupFile(f); };

  $("#lookup-paste").oninput = () => updateLookupCount();
  $("#lookup-run").onclick = () => runLookup();
  $("#lookup-clear").onclick = () => {
    Lookup.fileB64 = Lookup.fileName = Lookup.last = null;
    Lookup.open = new Set();
    $("#lookup-paste").value = "";
    $("#lookup-file").value = "";
    drop.querySelector(".drop-title").textContent = "Drop Excel, CSV, or JSON";
    updateLookupCount();
    $("#lookup-export").hidden = true;
    $("#lookup-out").innerHTML = `<div class="empty"><h4>No codes yet</h4>
      <p class="cap" style="max-width:36ch;margin:0 auto">Add HTS codes on the left.</p></div>`;
    banner("#lookupbanner", null);
  };
  $("#lookup-sample").onclick = () => {
    $("#lookup-paste").value = `hts,coo
6203.42.0711,VN
8708.10.3050,CN
8703.23.01,JP
8704.23.01,DE
8702.10.31,KR
4407.11.00,CA
9401.61.4011,VN
8473.30.00,TW
8517.12.0050,DE`;
    $("#lookup-coo").value = "";
    updateLookupCount();
    runLookup();
  };
  $("#lookup-export").onclick = () => exportLookupCsv();
  updateLookupCount();
}

function updateLookupCount() {
  const text = ($("#lookup-paste").value || "").trim();
  const nText = text ? text.split(/\r?\n/).filter(l => l.trim() && !/^hts\b/i.test(l.trim())).length : 0;
  const n = Lookup.fileName ? "file" : nText;
  $("#lookup-count").textContent = Lookup.fileName
    ? Lookup.fileName
    : (nText === 1 ? "1 code" : `${nText} codes`);
  void n;
}

async function ingestLookupFile(f) {
  const name = f.name || "upload";
  const lower = name.toLowerCase();
  Lookup.fileName = name;
  if (/\.(xlsx|xls)$/.test(lower)) {
    const buf = await f.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    Lookup.fileB64 = btoa(bin);
    $("#lookup-paste").value = "";
  } else {
    Lookup.fileB64 = null;
    $("#lookup-paste").value = await f.text();
  }
  $("#lookup-drop").querySelector(".drop-title").textContent = `Ready: ${name}`;
  updateLookupCount();
  banner("#lookupbanner", "ok", "File loaded", `${name} — click Find applicable rules.`);
}

async function runLookup() {
  banner("#lookupbanner", null);
  const btn = $("#lookup-run");
  const was = btn.textContent;
  btn.disabled = true; btn.innerHTML = '<span class="busy"></span>';
  try {
    const body = {
      as_of: $("#lookup-date").value || undefined,
      default_coo: countryIsoFrom($("#lookup-coo")) || undefined,
      assume_cn_list3: false,
    };
    if (Lookup.fileB64) {
      body.xlsx_base64 = Lookup.fileB64;
      body.filename = Lookup.fileName;
    } else {
      body.text = ($("#lookup-paste").value || "").trim();
      if (!body.text) throw new Error("Paste HTS codes or drop a file first.");
    }
    Lookup.last = await api("/v1/hts:coverage", { method: "POST", body: JSON.stringify(body) });
    Lookup.open = new Set();
    renderLookup(Lookup.last);
    $("#lookup-export").hidden = false;
    const s = Lookup.last.summary || {};
    if (s.rows && s.missing_hts === s.rows) {
      banner("#lookupbanner", "err", "No HTS column found",
        "Every row came through blank. Use a sheet with a Primary HTS / HTS header " +
        "(title rows above the header are fine), or paste hts,coo CSV.");
    } else if (s.rows && s.in_table === 0) {
      banner("#lookupbanner", "warn", "None in baseline table",
        "HTS codes were read, but none match tariff-rules/data/hts_rates.json. " +
        "Re-import the classification workbook: cd backend && npm run import:hts");
    } else if (s.blocked) {
      banner("#lookupbanner", "err", "Some HTS codes need correction",
        `${s.blocked} not in the Column-1 table` +
        `${s.with_related ? ` | ${s.with_related} have suggested codes in Help / replacement` : ""}` +
        `${s.with_replacement ? ` | ${s.with_replacement} have mapped replacements` : ""}` +
        `. Click a suggested code to use it, or open the row for descriptions and USITC.`);
    } else if (s.ended) {
      banner("#lookupbanner", "warn", "Coverage ready",
        `${s.in_table}/${s.rows} in HTS table | ${s.ended} ended` +
        `${s.with_replacement ? ` | ${s.with_replacement} with replacement` : ""} | ${s.with_ch99} with Chapter 99.`);
    } else if (s.missing_coo) {
      banner("#lookupbanner", "ok", "Coverage ready",
        `${s.in_table}/${s.rows} in HTS table | ${s.missing_coo} missing origin - set Default origin or a COO column.`);
    } else {
      banner("#lookupbanner", "ok", "Coverage ready",
        `${s.in_table}/${s.rows} in HTS table | ${s.with_ch99} with Chapter 99.`);
    }
  } catch (e) {
    banner("#lookupbanner", "err", "Lookup failed", e.message);
  } finally {
    btn.disabled = false; btn.textContent = was;
  }
}

function renderLookup(R) {
  const rows = R.rows || [];
  const s = R.summary || {};
  if (!rows.length) {
    $("#lookup-out").innerHTML = `<div class="empty"><h4>No rows parsed</h4>
      <p class="cap">Check that the file has an <b>hts</b> column (or one code per line).</p></div>`;
    return;
  }
  const showPart = rows.some(r => r.part);
  const showSku = rows.some(r => r.sku);
  const colCount = 7 + (showPart ? 1 : 0) + (showSku ? 1 : 0);
  let html = `<div class="lookup-summary">
    <span class="pill">${s.rows ?? rows.length} codes</span>
    <span class="pill ok">${s.in_table ?? 0} in HTS table</span>
    <span class="pill">${s.with_ch99 ?? 0} with Ch.99</span>
    ${s.with_watch ? `<span class="pill">${s.with_watch} with watch flags</span>` : ""}
    ${s.with_pga ? `<span class="pill ok">${s.with_pga} PGA</span>` : ""}
    ${s.with_ad_cvd ? `<span class="pill warn">${s.with_ad_cvd} AD/CVD</span>` : ""}
    ${s.with_s232 ? `<span class="pill ok">${s.with_s232} on a 232 list</span>` : ""}
    ${s.needs_claim ? `<span class="pill warn">${s.needs_claim} need a claim</span>` : ""}
    ${s.blocked ? `<span class="pill warn">${s.blocked} need correction</span>` : ""}
    ${s.ended ? `<span class="pill warn">${s.ended} ended</span>` : ""}
    ${s.with_replacement ? `<span class="pill">${s.with_replacement} with replacement</span>` : ""}
    ${s.missing_coo ? `<span class="pill warn">${s.missing_coo} missing origin</span>` : ""}
    <span class="cap">as of ${esc(R.as_of)}</span>
  </div>`;
  html += `<div class="lookup-scroll"><table class="cov"><thead><tr>`;
  if (showPart) html += `<th>Part</th>`;
  if (showSku) html += `<th>SKU</th>`;
  html += `<th>HTS</th><th>Origin</th><th class="r">Col-1</th><th>Watch for</th><th>Help / replacement</th><th>Rules that apply</th><th>Ch.99</th>
  </tr></thead><tbody>`;
  rows.forEach((row, i) => {
    const miss = !row.in_table || row.error || row.blocked;
    const ended = row.window_status === "ended";
    const related = row.related_hts || [];
    const listRules = (row.rules || []).filter(r => r.program !== "base");
    const chips = listRules.length
      ? listRules
          .map(r => {
            const claim = r.status === "needs_claim" ? " · claim" : "";
            return `<span class="rule-chip ${esc(r.program)} ${esc(r.status || "")}">${esc(r.ch99 || r.label)}${claim}</span>`;
          })
          .join("")
      : miss
        ? `<span class="cap" style="color:var(--color-red-700)">No stack - fix HTS first</span>`
        : `<span class="cap">${row.coo ? "none beyond Col-1" : "add origin"}</span>`;
    const seq = miss ? "-" : ((row.ch99_sequence || []).join(" | ") || "-");
    const watchChips = renderHtsFlagChipsCompact(row.flags);
    const helpCell = row.replacement_hts_display || row.replacement_hts
      ? `<b class="mono">${esc(row.replacement_hts_display || row.replacement_hts)}</b>${
          row.replacement_col1_pct != null
            ? `<div class="cap">${esc(String(row.replacement_col1_pct))}%</div>`
            : ""
        }<div class="cap">Mapped replacement · click row for details</div>`
      : related.length
        ? `<div class="cov-suggest-inline">${related.slice(0, 3).map((r, ri) =>
            `<button type="button" class="linkish mono cov-suggest-hts" data-use-related="${i}" data-related-idx="${ri}" title="${esc(r.desc || r.rate_label || "")}">${esc(r.hts_display || r.hts)}</button>`
          ).join("")}${related.length > 3
            ? `<span class="cap">+${related.length - 3} more · click row</span>`
            : `<span class="cap">click row for descriptions</span>`}</div>`
        : miss
          ? `<span class="cap" style="color:var(--color-orange-700)">No table match · click row for USITC help</span>`
          : `<span class="cap">-</span>`;
    html += `<tr class="${miss ? "miss" : ""} ${ended ? "ended" : ""} ${Lookup.open.has(i) ? "open" : ""}" data-cov="${i}">`;
    if (showPart) html += `<td class="mono">${esc(row.part || "-")}</td>`;
    if (showSku) html += `<td class="mono">${esc(row.sku || "-")}</td>`;
    html += `<td><b class="mono">${esc(row.hts || "-")}</b>
        ${row.desc ? `<div class="cap">${esc(row.desc)}</div>` : ""}
        ${ended ? `<div class="cap" style="color:var(--color-orange-700)">Ended${row.ended_on ? ` ${esc(row.ended_on)}` : ""}</div>` : ""}
        ${miss ? `<div class="cap" style="color:var(--color-red-700)">Not in baseline table</div>` : ""}</td>
      <td class="mono">${esc(row.coo || "-")}</td>
      <td class="r mono">${row.col1_pct == null ? "-" : esc(String(row.col1_pct)) + "%"}</td>
      <td><div class="pillrow cov-watch">${watchChips || `<span class="cap">-</span>`}</div></td>
      <td>${helpCell}</td>
      <td><div class="rule-chips">${chips}</div></td>
      <td class="mono cap">${esc(seq)}</td>
    </tr>`;
    if (Lookup.open.has(i)) {
      html += `<tr class="open"><td colspan="${colCount}"><div class="cov-detail">`;
      if (row.part || row.sku) {
        html += `<p class="cap" style="margin:0 0 var(--sp-2)">`;
        if (row.part) html += `Part <b class="mono">${esc(row.part)}</b>`;
        if (row.part && row.sku) html += " | ";
        if (row.sku) html += `SKU <b class="mono">${esc(row.sku)}</b>`;
        html += `</p>`;
      }
      const watchDetail = renderHtsFlagPills(row.flags);
      if (watchDetail) {
        html += `<div class="cov-fix" style="margin:0 0 var(--sp-3)">
          <div class="eyebrow">Watch for</div>
          <div class="hts-notices">${watchDetail}</div>
        </div>`;
      }
      if (row.help || miss) {
        const title = row.help?.title || "This HTS needs correction";
        const summary = row.help?.summary
          || "This code is not in the Column-1 baseline table, so no duty or Chapter 99 stack is shown.";
        const steps = row.help?.steps || (row.notes || []);
        html += `<div class="banner err" style="margin:0 0 var(--sp-3)">
          <b>${esc(title)}</b>
          <div style="margin-top:var(--sp-1)">${esc(summary)}</div>
          ${steps.length ? `<ol class="cov-help-steps">${steps.map(s => `<li>${esc(s)}</li>`).join("")}</ol>` : ""}
          ${row.usitc_url
            ? `<div style="margin-top:var(--sp-2)"><a class="usitc-link" href="${esc(row.usitc_url)}" target="_blank" rel="noopener noreferrer">Look up on USITC</a></div>`
            : ""}
        </div>`;
      }
      if (row.replacement_hts) {
        html += `<div class="cov-fix" style="margin:0 0 var(--sp-3)">
          <div class="eyebrow">Mapped replacement</div>
          <p style="margin:var(--sp-1) 0"><b class="mono">${esc(row.replacement_hts_display || row.replacement_hts)}</b>
            ${row.replacement_desc ? `<span class="cap"> - ${esc(row.replacement_desc)}</span>` : ""}
            ${row.replacement_col1_pct != null ? `<span class="cap"> | Col-1 ${esc(String(row.replacement_col1_pct))}%</span>` : ""}
          </p>
          <button type="button" class="btn-secondary btn-sm" data-use-cov-hts="${i}">Use replacement in Duty stack</button>
        </div>`;
      }
      if (related.length) {
        html += `<div class="cov-fix" style="margin:0 0 var(--sp-3)">
          <div class="eyebrow">Active codes under the same 8-digit heading</div>
          <p class="cap" style="margin:var(--sp-1) 0 var(--sp-2)">Pick the statistical suffix that matches the part (description comes from the HTS table).</p>
          <table class="cov-related"><thead><tr><th>HTS</th><th>Description</th><th class="r">Col-1</th><th></th></tr></thead><tbody>
          ${related.map((r, ri) => `<tr>
            <td class="mono"><b>${esc(r.hts_display || r.hts)}</b></td>
            <td class="cap">${esc(r.desc || "-")}</td>
            <td class="r mono">${esc(r.rate_label || (r.col1_pct != null ? r.col1_pct + "%" : "-"))}</td>
            <td><button type="button" class="btn-secondary btn-sm" data-use-related="${i}" data-related-idx="${ri}">Use this HTS</button></td>
          </tr>`).join("")}
          </tbody></table>
        </div>`;
      }
      if (!(row.help || miss) || (row.rules || []).length) {
        const ruleRows = (row.rules || []);
        if (ruleRows.length) {
          html += `<div class="cov-fix" style="margin:0 0 var(--sp-3)">
            <div class="stack-layers-toolbar">
              <span class="eyebrow">Rules / Chapter 99</span>
              <button type="button" class="btn-ghost btn-sm" data-stack-expand-all>Expand all</button>
            </div>
            <div class="stack-layers" data-stack-layers>` +
            ruleRows.map((r, ri) => renderStackLayerRow({
              id: `cov-${i}-r${ri}`,
              slot: r.program || "",
              code: r.ch99 || (r.program === "base" ? (row.hts || "commodity") : (r.label || "")),
              program: r.program || "base",
              label: r.label || "",
              reason: r.reason || "",
              sourceRef: r.source_ref || "",
              rate: r.rate || "",
              duty: null,
              basisAmount: null,
              basisKind: r.status || "",
              basisFmt: null,
              suppressed: r.status === "info" && /suppress/i.test(r.reason || ""),
              exempt: false,
            })).join("") +
            `</div></div>`;
        } else if (!(row.help || miss)) {
          html += `<p class="cap">No rule rows.</p>`;
        }
      }
      const uni = row.s232_universe || {};
      const uniBits = [
        uni.passenger_vehicle && `Passenger vehicle ${uni.passenger_vehicle.matched_stem} → ${uni.passenger_vehicle.ch99}`,
        uni.mhdv_vehicle && `MHDV vehicle ${uni.mhdv_vehicle.matched_stem} → ${uni.mhdv_vehicle.ch99}`,
        uni.mhdv_bus && `Bus ${uni.mhdv_bus.matched_stem} → ${uni.mhdv_bus.ch99}`,
        uni.mhdv_part_list && `MHDV parts list ${uni.mhdv_part_list.matched_stem} (claim for ${uni.mhdv_part_list.ch99})`,
        uni.wood && `Wood ${uni.wood.bucket} ${uni.wood.matched_stem} → ${uni.wood.ch99}`,
        uni.semiconductor && `Semiconductor list ${uni.semiconductor.matched_stem} (claim for 9903.79.01)`,
        uni.auto_parts && `Auto-parts annex ${uni.auto_parts.matched_stem} → ${uni.auto_parts.ch99}`,
      ].filter(Boolean);
      if (uniBits.length) {
        html += `<div class="cov-fix" style="margin:var(--sp-3) 0 0">
          <div class="eyebrow">Section 232 lists</div>
          <ul class="cov-notes">${uniBits.map(b => `<li class="cap">${esc(b)}</li>`).join("")}</ul>
        </div>`;
      }
      if (row.notes?.length && !(row.help || miss)) {
        html += `<ul class="cov-notes">${row.notes.map(n => `<li class="cap">${esc(n)}</li>`).join("")}</ul>`;
      }
      if (!miss) {
        html += `<div class="actions" style="margin-top:var(--sp-2)">
          <button type="button" class="btn-secondary btn-sm" data-send-calc="${i}">Run stack for this HTS</button>
        </div>`;
      }
      html += `</div></td></tr>`;
    }
  });
  html += `</tbody></table></div>`;
  $("#lookup-out").innerHTML = html;
  bindHtsWatchRows($("#lookup-out"));
  bindStackLayers($("#lookup-out"));
  $$("#lookup-out [data-hts-watch-toggle]").forEach((btn) => {
    btn.addEventListener("click", (e) => e.stopPropagation());
  });
  $$("#lookup-out [data-stack-layer-toggle], #lookup-out [data-stack-expand-all]").forEach((btn) => {
    btn.addEventListener("click", (e) => e.stopPropagation());
  });
  $$("#lookup-out tr[data-cov]").forEach(tr => {
    tr.onclick = () => {
      const i = Number(tr.dataset.cov);
      if (Lookup.open.has(i)) Lookup.open.delete(i); else Lookup.open.add(i);
      renderLookup(Lookup.last);
    };
  });
  $$("#lookup-out [data-send-calc]").forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const row = Lookup.last.rows[Number(btn.dataset.sendCalc)];
      if (!row) return;
      $("#qc-hts").value = row.hts || "";
      $("#qc-coo").value = row.coo || $("#lookup-coo").value || "";
      $("#qc-value").value = $("#qc-value").value || formatEnteredValue(QC_DEFAULT_VALUE);
      syncEnteredValueField($("#qc-value"), { defaultIfEmpty: true });
      $("#qc-date").value = row.as_of || $("#lookup-date").value;
      show("calc");
      previewHtsMeta();
      const idBits = [row.part && `part ${row.part}`, row.sku && `SKU ${row.sku}`].filter(Boolean).join(" | ");
      banner("#calcbanner", "info", "From Coverage",
        `${row.hts}${idBits ? ` (${idBits})` : ""} loaded into Duty stack - add value if needed, then Run the stack.`);
    };
  });
  $$("#lookup-out [data-use-cov-hts]").forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const row = Lookup.last.rows[Number(btn.dataset.useCovHts)];
      if (!row?.replacement_hts) return;
      $("#qc-hts").value = row.replacement_hts_display || row.replacement_hts;
      $("#qc-coo").value = row.coo || $("#lookup-coo").value || "";
      $("#qc-date").value = row.as_of || $("#lookup-date").value;
      $("#qc-value").value = $("#qc-value").value || formatEnteredValue(QC_DEFAULT_VALUE);
      syncEnteredValueField($("#qc-value"), { defaultIfEmpty: true });
      show("calc");
      previewHtsMeta();
      banner("#calcbanner", "info", "Replacement loaded",
        `${row.hts} -> ${row.replacement_hts_display || row.replacement_hts} - confirm and run the stack.`);
    };
  });
  $$("#lookup-out [data-use-related]").forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const row = Lookup.last.rows[Number(btn.dataset.useRelated)];
      const rel = (row?.related_hts || [])[Number(btn.dataset.relatedIdx)];
      if (!rel) return;
      $("#qc-hts").value = rel.hts_display || rel.hts;
      $("#qc-coo").value = row.coo || $("#lookup-coo").value || "";
      $("#qc-date").value = row.as_of || $("#lookup-date").value;
      $("#qc-value").value = $("#qc-value").value || formatEnteredValue(QC_DEFAULT_VALUE);
      syncEnteredValueField($("#qc-value"), { defaultIfEmpty: true });
      show("calc");
      previewHtsMeta();
      banner("#calcbanner", "info", "Related HTS loaded",
        `${row.hts} -> ${rel.hts_display || rel.hts}${rel.desc ? ` (${rel.desc})` : ""} - confirm classification, then run the stack.`);
    };
  });
}

function exportLookupCsv() {
  if (!Lookup.last) return;
  const q = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = Lookup.last.rows || [];
  const showPart = rows.some(r => r.part);
  const showSku = rows.some(r => r.sku);
  const headers = [
    ...(showPart ? ["part"] : []),
    ...(showSku ? ["sku"] : []),
    "hts", "coo", "as_of", "in_table", "blocked", "window_status", "ended_on", "col1_pct", "desc",
    "pga", "ad", "cvd", "add_hts",
    "replacement_hts", "replacement_col1_pct", "related_hts", "ch99_sequence", "s232_lists", "rules", "notes", "help_steps",
  ];
  const lines = [headers.join(",")];
  rows.forEach(r => {
    const cols = [];
    if (showPart) cols.push(r.part);
    if (showSku) cols.push(r.sku);
    const f = r.flags || {};
    cols.push(
      r.hts, r.coo, r.as_of, r.in_table, r.blocked, r.window_status, r.ended_on, r.col1_pct, r.desc,
      (f.pga || []).join(" "),
      f.add ? "Y" : "",
      f.cvd ? "Y" : "",
      f.add_hts ? "Y" : "",
      r.replacement_hts_display || r.replacement_hts, r.replacement_col1_pct,
      (r.related_hts || []).map(x => x.hts_display || x.hts).join(" | "),
      (r.ch99_sequence || []).join(" "),
      (() => {
        const u = r.s232_universe || {};
        return [
          u.passenger_vehicle && `pv:${u.passenger_vehicle.ch99}`,
          u.mhdv_vehicle && `mhdv:${u.mhdv_vehicle.ch99}`,
          u.mhdv_bus && `bus:${u.mhdv_bus.ch99}`,
          u.mhdv_part_list && `mhdv_parts:${u.mhdv_part_list.ch99}`,
          u.wood && `wood:${u.wood.ch99}`,
          u.semiconductor && "semi:9903.79.01",
          u.auto_parts && `auto_parts:${u.auto_parts.ch99}`,
        ].filter(Boolean).join(" | ");
      })(),
      (r.rules || []).map(x => `${x.program}:${x.ch99 || "base"}@${x.rate}`).join(" | "),
      (r.notes || []).join(" | "),
      (r.help?.steps || []).join(" | "),
    );
    lines.push(cols.map(q).join(","));
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
  a.download = `hts-coverage-${Lookup.last.as_of || "export"}.csv`;
  a.click(); URL.revokeObjectURL(a.href);
}

/* ================================================================ RULE CHAT */
const Chat = {
  session: "web-" + Math.random().toString(36).slice(2, 10),
  messages: [],
  pending: [],
  inited: false,
};

function initChat() {
  refreshChatStatus();
  const canWrite = Boolean(S.me?.can?.write_rules || S.me?.can?.admin);
  $$("[data-admin-write]").forEach((el) => el.classList.toggle("hide", !canWrite));
  if (Chat.inited) { renderChatThread(); renderChatPending(); return; }
  Chat.inited = true;
  if (!Chat.messages.length) {
    Chat.messages.push({
      role: "assistant",
      content: "Ask about an HTS, origin, value, or pack rule — stacks run from the live tables, no API key required. " +
        (canWrite
          ? "Loading a new rule is still an admin preview if you want a draft upsert."
          : "Loading a new rule into the pack is coming later for admins."),
    });
  }
  renderChatThread();
  $("#chat-form").onsubmit = async (e) => {
    e.preventDefault();
    const input = $("#chat-input");
    const text = (input.value || "").trim();
    if (!text) return;
    input.value = "";
    await sendChat(text);
  };
  $$("#chat-suggest [data-prompt]").forEach(b => {
    b.onclick = () => sendChat(b.dataset.prompt);
  });
  const fab = $("#chat-fab");
  if (fab) fab.onclick = () => show("chat");
  renderChatPending();
}

async function refreshChatStatus() {
  const el = $("#chat-status");
  if (!el) return;
  try {
    const s = await api("/v1/chat/status");
    el.className = "chat-status ok";
    el.textContent = s.anthropic
      ? `Live pack · ${s.model}`
      : "Live pack — no API key";
  } catch (e) {
    el.className = "chat-status bad";
    el.textContent = "Chat API unreachable";
  }
}

function renderChatThread() {
  const thread = $("#chat-thread");
  if (!thread) return;
  thread.innerHTML = Chat.messages.map(m => `<div class="chat-msg ${esc(m.role)}">
    <div class="chat-bubble">${esc(m.content)}</div>
    <div class="meta">${m.role === "user" ? "You" : "KlearNow"}</div>
  </div>`).join("");
  thread.scrollTop = thread.scrollHeight;
}

function renderChatPending() {
  const box = $("#chat-pending");
  if (!box) return;
  const canWrite = Boolean(S.me?.can?.write_rules || S.me?.can?.admin);
  if (!canWrite || !Chat.pending.length) { box.hidden = true; box.innerHTML = ""; return; }
  box.hidden = false;
  box.innerHTML = Chat.pending.map(p => `<div class="pending-card">
    <div class="spacer"><span class="eyebrow">Pending pack write</span><br>
      <b>${esc(p.summary)}</b>
      <div class="cap mono">${esc(p.id)}</div></div>
    <button type="button" class="btn-primary btn-sm" data-apply="${esc(p.id)}">Apply</button>
    <button type="button" class="btn-ghost btn-sm" data-discard="${esc(p.id)}">Discard</button>
  </div>`).join("");
  $$("#chat-pending [data-apply]").forEach(b => {
    b.onclick = () => applyPending(b.dataset.apply);
  });
  $$("#chat-pending [data-discard]").forEach(b => {
    b.onclick = () => discardPending(b.dataset.discard);
  });
}

async function sendChat(text) {
  Chat.messages.push({ role: "user", content: text });
  renderChatThread();
  const send = $("#chat-send");
  const was = send.textContent;
  send.disabled = true; send.innerHTML = '<span class="busy"></span>';
  try {
    const history = Chat.messages
      .filter(m => m.role === "user" || m.role === "assistant")
      .map(m => ({ role: m.role, content: m.content }));
    const r = await api("/v1/chat", {
      method: "POST",
      body: JSON.stringify({ session_id: Chat.session, messages: history }),
    });
    Chat.messages.push({ role: "assistant", content: r.reply || "(empty)" });
    Chat.pending = r.pending || [];
    renderChatThread();
    renderChatPending();
    refreshChatStatus();
  } catch (e) {
    Chat.messages.push({ role: "assistant", content: "Error: " + e.message });
    renderChatThread();
  } finally {
    send.disabled = false; send.textContent = was;
  }
}

async function applyPending(id) {
  try {
    const r = await api("/v1/chat/apply", {
      method: "POST",
      body: JSON.stringify({ session_id: Chat.session, pending_id: id }),
    });
    Chat.pending = (Chat.pending || []).filter(p => p.id !== id);
    Chat.messages.push({
      role: "assistant",
      content: `Applied to live pack: ${r.applied?.summary || id}\n` +
        `Economies: ${r.result?.economies ?? "—"} · hash ${r.result?.rulepack?.hash || ""}`,
    });
    renderChatThread();
    renderChatPending();
    try {
      const h = await api("/v1/health");
      S.pack = h.rulepack;
      $("#packtext").innerHTML =
        `pack ${esc(h.rulepack.version)} &middot; ${h.rulepack.rules} rules ` +
        `<code>${esc((h.rulepack.hash || "").slice(0, 19))}…</code>`;
      $("#nav-rules").textContent = h.rulepack.rules;
    } catch { /* ignore */ }
  } catch (e) {
    Chat.messages.push({ role: "assistant", content: "Apply failed: " + e.message });
    renderChatThread();
  }
}

async function discardPending(id) {
  try {
    await api("/v1/chat/discard", {
      method: "POST",
      body: JSON.stringify({ session_id: Chat.session, pending_id: id }),
    });
  } catch { /* ignore */ }
  Chat.pending = (Chat.pending || []).filter(p => p.id !== id);
  renderChatPending();
}

/* ================================================================ CSMS */
const Csms = { inited: false, last: null };

function initCsms() {
  if (!Csms.inited) {
    Csms.inited = true;
    const q = $("#csms-q");
    const cams = $("#csms-cams");
    const refresh = $("#csms-refresh");
    if (q) q.oninput = debounceCsms;
    if (cams) cams.onchange = () => loadCsms();
    if (refresh) refresh.onclick = () => loadCsms({ refresh: true });
  }
  loadCsms();
}

let csmsTimer = 0;
function debounceCsms() {
  clearTimeout(csmsTimer);
  csmsTimer = setTimeout(() => loadCsms(), 280);
}

function fmtCsmsDate(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: "numeric", month: "short", day: "numeric",
      hour: "numeric", minute: "2-digit",
    });
  } catch { return iso; }
}

async function loadCsms(opts = {}) {
  const out = $("#csms-out");
  if (!out) return;
  const q = ($("#csms-q")?.value || "").trim();
  const cams = Boolean($("#csms-cams")?.checked);
  const refresh = Boolean(opts.refresh);
  out.innerHTML = `<div class="empty"><span class="busy"></span> Loading CSMS…</div>`;
  try {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (cams) params.set("include_cams", "true");
    if (refresh) params.set("refresh", "1");
    params.set("limit", "50");
    const data = await api("/v1/csms?" + params.toString());
    Csms.last = data;
    const sub = $("#csms-subscribe");
    if (sub && data.subscribe_url) sub.href = data.subscribe_url;
    banner("#csmsbanner", "", "", "");
    const rows = data.messages || [];
    if (!rows.length) {
      out.innerHTML = `<div class="empty">No CSMS in the recent GovDelivery feed${q ? " matching that search" : ""}.
        See the <a href="${esc(data.official_url || "https://www.cbp.gov/trade/automated/cargo-systems-messaging-service")}" target="_blank" rel="noopener noreferrer">official CSMS archive</a>.</div>`;
      return;
    }
    out.innerHTML = `<div class="csms-meta cap">Updated ${esc(fmtCsmsDate(data.fetched_at))} · ${rows.length} message${rows.length === 1 ? "" : "s"}
      · <a href="${esc(data.official_url)}" target="_blank" rel="noopener noreferrer">Official CSMS page</a></div>
      <table class="data sticky-head csms-table">
        <thead><tr><th>Number</th><th>Message</th><th>Published</th></tr></thead>
        <tbody>${rows.map((m) => `<tr>
          <td class="mono"><span class="csms-kind ${esc(m.kind)}">${esc((m.kind || "csms").toUpperCase())}</span>
            ${m.number ? esc(m.number) : "—"}</td>
          <td><a href="${esc(m.url)}" target="_blank" rel="noopener noreferrer">${esc(m.title)}</a>
            ${m.summary ? `<div class="cap csms-sum">${esc(m.summary)}</div>` : ""}</td>
          <td class="nowrap">${esc(fmtCsmsDate(m.published_at))}</td>
        </tr>`).join("")}</tbody>
      </table>`;
  } catch (e) {
    banner("#csmsbanner", "err", "Could not load CSMS", e.message);
    out.innerHTML = `<div class="empty">Open the
      <a href="https://www.cbp.gov/trade/automated/cargo-systems-messaging-service" target="_blank" rel="noopener noreferrer">official CSMS page</a>
      on CBP.gov.</div>`;
  }
}

/* ================================================================ ES-003 AUDIT */
const Es003 = {
  fileB64: null, fileName: null, ingest: null, last: null,
  inited: false, filter: "all", open: null,
};

const AUDIT_STATUS = {
  wrong_era: { lbl: "Wrong era", cls: "st-ex" },
  stack_gap: { lbl: "Missing Ch.99", cls: "st-ar" },
  needs_inputs: { lbl: "Needs inputs", cls: "st-rv" },
  extra: { lbl: "Extra / review", cls: "st-rv" },
  ieepa_cape: { lbl: "IEEPA CAPE", cls: "st-el" },
  out_of_range: { lbl: "Outside IEEPA window", cls: "st-or" },
  clean: { lbl: "Aligned for era", cls: "st-ok" },
  dead_program: { lbl: "Dead program", cls: "st-ex" },
};

function initEs003Audit() {
  if (Es003.inited) return;
  Es003.inited = true;
  const drop = $("#audit-drop");
  const file = $("#audit-file");
  if (!drop || !file) return;
  $("#audit-browse").onclick = (e) => { e.stopPropagation(); file.click(); };
  drop.onclick = () => file.click();
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("drag"); };
  drop.ondragleave = () => drop.classList.remove("drag");
  drop.ondrop = (e) => {
    e.preventDefault(); drop.classList.remove("drag");
    const f = e.dataTransfer?.files?.[0];
    if (f) ingestEs003File(f);
  };
  file.onchange = () => { const f = file.files?.[0]; if (f) ingestEs003File(f); };
  $("#audit-run").onclick = () => runEs003Audit();
  $("#audit-clear").onclick = () => clearEs003Audit();
  $("#audit-export").onclick = () => exportEs003Findings();
  const goto = $("#gotoaudit");
  if (goto) goto.onclick = () => show("calc");
}

async function ingestEs003File(f) {
  const name = f.name || "ES-003.xlsx";
  if (!/\.(xlsx|xls)$/i.test(name)) {
    banner("#auditbanner", "err", "Need an Excel file", "ACE ES-003 exports are .xlsx");
    return;
  }
  const buf = await f.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  Es003.fileB64 = btoa(bin);
  Es003.fileName = name;
  Es003.last = null;
  Es003.open = null;
  Es003.filter = "all";
  $("#audit-drop").querySelector(".drop-title").textContent = `Ready: ${name}`;
  $("#audit-run").disabled = false;
  $("#audit-export").hidden = true;
  $("#audit-out").innerHTML = `<div class="empty"><h4>Parsing…</h4></div>`;
  try {
    Es003.ingest = await api("/v1/es003/ingest", {
      method: "POST",
      body: JSON.stringify({ xlsx_base64: Es003.fileB64, filename: name }),
    });
    renderEs003StageA(Es003.ingest);
    banner("#auditbanner", "ok", "ES-003 loaded", Es003.ingest.message || name);
  } catch (e) {
    Es003.ingest = null;
    $("#audit-out").innerHTML = `<div class="empty"><h4>Could not parse</h4>
      <p class="cap">${esc(e.message)}</p></div>`;
    banner("#auditbanner", "err", "ES-003 parse failed", e.message);
  }
}

function renderEs003StageA(ing) {
  const m = ing.meta || {};
  $("#audit-out").innerHTML = `<div class="audit-stage-a">
    <div class="audit-stage-badge">Stage A · file loaded</div>
    <h4 class="audit-stage-title">${esc(ing.filename || "ES-003")}</h4>
    <p class="cap" style="margin:0 0 var(--sp-3)">${esc(ing.message || "")}</p>
    <div class="audit-metrics">
      <div class="audit-metric"><div class="k">Tariff rows</div><div class="v">${m.tariff_rows ?? "—"}</div></div>
      <div class="audit-metric"><div class="k">Entry lines</div><div class="v">${m.entry_lines ?? "—"}</div></div>
      <div class="audit-metric"><div class="k">Entries</div><div class="v">${m.entries ?? "—"}</div></div>
      <div class="audit-metric"><div class="k">Format</div><div class="v" style="font-size:1rem">${esc(m.format || "—")}</div></div>
      <div class="audit-metric"><div class="k">Entry dates</div><div class="v" style="font-size:.95rem">${esc(m.date_min || "—")} → ${esc(m.date_max || "—")}</div></div>
      <div class="audit-metric"><div class="k">IEEPA lines</div><div class="v">${m.ieepa_lines ?? "—"}</div></div>
    </div>
    <p class="cap" style="margin:var(--sp-3) 0 0">Analysis has <b>not</b> run yet — click <b>Run ES-003 audit</b> for Stage B
      (live stack + IEEPA CAPE window review by Entry Date).</p>
  </div>`;
}

function clearEs003Audit() {
  Es003.fileB64 = Es003.fileName = Es003.ingest = Es003.last = Es003.open = null;
  Es003.filter = "all";
  const file = $("#audit-file");
  if (file) file.value = "";
  const drop = $("#audit-drop");
  if (drop) drop.querySelector(".drop-title").textContent = "Drop ACE ES-003 Excel";
  $("#audit-run").disabled = true;
  $("#audit-export").hidden = true;
  $("#audit-out").innerHTML = `<div class="empty"><h4>No ES-003 yet</h4>
    <p class="cap" style="max-width:40ch;margin:0 auto">Drop an ACE ES-003 export — Stage A confirms parse, Stage B audits by Entry Date.</p></div>`;
  banner("#auditbanner", null);
}

async function runEs003Audit() {
  if (!Es003.fileB64) {
    banner("#auditbanner", "err", "No file", "Drop an ES-003 Excel first.");
    return;
  }
  const btn = $("#audit-run");
  const was = btn.textContent;
  btn.disabled = true; btn.innerHTML = '<span class="busy"></span>';
  try {
    Es003.last = await api("/v1/es003/audit", {
      method: "POST",
      body: JSON.stringify({
        xlsx_base64: Es003.fileB64,
        filename: Es003.fileName,
      }),
    });
    Es003.filter = "all";
    Es003.open = null;
    renderEs003Audit(Es003.last);
    const t = Es003.last.totals || {};
    banner("#auditbanner", "ok", "Stage B · audit complete",
      `${t.entries || 0} entries · ${t.finding_count || 0} findings` +
      (t.ieepa_duty
        ? ` · $${money(t.ieepa_duty)} IEEPA in CAPE window`
        : ""));
    $("#audit-export").hidden = !(Es003.last.findings || []).length;
  } catch (e) {
    banner("#auditbanner", "err", "ES-003 audit failed", e.message);
  } finally {
    btn.disabled = false; btn.textContent = was;
  }
}

function renderEs003Audit(R) {
  const out = $("#audit-out");
  if (!R) return;
  const t = R.totals || {};
  const byStatus = t.by_status || {};
  const entries = R.entries || [];
  const filtered = Es003.filter === "all"
    ? entries
    : entries.filter(e => e.status === Es003.filter);

  const chips = [
    ["all", "All", entries.length],
    ["wrong_era", AUDIT_STATUS.wrong_era.lbl, byStatus.wrong_era || 0],
    ["stack_gap", AUDIT_STATUS.stack_gap.lbl, byStatus.stack_gap || 0],
    ["needs_inputs", AUDIT_STATUS.needs_inputs.lbl, byStatus.needs_inputs || 0],
    ["extra", AUDIT_STATUS.extra.lbl, byStatus.extra || 0],
    ["clean", AUDIT_STATUS.clean.lbl, byStatus.clean || 0],
    ["ieepa_cape", AUDIT_STATUS.ieepa_cape.lbl, byStatus.ieepa_cape || 0],
  ];

  const eras = t.era_counts || {};
  const eraBits = [
    eras.sec_122 ? `${eras.sec_122} Sec 122 era` : null,
    eras.s301fl ? `${eras.s301fl} 301-FL era` : null,
    eras.ieepa ? `${eras.ieepa} IEEPA era` : null,
  ].filter(Boolean).join(" · ");

  let html = `<div class="audit-review">
    <div class="audit-stage-badge">Stage B · analysis by Entry Date</div>
    <p class="cap" style="margin:0 0 var(--sp-3)">Timeline: IEEPA ended 2026-02-23 → Sec 122 through 2026-07-23 → 301-FL from 2026-07-24.
      ${eraBits ? `<b>${esc(eraBits)}</b> in this file.` : ""}</p>
    <div class="audit-metrics">
      <div class="audit-metric accent"><div class="k">Aligned for era</div>
        <div class="v">${t.clean_entries || 0}</div>
        <div class="cap">ES-003 computable stack matches</div></div>
      <div class="audit-metric warn"><div class="k">Wrong era / missing</div>
        <div class="v">${(t.wrong_era_entries || 0) + (t.stack_gap_entries || 0)}</div>
        <div class="cap">${t.wrong_era_entries || 0} wrong · ${t.stack_gap_entries || 0} missing</div></div>
      <div class="audit-metric"><div class="k">Needs inputs</div>
        <div class="v">${t.needs_inputs_entries || 0}</div>
        <div class="cap">metals content not on ES-003</div></div>
      <div class="audit-metric"><div class="k">Entries</div><div class="v">${t.entries || 0}</div>
        <div class="cap">${t.entry_lines || 0} lines · $${money(t.entered_value)} value</div></div>
    </div>
    <div class="pillrow audit-filters" style="margin:var(--sp-3) 0">
      ${chips.map(([k, label, n]) =>
        `<button type="button" class="pill filter-pill ${Es003.filter === k ? "active" : ""}" data-audit-filter="${k}">${esc(label)} · ${n}</button>`
      ).join("")}
    </div>`;

  if (!filtered.length) {
    html += `<div class="empty" style="padding:var(--sp-5)"><h4>No entries in this filter</h4></div>`;
  } else {
    html += `<div class="audit-entry-list">`;
    for (const e of filtered.slice(0, 200)) {
      const st = AUDIT_STATUS[e.status] || { lbl: e.status_label || e.status, cls: "st-rv" };
      const open = Es003.open === e.id;
      html += `<article class="audit-entry ${open ? "open" : ""}" data-entry="${esc(e.id)}">
        <button type="button" class="audit-entry-head" data-toggle-entry="${esc(e.id)}">
          <span class="st-badge ${st.cls}">${esc(st.lbl)}</span>
          <span class="mono entry-id">${esc(e.id)}</span>
          <span class="cap">${esc(e.entry_date || "—")} · ${esc(e.filing_era_label || "")}</span>
          <span class="cap">${esc((e.countries || []).join(", ") || "—")}</span>
          <span class="metric-inline">${e.line_count} lines · ${e.finding_count} findings</span>
          <span class="chev" aria-hidden="true">${open ? "▾" : "▸"}</span>
        </button>`;
      if (open) {
        html += `<div class="audit-entry-body">
          <p class="guidance">${esc(e.guidance || "")}</p>
          <div class="audit-entry-meta cap">
            Port ${esc(e.port || "—")} · type ${esc(e.entry_type || "—")} ·
            importer ${esc(e.importer || "—")} ·
            entered $${money(e.entered_value)} ·
            filed duty $${money(e.filed_duty_total)} ·
            computed $${money(e.computed_duty)}
          </div>
          <div class="grid2" style="gap:var(--sp-3);margin:var(--sp-3) 0">
            <div><div class="eyebrow">Filed Ch.99</div>
              <div class="mono wrap">${esc((e.filed_ch99 || []).join(" ") || "—")}</div></div>
            <div><div class="eyebrow">Computed Ch.99</div>
              <div class="mono wrap">${esc((e.computed_ch99 || []).join(" ") || "—")}</div></div>
          </div>`;
        if ((e.observations || []).length) {
          html += `<div class="obs-list">`;
          for (const o of e.observations) {
            html += `<div class="obs obs-${esc(o.sev)}">
              <div class="obs-lbl">${esc(o.lbl)}</div>
              <div class="obs-det">${esc(o.det)}</div>
            </div>`;
          }
          html += `</div>`;
        }
        if ((e.lines || []).length) {
          html += `<table class="data audit-lines"><thead><tr>
            <th>#</th><th>HTS</th><th>COO</th><th class="r">Value</th>
            <th>Filed</th><th>Computed</th>
          </tr></thead><tbody>`;
          for (const L of e.lines) {
            html += `<tr>
              <td class="mono">${esc(L.line_number || "")}</td>
              <td class="mono">${esc(L.hts || "")}</td>
              <td>${esc(L.coo || "")}</td>
              <td class="r">$${money(L.entered_value)}</td>
              <td class="mono cap">${esc((L.filed_ch99 || []).join(" ") || "—")}</td>
              <td class="mono cap">${esc((L.computed_ch99 || []).join(" ") || "—")}</td>
            </tr>`;
          }
          html += `</tbody></table>`;
        }
        html += `</div>`;
      }
      html += `</article>`;
    }
    html += `</div>`;
    if (filtered.length > 200) {
      html += `<p class="cap">Showing 200 of ${filtered.length} — narrow the filter or export CSV.</p>`;
    }
  }
  html += `</div>`;
  out.innerHTML = html;

  out.querySelectorAll("[data-audit-filter]").forEach(btn => {
    btn.onclick = () => {
      Es003.filter = btn.dataset.auditFilter;
      renderEs003Audit(Es003.last);
    };
  });
  out.querySelectorAll("[data-toggle-entry]").forEach(btn => {
    btn.onclick = () => {
      const id = btn.dataset.toggleEntry;
      Es003.open = Es003.open === id ? null : id;
      renderEs003Audit(Es003.last);
    };
  });
}

function exportEs003Findings() {
  if (!Es003.last?.findings?.length) return;
  const lines = [["severity", "category", "entry_number", "entry_date", "hts", "coo", "line_id", "message", "remediation", "duty_impact"]];
  for (const f of Es003.last.findings) {
    lines.push([
      f.severity, f.category, f.entry_number, f.entry_date, f.hts, f.coo,
      f.line_id, f.message, f.remediation || "", f.duty_impact ?? "",
    ].map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","));
  }
  const blob = new Blob([[lines[0].join(",")].concat(lines.slice(1)).join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `es003-audit-${(Es003.fileName || "export").replace(/\.[^.]+$/, "")}.csv`;
  a.click();
}

const fabBoot = $("#chat-fab");
if (fabBoot) fabBoot.onclick = () => show("chat");

boot();
