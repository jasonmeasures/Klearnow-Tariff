/**
 * Combobox of matching 10-digit HTS statistical lines as the user types.
 */
export function bindHtsSuggest(input, opts = {}) {
  if (!input || input.dataset.htsSuggestBound === "1") return;
  input.dataset.htsSuggestBound = "1";
  input.setAttribute("autocomplete", "off");
  input.setAttribute("spellcheck", "false");
  if (!input.title) {
    input.title = "Type 4+ digits to search 10-digit HTS lines";
  }

  const wrap = document.createElement("div");
  wrap.className = "country-wrap hts-wrap";
  input.parentNode.insertBefore(wrap, input);
  wrap.appendChild(input);

  const list = document.createElement("ul");
  list.className = "country-list";
  list.hidden = true;
  list.setAttribute("role", "listbox");
  wrap.appendChild(list);

  let active = -1;
  let open = false;
  let items = [];
  let seq = 0;
  let timer = null;

  const hide = () => {
    list.hidden = true;
    open = false;
    active = -1;
  };

  const esc = (s) => String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  const render = (hits) => {
    items = Array.isArray(hits) ? hits : [];
    list.innerHTML = "";
    items.forEach((hit, i) => {
      const li = document.createElement("li");
      li.setAttribute("role", "option");
      li.dataset.hts = hit.hts_display || hit.hts;
      const desc = hit.desc ? `<span class="hts-suggest-desc">${esc(hit.desc)}</span>` : "";
      const rate = hit.rate_label
        ? `<span class="hts-suggest-rate">${esc(hit.rate_label)}</span>`
        : "";
      li.innerHTML = `<span class="mono">${esc(hit.hts_display || hit.hts)}</span>${desc}${rate}`;
      if (i === active) li.classList.add("active");
      li.addEventListener("mousedown", (e) => {
        e.preventDefault();
        commit(li.dataset.hts);
      });
      list.appendChild(li);
    });
    list.hidden = !items.length;
    open = items.length > 0;
  };

  const commit = (hts) => {
    if (!hts) return;
    input.value = hts;
    seq += 1;
    hide();
    opts.onCommit?.(hts);
  };

  const refresh = async () => {
    const q = (input.value || "").trim();
    const digits = q.replace(/\D/g, "");
    if (digits.length < 4) {
      hide();
      return;
    }
    const my = ++seq;
    try {
      const hits = await opts.fetchSuggestions?.(q);
      if (my !== seq) return;
      render(hits || []);
    } catch {
      if (my !== seq) return;
      hide();
    }
  };

  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(refresh, opts.delayMs || 180);
  };

  input.addEventListener("focus", () => {
    if ((input.value || "").replace(/\D/g, "").length >= 4) refresh();
  });
  input.addEventListener("input", schedule);

  input.addEventListener("keydown", (e) => {
    const rows = [...list.querySelectorAll("li")];
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) refresh();
      active = Math.min(active + 1, rows.length - 1);
      rows.forEach((li, i) => li.classList.toggle("active", i === active));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      active = Math.max(active - 1, 0);
      rows.forEach((li, i) => li.classList.toggle("active", i === active));
    } else if (e.key === "Enter") {
      if (open && active >= 0 && rows[active]) {
        e.preventDefault();
        commit(rows[active].dataset.hts);
      }
    } else if (e.key === "Tab") {
      if (open && active >= 0 && rows[active]) {
        commit(rows[active].dataset.hts);
      } else if (open && rows.length === 1) {
        commit(rows[0].dataset.hts);
      }
    } else if (e.key === "Escape") {
      hide();
    }
  });

  input.addEventListener("blur", () => {
    setTimeout(hide, 120);
  });
}
