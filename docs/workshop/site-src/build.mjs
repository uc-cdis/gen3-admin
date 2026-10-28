// Generates docs/workshop/site/*.html, assets/site.js (with the search index) and assets/img/.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { esc, table, used } from './lib.mjs';
import { TS, TS_ORDER, TS_COLS } from './ts.mjs';
import { START } from './pages-start.mjs';
import { TUTORIAL } from './pages-tutorial.mjs';
import { HOWTO } from './pages-howto.mjs';
import { CONCEPTS } from './pages-concepts.mjs';
import { REF } from './pages-ref.mjs';
import { MORE } from './pages-more.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// This script lives in docs/workshop/site-src/; it writes ../site/ and copies screenshots from ../img/.
const SITE = path.resolve(HERE, '../site');
const IMG_SRC = path.resolve(HERE, '../img');

const PAGES = [...START, ...TUTORIAL, ...HOWTO, ...CONCEPTS, ...REF, ...MORE];
const SECTIONS = ['Start here', 'Tutorial', 'How-to guides', 'Concepts', 'Reference', 'Next steps'];
const SECTION_HOME = Object.fromEntries(SECTIONS.map((s) => [s, PAGES.find((p) => p.section === s).file]));

const slug = (s) => s.toLowerCase().replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, '').replace(/['’.]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const strip = (h) => h
  .replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<svg[\s\S]*?<\/svg>/g, ' ')
  .replace(/<(br|\/p|\/li|\/td|\/th|\/dd|\/dt|\/h\d)[^>]*>/g, ' ').replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&middot;/g, '·').replace(/&rarr;/g, '→').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

function tsTable(key, root) {
  const t = TS[key];
  return table(TS_COLS, t.rows).replace(/\{R\}/g, root);
}

const ICON = {
  menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg>',
  mag: '<svg class="mag" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  vals: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>',
  theme: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 0 0 16z" fill="currentColor"/></svg>',
};

function sidebar(page, root) {
  let h = '';
  for (const sec of SECTIONS) {
    const items = PAGES.filter((p) => p.section === sec);
    h += `<div class="sect"><p>${sec}</p><ul>`;
    let group = null;
    for (const p of items) {
      if (p.group && p.group !== group) {
        group = p.group;
        h += `<li class="grp">${p.group === 'In the CSOC portal' ? p.group : `Wizard step: ${p.group}`}</li>`;
      }
      const cur = p === page ? ' aria-current="page"' : '';
      h += `<li${p.group ? ' class="ingrp"' : ''}><a href="${root}${p.file}"${cur}><span>${p.nav}</span></a></li>`;
    }
    h += '</ul></div>';
  }
  h += `<div class="foot">Example values such as <code>csoc.example.org</code> stand for yours; collect them in the <a href="${root}prerequisites.html#worksheet">worksheet</a>.</div>`;
  return h;
}

function render(page, i) {
  const depth = page.file.split('/').length - 1;
  const root = '../'.repeat(depth);
  let body = page.body();
  body = body.replace(/\{\{TS:([a-z0-9-]+)\}\}/g, (_, k) => tsTable(k, root));
  body = body.replace(/\{\{TSALL\}\}/g, () => TS_ORDER.map((k) => {
    const p = PAGES.find((x) => x.key === k);
    return `<h2>${TS[k].title}</h2><p>These rows also appear on <a href="${root}${p.file}#${p.section === 'How-to guides' ? 'if-it-fails' : 'troubleshooting'}">${p.nav}</a>.</p>${tsTable(k, root)}`;
  }).join('\n'));
  // Reference pages link to walkthrough pages relative to the site root.
  if (depth) body = body.replace(/href="(?!https?:|#|\.\.\/|mailto:)([a-z0-9-]+\.html)/g, (m, f) => (PAGES.some((p) => p.file === f) ? `href="${root}${f}` : m));
  // Walkthrough pages that link to reference/... are already root-relative at depth 0.
  // Heading ids.
  const seen = new Set();
  body = body.replace(/<h([23])>([\s\S]*?)<\/h\1>/g, (m, n, inner) => {
    let id = slug(inner) || 'section'; let k = id, c = 2;
    while (seen.has(k)) k = `${id}-${c++}`;
    seen.add(k);
    return `<h${n} id="${k}">${inner}</h${n}>`;
  });

  const prev = PAGES[i - 1], next = PAGES[i + 1];
  const crumbs = [`<li><a href="${root}index.html">Docs</a></li>`];
  if (page.file !== 'index.html') {
    crumbs.push(`<li><a href="${root}${SECTION_HOME[page.section]}">${page.section}</a></li>`);
    if (page.group) crumbs.push(`<li>${page.group === 'In the CSOC portal' ? page.group : `Wizard step: ${page.group}`}</li>`);
    crumbs.push(`<li aria-current="page">${page.nav}</li>`);
  }
  else crumbs.push('<li aria-current="page">Overview</li>');
  const titleText = strip(page.title);
  const html = `<!DOCTYPE html>
<html lang="en" data-root="${root}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(titleText)} · Gen3 CSOC docs</title>
<meta name="description" content="${esc(strip(page.lead))}">
<script>(function(){try{var t=localStorage.getItem('csoc-docs-theme');if(!t&&window.matchMedia)t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';if(t)document.documentElement.setAttribute('data-theme',t);}catch(e){}})();</script>
<link rel="stylesheet" href="${root}assets/site.css">
</head>
<body>
<a class="skip" href="#content">Skip to content</a>
<header class="topbar">
  <button class="iconbtn menubtn" id="menubtn" type="button" aria-controls="sidebar" aria-expanded="false" aria-label="Navigation">${ICON.menu}</button>
  <a class="brand" href="${root}index.html"><span class="logo" aria-hidden="true">CS</span><span>Gen3 CSOC <small>docs</small></span></a>
  <span class="spacer"></span>
  <div class="search" role="search">${ICON.mag}<input id="search" type="search" placeholder="Search the docs" aria-label="Search the docs" autocomplete="off" spellcheck="false" role="combobox" aria-controls="results" aria-expanded="false" aria-autocomplete="list"><span class="hint" aria-hidden="true">/</span><div class="results" id="results" role="listbox" aria-label="Search results"></div></div>
  <button class="iconbtn" id="theme" type="button" aria-label="Toggle dark theme">${ICON.theme}</button>
</header>
<div class="layout">
<nav class="sidebar" id="sidebar" aria-label="Documentation">
${sidebar(page, root)}
</nav>
<main id="content">
<article>
<nav class="crumbs" aria-label="Breadcrumb"><ol>${crumbs.join('')}</ol></nav>
<h1>${page.title}</h1>
<p class="lead">${page.lead}</p>
${page.meta ? `<div class="meta">${page.meta.join('')}</div>` : ''}
${body}
<nav class="pager" aria-label="Previous and next page">
${prev ? `<a class="prev" href="${root}${prev.file}" rel="prev"><small>Previous</small><b>← ${prev.nav}</b></a>` : ''}
${next ? `<a class="next" href="${root}${next.file}" rel="next"><small>Next</small><b>${next.nav} →</b></a>` : ''}
</nav>
</article>
</main>
<aside class="toc" aria-label="On this page"><p>On this page</p><ul id="toc"></ul><a class="top" href="#">↑ Back to top</a></aside>
</div>
<script src="${root}assets/site.js"></script>
</body>
</html>
`;
  // Search entries: one per h2/h3 section, plus the intro.
  const entries = [];
  const art = `<p>${page.lead}</p>` + body;
  const parts = art.split(/(?=<h[23] id=")/);
  for (const part of parts) {
    const m = part.match(/^<h[23] id="([^"]+)">([\s\S]*?)<\/h[23]>/);
    const text = strip(m ? part.slice(m[0].length) : part).slice(0, 2400);
    entries.push([titleText, page.file, m ? strip(m[2]) : '', m ? m[1] : '', text]);
  }
  // Glossary terms get their own entries.
  for (const m of body.matchAll(/<dt id="([^"]+)">([\s\S]*?)<\/dt><dd>([\s\S]*?)<\/dd>/g)) entries.push([titleText, page.file, strip(m[2]), m[1], strip(m[3])]);
  return { html, entries };
}

// Remove pages and images from earlier builds so nothing stale is published.
(function clean(d) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) { if (f !== 'assets') { clean(p); if (!fs.readdirSync(p).length) fs.rmdirSync(p); } }
    else if (f.endsWith('.html')) fs.unlinkSync(p);
  }
})(SITE);

let index = [];
PAGES.forEach((p, i) => {
  const { html, entries } = render(p, i);
  const out = path.join(SITE, p.file);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html);
  index = index.concat(entries);
});

const js = fs.readFileSync(path.join(HERE, 'site.src.js'), 'utf8').replace('/*__SEARCH_INDEX__*/[]', JSON.stringify(index));
fs.writeFileSync(path.join(SITE, 'assets/site.js'), js);

fs.mkdirSync(path.join(SITE, 'assets/img'), { recursive: true });
// Images already in the site are kept as they are: they may have been edited
// (account numbers, domains and addresses blurred). Only missing ones are copied,
// and images no page uses are removed.
for (const f of used) { const dst = path.join(SITE, 'assets/img', f); if (!fs.existsSync(dst)) fs.copyFileSync(path.join(IMG_SRC, f), dst); }
for (const f of fs.readdirSync(path.join(SITE, 'assets/img'))) if (!used.has(f)) fs.unlinkSync(path.join(SITE, 'assets/img', f));
fs.writeFileSync(path.join(SITE, '.nojekyll'), '');
console.log(`pages: ${PAGES.length}, index entries: ${index.length}, images: ${[...used].sort().join(' ')}`);
