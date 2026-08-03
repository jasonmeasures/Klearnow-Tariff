/**
 * ISO-2 countries for origin / melt-pour pickers.
 * Trade-heavy first; full UN M49-ish coverage for name search.
 */
export const COUNTRIES = [
  ["AF", "Afghanistan"], ["AL", "Albania"], ["DZ", "Algeria"], ["AD", "Andorra"],
  ["AO", "Angola"], ["AG", "Antigua and Barbuda"], ["AR", "Argentina"], ["AM", "Armenia"],
  ["AU", "Australia"], ["AT", "Austria"], ["AZ", "Azerbaijan"], ["BS", "Bahamas"],
  ["BH", "Bahrain"], ["BD", "Bangladesh"], ["BB", "Barbados"], ["BY", "Belarus"],
  ["BE", "Belgium"], ["BZ", "Belize"], ["BJ", "Benin"], ["BT", "Bhutan"],
  ["BO", "Bolivia"], ["BA", "Bosnia and Herzegovina"], ["BW", "Botswana"], ["BR", "Brazil"],
  ["BN", "Brunei"], ["BG", "Bulgaria"], ["BF", "Burkina Faso"], ["BI", "Burundi"],
  ["CV", "Cabo Verde"], ["KH", "Cambodia"], ["CM", "Cameroon"], ["CA", "Canada"],
  ["CF", "Central African Republic"], ["TD", "Chad"], ["CL", "Chile"], ["CN", "China"],
  ["CO", "Colombia"], ["KM", "Comoros"], ["CG", "Congo"], ["CD", "Congo (DRC)"],
  ["CR", "Costa Rica"], ["CI", "Côte d'Ivoire"], ["HR", "Croatia"], ["CU", "Cuba"],
  ["CY", "Cyprus"], ["CZ", "Czechia"], ["DK", "Denmark"], ["DJ", "Djibouti"],
  ["DM", "Dominica"], ["DO", "Dominican Republic"], ["EC", "Ecuador"], ["EG", "Egypt"],
  ["SV", "El Salvador"], ["GQ", "Equatorial Guinea"], ["ER", "Eritrea"], ["EE", "Estonia"],
  ["SZ", "Eswatini"], ["ET", "Ethiopia"], ["FJ", "Fiji"], ["FI", "Finland"],
  ["FR", "France"], ["GA", "Gabon"], ["GM", "Gambia"], ["GE", "Georgia"],
  ["DE", "Germany"], ["GH", "Ghana"], ["GR", "Greece"], ["GD", "Grenada"],
  ["GT", "Guatemala"], ["GN", "Guinea"], ["GW", "Guinea-Bissau"], ["GY", "Guyana"],
  ["HT", "Haiti"], ["HN", "Honduras"], ["HU", "Hungary"], ["IS", "Iceland"],
  ["IN", "India"], ["ID", "Indonesia"], ["IR", "Iran"], ["IQ", "Iraq"],
  ["IE", "Ireland"], ["IL", "Israel"], ["IT", "Italy"], ["JM", "Jamaica"],
  ["JP", "Japan"], ["JO", "Jordan"], ["KZ", "Kazakhstan"], ["KE", "Kenya"],
  ["KI", "Kiribati"], ["KP", "Korea (North)"], ["KR", "Korea (South)"], ["KW", "Kuwait"],
  ["KG", "Kyrgyzstan"], ["LA", "Laos"], ["LV", "Latvia"], ["LB", "Lebanon"],
  ["LS", "Lesotho"], ["LR", "Liberia"], ["LY", "Libya"], ["LI", "Liechtenstein"],
  ["LT", "Lithuania"], ["LU", "Luxembourg"], ["MG", "Madagascar"], ["MW", "Malawi"],
  ["MY", "Malaysia"], ["MV", "Maldives"], ["ML", "Mali"], ["MT", "Malta"],
  ["MH", "Marshall Islands"], ["MR", "Mauritania"], ["MU", "Mauritius"], ["MX", "Mexico"],
  ["FM", "Micronesia"], ["MD", "Moldova"], ["MC", "Monaco"], ["MN", "Mongolia"],
  ["ME", "Montenegro"], ["MA", "Morocco"], ["MZ", "Mozambique"], ["MM", "Myanmar"],
  ["NA", "Namibia"], ["NR", "Nauru"], ["NP", "Nepal"], ["NL", "Netherlands"],
  ["NZ", "New Zealand"], ["NI", "Nicaragua"], ["NE", "Niger"], ["NG", "Nigeria"],
  ["MK", "North Macedonia"], ["NO", "Norway"], ["OM", "Oman"], ["PK", "Pakistan"],
  ["PW", "Palau"], ["PA", "Panama"], ["PG", "Papua New Guinea"], ["PY", "Paraguay"],
  ["PE", "Peru"], ["PH", "Philippines"], ["PL", "Poland"], ["PT", "Portugal"],
  ["QA", "Qatar"], ["RO", "Romania"], ["RU", "Russia"], ["RW", "Rwanda"],
  ["KN", "Saint Kitts and Nevis"], ["LC", "Saint Lucia"],
  ["VC", "Saint Vincent and the Grenadines"], ["WS", "Samoa"], ["SM", "San Marino"],
  ["ST", "Sao Tome and Principe"], ["SA", "Saudi Arabia"], ["SN", "Senegal"],
  ["RS", "Serbia"], ["SC", "Seychelles"], ["SL", "Sierra Leone"], ["SG", "Singapore"],
  ["SK", "Slovakia"], ["SI", "Slovenia"], ["SB", "Solomon Islands"], ["SO", "Somalia"],
  ["ZA", "South Africa"], ["SS", "South Sudan"], ["ES", "Spain"], ["LK", "Sri Lanka"],
  ["SD", "Sudan"], ["SR", "Suriname"], ["SE", "Sweden"], ["CH", "Switzerland"],
  ["SY", "Syria"], ["TW", "Taiwan"], ["TJ", "Tajikistan"], ["TZ", "Tanzania"],
  ["TH", "Thailand"], ["TL", "Timor-Leste"], ["TG", "Togo"], ["TO", "Tonga"],
  ["TT", "Trinidad and Tobago"], ["TN", "Tunisia"], ["TR", "Türkiye"],
  ["TM", "Turkmenistan"], ["TV", "Tuvalu"], ["UG", "Uganda"], ["UA", "Ukraine"],
  ["AE", "United Arab Emirates"], ["GB", "United Kingdom"], ["US", "United States"],
  ["UY", "Uruguay"], ["UZ", "Uzbekistan"], ["VU", "Vanuatu"], ["VA", "Vatican City"],
  ["VE", "Venezuela"], ["VN", "Vietnam"], ["YE", "Yemen"], ["ZM", "Zambia"],
  ["ZW", "Zimbabwe"], ["XK", "Kosovo"], ["EU", "European Union"], ["XX", "Unknown / N/A"],
];

const BY_CODE = new Map(COUNTRIES.map(([c, n]) => [c, n]));
const BY_NAME = new Map(COUNTRIES.map(([c, n]) => [n.toLowerCase(), c]));

/** Resolve typed value → ISO-2, or "" if unresolved. */
export function resolveCountryIso(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  const upper = s.toUpperCase();
  // "CN", "CN — China", "CN - China"
  const codePref = upper.match(/^([A-Z]{2})\b/);
  if (codePref && BY_CODE.has(codePref[1])) return codePref[1];
  const byName = BY_NAME.get(s.toLowerCase());
  if (byName) return byName;
  // partial unique name match
  const hits = COUNTRIES.filter(([, n]) => n.toLowerCase().startsWith(s.toLowerCase()));
  if (hits.length === 1) return hits[0][0];
  const includes = COUNTRIES.filter(([, n]) => n.toLowerCase().includes(s.toLowerCase()));
  if (includes.length === 1) return includes[0][0];
  return "";
}

export function formatCountry(iso) {
  const c = String(iso || "").toUpperCase();
  if (!c || !BY_CODE.has(c)) return c || "";
  return `${c} — ${BY_CODE.get(c)}`;
}

export function searchCountries(q, limit = 12) {
  const s = String(q || "").trim().toLowerCase();
  if (!s) {
    // frequent trade partners first when empty/opening
    const prefer = ["CN", "MX", "CA", "VN", "JP", "KR", "DE", "TW", "IN", "TH", "US", "GB"];
    return prefer.map((c) => [c, BY_CODE.get(c)]).filter((x) => x[1]);
  }
  const out = [];
  for (const [c, n] of COUNTRIES) {
    if (c.toLowerCase().startsWith(s) || n.toLowerCase().includes(s)) {
      out.push([c, n]);
      if (out.length >= limit) break;
    }
  }
  return out;
}

/**
 * Enhance an <input> into a country combobox.
 * Accepts ISO-2 (tab commits) or country name (dropdown select).
 * Stores ISO-2 on input.dataset.iso; display may be "CN — China".
 */
export function bindCountryField(input, opts = {}) {
  if (!input || input.dataset.countryBound === "1") return;
  input.dataset.countryBound = "1";
  input.removeAttribute("maxlength");
  input.classList.add("country-input");
  input.setAttribute("autocomplete", "off");
  input.setAttribute("spellcheck", "false");
  if (!input.title) {
    input.title = opts.title || "Type ISO-2 (e.g. CN) and Tab, or search country name";
  }

  const wrap = document.createElement("div");
  wrap.className = "country-wrap";
  input.parentNode.insertBefore(wrap, input);
  wrap.appendChild(input);

  const list = document.createElement("ul");
  list.className = "country-list";
  list.hidden = true;
  list.setAttribute("role", "listbox");
  wrap.appendChild(list);

  let active = -1;
  let open = false;

  const commit = (iso, advance) => {
    if (!iso) return;
    input.dataset.iso = iso;
    input.value = formatCountry(iso);
    hide();
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    if (advance) {
      // Tab naturally moves focus; for Enter move to next focusable
      const form = input.closest("form, .quick-card, .view, body");
      const focusables = [...(form || document).querySelectorAll(
        'input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])',
      )].filter((el) => el.offsetParent !== null || el === input);
      const idx = focusables.indexOf(input);
      if (idx >= 0 && idx < focusables.length - 1) focusables[idx + 1].focus();
    }
  };

  const hide = () => {
    list.hidden = true;
    open = false;
    active = -1;
  };

  const render = (items) => {
    list.innerHTML = "";
    items.forEach(([c, n], i) => {
      const li = document.createElement("li");
      li.setAttribute("role", "option");
      li.dataset.iso = c;
      li.innerHTML = `<span class="mono">${c}</span> <span>${n}</span>`;
      if (i === active) li.classList.add("active");
      li.addEventListener("mousedown", (e) => {
        e.preventDefault();
        commit(c, false);
      });
      list.appendChild(li);
    });
    list.hidden = !items.length;
    open = items.length > 0;
  };

  const refresh = () => {
    const q = input.value.trim();
    // If already committed display "XX — Name", search on the raw query part
    const search = q.includes("—") ? q.split("—")[0].trim() : q;
    render(searchCountries(search));
  };

  input.addEventListener("focus", () => {
    refresh();
  });

  input.addEventListener("input", () => {
    delete input.dataset.iso;
    const t = input.value.trim().toUpperCase();
    // Autocapitalize 2-letter typing without blocking names
    if (/^[a-z]{1,2}$/i.test(input.value.trim()) && !input.value.includes(" ")) {
      input.value = t;
    }
    refresh();
  });

  input.addEventListener("keydown", (e) => {
    const items = [...list.querySelectorAll("li")];
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) refresh();
      active = Math.min(active + 1, items.length - 1);
      items.forEach((li, i) => li.classList.toggle("active", i === active));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      active = Math.max(active - 1, 0);
      items.forEach((li, i) => li.classList.toggle("active", i === active));
    } else if (e.key === "Enter") {
      if (open && active >= 0 && items[active]) {
        e.preventDefault();
        commit(items[active].dataset.iso, true);
      } else {
        const iso = resolveCountryIso(input.value);
        if (iso) {
          e.preventDefault();
          commit(iso, true);
        }
      }
    } else if (e.key === "Tab") {
      const iso =
        (open && active >= 0 && items[active]?.dataset.iso) ||
        resolveCountryIso(input.value) ||
        (items.length === 1 ? items[0].dataset.iso : "") ||
        (items[0] && /^[A-Za-z]{2}$/.test(input.value.trim()) ? items[0].dataset.iso : "");
      if (iso) {
        // Let Tab move focus; commit value first
        input.dataset.iso = iso;
        input.value = formatCountry(iso);
        hide();
      }
    } else if (e.key === "Escape") {
      hide();
    }
  });

  input.addEventListener("blur", () => {
    setTimeout(() => {
      const iso = resolveCountryIso(input.value) || input.dataset.iso;
      if (iso) {
        input.dataset.iso = iso;
        input.value = formatCountry(iso);
      } else if (input.value.trim()) {
        input.classList.add("country-invalid");
      } else {
        delete input.dataset.iso;
        input.classList.remove("country-invalid");
      }
      hide();
    }, 120);
  });

  // Seed from existing 2-letter value
  const seed = resolveCountryIso(input.value);
  if (seed) {
    input.dataset.iso = seed;
    input.value = formatCountry(seed);
  }
}

/** Read ISO-2 from a bound (or plain) country input. */
export function countryIsoFrom(el) {
  if (!el) return "";
  return (el.dataset.iso || resolveCountryIso(el.value) || "").toUpperCase();
}
