#!/usr/bin/env node
/**
 * Render RULES.md and USER_MANUAL.md to self-contained HTML.
 * Markdown remains the source of truth — re-run after edits:
 *   node scripts/render-docs.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const DOCS = [
  {
    src: "tariff-rules/docs/RULES.md",
    dest: "tariff-rules/docs/RULES.html",
    title: "KlearNow Tariff Stacking Rules — Review Pack",
    eyebrow: "Rules review · developers & compliance",
    companion: { href: "../../docs/USER_MANUAL.html", label: "User manual" },
  },
  {
    src: "docs/USER_MANUAL.md",
    dest: "docs/USER_MANUAL.html",
    title: "KlearNow Tariff — User Manual",
    eyebrow: "Operator guide",
    companion: { href: "../tariff-rules/docs/RULES.html", label: "Rules review pack" },
  },
];

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function slugify(text) {
  return String(text)
    .replace(/<[^>]+>/g, "")
    .toLowerCase()
    .replace(/&[a-z]+;/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function inline(raw) {
  let s = escapeHtml(raw);
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
    let url = href.replace(/&amp;/g, "&");
    url = url.replace(/\.md(#[^)]*)?$/i, (_, hash) => `.html${hash || ""}`);
    const ext = url.startsWith("http") ? ` target="_blank" rel="noopener noreferrer"` : "";
    return `<a href="${escapeHtml(url)}"${ext}>${label}</a>`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,]|$)/g, "$1<em>$2</em>");
  return s;
}

function parseTable(lines) {
  const rows = lines
    .map((l) => l.trim())
    .filter((l) => l.startsWith("|"))
    .map((l) =>
      l
        .replace(/^\||\|$/g, "")
        .split("|")
        .map((c) => c.trim()),
    );
  if (rows.length < 2) return null;
  const header = rows[0];
  const body = rows.slice(2);
  const isSep = (r) => r.every((c) => /^:?-{3,}:?$/.test(c.replace(/\s/g, "")));
  const data = rows[1] && isSep(rows[1]) ? body : rows.slice(1);
  const th = header.map((c) => `<th>${inline(c) || "&nbsp;"}</th>`).join("");
  const tb = data
    .map((r) => {
      const cells = header.map((_, i) => {
        const cell = r[i] ?? "";
        const empty = !cell;
        return `<td${empty ? ' class="blank"' : ""}>${empty ? "" : inline(cell)}</td>`;
      });
      return `<tr>${cells.join("")}</tr>`;
    })
    .join("\n");
  return `<div class="table-wrap"><table><thead><tr>${th}</tr></thead><tbody>${tb}</tbody></table></div>`;
}

function mdToHtml(md) {
  const toc = [];
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let i = 0;
  let signoffNext = false;

  const flushPara = (buf) => {
    const t = buf.join(" ").trim();
    if (t) out.push(`<p>${inline(t)}</p>`);
    buf.length = 0;
  };

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      const body = [];
      i += 1;
      while (i < lines.length && !lines[i].startsWith("```")) {
        body.push(lines[i]);
        i += 1;
      }
      i += 1;
      if (lang === "mermaid") {
        out.push(`<pre class="mermaid">${body.join("\n")}</pre>`);
      } else {
        out.push(`<pre><code class="lang-${escapeHtml(lang || "text")}">${escapeHtml(body.join("\n"))}</code></pre>`);
      }
      continue;
    }

    if (/^\s*---\s*$/.test(line)) {
      out.push("<hr />");
      i += 1;
      continue;
    }

    const hm = /^(#{1,3})\s+(.+)$/.exec(line);
    if (hm) {
      const level = hm[1].length;
      const text = hm[2].trim();
      const id = slugify(text);
      const tag = `h${level}`;
      if (level <= 3) toc.push({ level, id, text: text.replace(/`/g, "") });
      signoffNext = /review sign-off/i.test(text);
      out.push(`<${tag} id="${id}">${inline(text)}</${tag}>`);
      i += 1;
      continue;
    }

    if (line.trim().startsWith("|")) {
      const block = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        block.push(lines[i]);
        i += 1;
      }
      const table = parseTable(block);
      if (table) {
        out.push(signoffNext ? table.replace("<table>", '<table class="signoff">') : table);
      }
      signoffNext = false;
      continue;
    }

    const ul = /^[-*]\s+(.+)$/.exec(line);
    const ol = /^(\d+)\.\s+(.+)$/.exec(line);
    if (ul || ol) {
      const ordered = Boolean(ol);
      const items = [];
      while (i < lines.length) {
        const m = ordered ? /^(\d+)\.\s+(.+)$/.exec(lines[i]) : /^[-*]\s+(.+)$/.exec(lines[i]);
        if (!m) break;
        let item = m[2] ?? m[1];
        i += 1;
        while (
          i < lines.length &&
          lines[i].trim() &&
          !/^[-*]\s+/.test(lines[i]) &&
          !/^\d+\.\s+/.test(lines[i]) &&
          !lines[i].startsWith("#") &&
          !lines[i].trim().startsWith("|") &&
          lines[i] !== "---" &&
          !lines[i].startsWith("```")
        ) {
          item += " " + lines[i].trim();
          i += 1;
        }
        items.push(`<li>${inline(item)}</li>`);
      }
      out.push(`<${ordered ? "ol" : "ul"}>${items.join("")}</${ordered ? "ol" : "ul"}>`);
      continue;
    }

    if (!line.trim()) {
      i += 1;
      continue;
    }

    const para = [line.trim()];
    i += 1;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].startsWith("#") &&
      !lines[i].startsWith("```") &&
      !lines[i].trim().startsWith("|") &&
      !/^[-*]\s+/.test(lines[i]) &&
      !/^\d+\.\s+/.test(lines[i]) &&
      lines[i] !== "---"
    ) {
      para.push(lines[i].trim());
      i += 1;
    }
    flushPara(para);
  }

  return { html: out.join("\n"), toc };
}

const CSS = `
:root {
  --color-primary-50: #E7ECF0;
  --color-primary-100: #B0C3CC;
  --color-primary-500: #003F5B;
  --color-primary-600: #013A56;
  --color-primary-700: #022E44;
  --color-blue-sapphire-50: #E6F0F2;
  --color-blue-sapphire-700: #01435A;
  --color-blue-sapphire-900: #002834;
  --color-blue-gray-50: #F8FAFC;
  --color-blue-gray-100: #F1F5F9;
  --color-blue-gray-200: #E2E8F0;
  --color-blue-gray-600: #475569;
  --color-blue-gray-700: #334155;
  --color-green-50: #F3FCF7;
  --color-green-800: #116A33;
  --color-red-50: #FFF5F4;
  --color-red-800: #8B221C;
  --color-marigold-50: #FDF4E5;
  --color-marigold-700: #B06604;
  --color-orange-50: #FFF7ED;
  --ink: var(--color-blue-sapphire-900);
  --muted: var(--color-blue-gray-600);
  --bg: #fff;
  --accent: var(--color-primary-500);
  --font: "DM Sans", "Segoe UI", system-ui, sans-serif;
  --mono: "IBM Plex Mono", ui-monospace, Menlo, monospace;
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0;
  font-family: var(--font);
  color: var(--ink);
  background: var(--color-blue-gray-50);
  line-height: 1.55;
  font-size: 16px;
}
a { color: var(--color-primary-600); }
a:hover { color: var(--color-primary-700); }
.top {
  background: var(--color-primary-600);
  color: #fff;
  padding: 1rem 1.5rem;
  display: flex;
  align-items: center;
  gap: 1rem;
  position: sticky;
  top: 0;
  z-index: 20;
}
.brand {
  font-weight: 700;
  letter-spacing: .04em;
  background: #fff;
  color: var(--color-primary-600);
  width: 2.25rem; height: 2.25rem;
  display: grid; place-items: center;
  border-radius: 8px;
  font-size: .85rem;
}
.top h1 { font-size: 1.05rem; margin: 0; font-weight: 650; }
.top .sub { font-size: .8rem; opacity: .85; }
.top .spacer { flex: 1; }
.top nav { display: flex; gap: .75rem; font-size: .85rem; }
.top nav a { color: #fff; text-decoration: none; border-bottom: 1px solid rgba(255,255,255,.4); }
.layout {
  display: grid;
  grid-template-columns: minmax(220px, 260px) minmax(0, 52rem);
  gap: 2rem;
  max-width: 78rem;
  margin: 0 auto;
  padding: 1.5rem 1.25rem 4rem;
}
.toc {
  position: sticky;
  top: 4.5rem;
  align-self: start;
  background: #fff;
  border: 1px solid var(--color-blue-gray-200);
  border-radius: 12px;
  padding: 1rem 1rem 1rem 0;
  max-height: calc(100vh - 6rem);
  overflow: auto;
  font-size: .82rem;
}
.toc p {
  margin: 0 0 .5rem 1rem;
  font-size: .7rem;
  letter-spacing: .12em;
  text-transform: uppercase;
  font-weight: 700;
  color: var(--muted);
}
.toc a { color: var(--color-blue-gray-700); text-decoration: none; display: block; padding: .2rem 1rem; border-left: 3px solid transparent; }
.toc a:hover, .toc a:focus { background: var(--color-primary-50); border-left-color: var(--accent); }
.toc .l3 { padding-left: 1.6rem; font-size: .78rem; color: var(--muted); }
.prose { background: #fff; border: 1px solid var(--color-blue-gray-200); border-radius: 12px; padding: 2rem 2.25rem 3rem; }
.prose h1 { font-size: 1.85rem; line-height: 1.25; margin: 0 0 .5rem; color: var(--color-primary-700); }
.prose h2 { font-size: 1.35rem; margin: 2.25rem 0 .75rem; padding-top: .5rem; color: var(--color-primary-700); border-top: 1px solid var(--color-blue-gray-200); }
.prose h2:first-of-type { border-top: 0; }
.prose h3 { font-size: 1.08rem; margin: 1.6rem 0 .5rem; color: var(--color-blue-sapphire-700); }
.prose p { margin: 0 0 .85rem; }
.prose ul, .prose ol { margin: 0 0 1rem; padding-left: 1.35rem; }
.prose li { margin: .25rem 0; }
.prose hr { border: 0; border-top: 1px solid var(--color-blue-gray-200); margin: 1.75rem 0; }
.prose code {
  font-family: var(--mono);
  font-size: .86em;
  background: var(--color-blue-gray-100);
  padding: .1em .35em;
  border-radius: 4px;
}
.prose pre {
  background: var(--color-primary-700);
  color: #E7ECF0;
  padding: 1rem 1.1rem;
  border-radius: 10px;
  overflow: auto;
  font-size: .82rem;
  line-height: 1.45;
}
.prose pre code { background: none; color: inherit; padding: 0; }
.prose pre.mermaid { background: var(--color-blue-gray-50); color: var(--ink); border: 1px solid var(--color-blue-gray-200); }
.table-wrap { overflow-x: auto; margin: 0 0 1.15rem; }
table { border-collapse: collapse; width: 100%; font-size: .9rem; }
th, td { border: 1px solid var(--color-blue-gray-200); padding: .45rem .65rem; text-align: left; vertical-align: top; }
th { background: var(--color-primary-50); color: var(--color-primary-700); font-weight: 650; }
tr:nth-child(even) td { background: var(--color-blue-gray-50); }
td.blank { background: #fff; min-width: 6rem; height: 2rem; }
table.signoff td.blank { background: repeating-linear-gradient(-45deg, #fff, #fff 6px, var(--color-blue-gray-50) 6px, var(--color-blue-gray-50) 7px); }
.note {
  background: var(--color-marigold-50);
  border-left: 4px solid var(--color-marigold-700);
  padding: .75rem 1rem;
  margin: 0 0 1.25rem;
  font-size: .92rem;
}
.foot { margin-top: 2rem; font-size: .8rem; color: var(--muted); }
@media (max-width: 920px) {
  .layout { grid-template-columns: 1fr; }
  .toc { position: static; max-height: none; }
  .prose { padding: 1.25rem; }
}
@media print {
  body { background: #fff; }
  .top { position: static; }
  .top nav .print-hide, .toc { display: none; }
  .layout { display: block; max-width: none; padding: 0; }
  .prose { border: 0; }
  h2 { break-after: avoid; }
  table, pre { break-inside: avoid; }
  a { color: inherit; text-decoration: none; }
}
`;

function page({ title, eyebrow, companion, toc, body, sourceRel }) {
  const tocHtml = toc
    .filter((t) => t.level >= 2)
    .map(
      (t) =>
        `<a class="l${t.level}" href="#${t.id}">${escapeHtml(t.text.replace(/§/g, ""))}</a>`,
    )
    .join("\n");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet" />
<style>${CSS}</style>
</head>
<body>
<header class="top">
  <div class="brand" aria-hidden="true">KN</div>
  <div>
    <div class="sub">${escapeHtml(eyebrow)}</div>
    <h1>${escapeHtml(title)}</h1>
  </div>
  <div class="spacer"></div>
  <nav>
    <a href="${companion.href}">${escapeHtml(companion.label)}</a>
    <a class="print-hide" href="#" onclick="window.print(); return false;">Print / PDF</a>
  </nav>
</header>
<div class="layout">
  <nav class="toc" aria-label="Contents">
    <p>Contents</p>
    ${tocHtml}
  </nav>
  <article class="prose">
    <p class="note">Shareable HTML generated from <code>${escapeHtml(sourceRel)}</code>. Markdown remains the source of truth. Print this page to PDF if you need a file for review.</p>
    ${body}
    <p class="foot">KlearNow Tariff · generated ${new Date().toISOString().slice(0, 10)}</p>
  </article>
</div>
<script type="module">
  import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
  mermaid.initialize({ startOnLoad: true, theme: "neutral", securityLevel: "strict" });
</script>
</body>
</html>
`;
}

for (const doc of DOCS) {
  const srcPath = join(ROOT, doc.src);
  const destPath = join(ROOT, doc.dest);
  const md = readFileSync(srcPath, "utf8");
  const { html, toc } = mdToHtml(md);
  mkdirSync(dirname(destPath), { recursive: true });
  writeFileSync(
    destPath,
    page({
      title: doc.title,
      eyebrow: doc.eyebrow,
      companion: doc.companion,
      toc,
      body: html,
      sourceRel: doc.src,
    }),
  );
  console.log("wrote", relative(ROOT, destPath));
}
