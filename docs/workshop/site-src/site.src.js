/* Gen3 CSOC docs: the one script every page loads. No dependencies, no network.
 * Search index below is generated from the pages (see site/README.md). */
(function () {
'use strict';

var ROOT = document.documentElement.getAttribute('data-root') || '';
var REDUCE = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
function $(s, r) { return (r || document).querySelector(s); }
function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

/* ---------- storage (timers only) ---------- */
var KEY = 'csoc-docs-timers-v1';
var store = {};
try { store = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { store = {}; }
store.timers = store.timers || {};
function save() { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) { /* private mode */ } }

/* ---------- theme ---------- */
var THEME = 'csoc-docs-theme';
function curTheme() { return document.documentElement.getAttribute('data-theme') || ((window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light'); }
function setThemeLabel() {
  var b = $('#theme'); if (!b) return;
  var dark = curTheme() === 'dark';
  b.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
  b.setAttribute('title', dark ? 'Light theme' : 'Dark theme');
  b.setAttribute('aria-pressed', dark ? 'true' : 'false');
}
var tb = $('#theme');
if (tb) tb.addEventListener('click', function () {
  var t = curTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', t);
  try { localStorage.setItem(THEME, t); } catch (e) {}
  setThemeLabel();
});
if (window.matchMedia) {
  var mq = matchMedia('(prefers-color-scheme: dark)');
  var onMq = function () { var saved = null; try { saved = localStorage.getItem(THEME); } catch (e) {} if (!saved) { document.documentElement.setAttribute('data-theme', mq.matches ? 'dark' : 'light'); setThemeLabel(); } };
  if (mq.addEventListener) mq.addEventListener('change', onMq); else if (mq.addListener) mq.addListener(onMq);
}
setThemeLabel();

/* ---------- mobile navigation ---------- */
var mb = $('#menubtn');
function closeNav() { document.body.classList.remove('nav-open'); if (mb) mb.setAttribute('aria-expanded', 'false'); }
if (mb) mb.addEventListener('click', function () {
  var open = document.body.classList.toggle('nav-open');
  mb.setAttribute('aria-expanded', open ? 'true' : 'false');
});
document.addEventListener('click', function (e) {
  if (!document.body.classList.contains('nav-open')) return;
  if (e.target.closest && (e.target.closest('.sidebar') || e.target.closest('#menubtn'))) return;
  closeNav();
});
document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeNav(); });
var cur = $('.sidebar [aria-current="page"]');
if (cur && cur.scrollIntoView) { var sb = $('.sidebar'); if (sb && cur.offsetTop > sb.clientHeight - 80) sb.scrollTop = cur.offsetTop - 120; }

var DIAGS = [];

/* ---------- copy ---------- */
function copyText(t, btn, label) {
  var old = label || btn.textContent;
  function ok() { btn.textContent = 'Copied'; btn.classList.add('ok'); setTimeout(function () { btn.textContent = old; btn.classList.remove('ok'); }, 1400); }
  function fallback() {
    var ta = document.createElement('textarea'); ta.value = t; ta.setAttribute('readonly', '');
    ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); ok(); } catch (e) { btn.textContent = 'Select + copy'; }
    document.body.removeChild(ta);
  }
  if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(t).then(ok, fallback); else fallback();
}
$$('.codeblock').forEach(function (w) {
  var pre = $('pre', w); var b = document.createElement('button');
  b.type = 'button'; b.className = 'copy'; b.textContent = 'Copy'; b.setAttribute('aria-label', 'Copy to clipboard');
  b.addEventListener('click', function () { copyText(pre.textContent.replace(/\n$/, ''), b, 'Copy'); });
  w.appendChild(b);
});
$$('code.cp').forEach(function (c) {
  var b = document.createElement('button');
  b.type = 'button'; b.className = 'cpi'; b.textContent = 'copy'; b.setAttribute('aria-label', 'Copy');
  b.addEventListener('click', function () { copyText(c.textContent, b, 'copy'); });
  c.insertAdjacentElement('afterend', b);
});

/* ---------- heading anchors + table of contents ---------- */
var heads = $$('article h2[id], article h3[id]');
heads.forEach(function (h) {
  h.classList.add('heading');
  var a = document.createElement('a'); a.className = 'anchor'; a.href = '#' + h.id; a.textContent = '#';
  a.setAttribute('aria-label', 'Copy link to this section');
  a.addEventListener('click', function (e) {
    e.preventDefault();
    if (history.replaceState) history.replaceState(null, '', '#' + h.id); else location.hash = h.id;
    h.scrollIntoView({ behavior: REDUCE ? 'auto' : 'smooth' });
    var url = location.href.split('#')[0] + '#' + h.id;
    copyText(url, a, '#'); a.textContent = '#';
    a.classList.add('ok'); a.title = 'Link copied'; setTimeout(function () { a.classList.remove('ok'); a.title = ''; }, 1400);
  });
  h.appendChild(a);
});
var toc = $('#toc');
if (toc) {
  if (heads.length < 2) { toc.parentNode.style.visibility = 'hidden'; }
  else {
    var th = '';
    heads.forEach(function (h) {
      var t = h.cloneNode(true); $$('.anchor', t).forEach(function (x) { x.remove(); });
      th += '<li class="' + (h.tagName === 'H3' ? 'l3' : 'l2') + '"><a href="#' + h.id + '">' + esc(t.textContent.trim()) + '</a></li>';
    });
    toc.innerHTML = th;
    var links = $$('a', toc);
    var spy = function () {
      var y = window.scrollY + 110, act = 0;
      for (var i = 0; i < heads.length; i++) { if (heads[i].getBoundingClientRect().top + window.scrollY <= y) act = i; }
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) act = heads.length - 1;
      links.forEach(function (l, i) { l.classList.toggle('active', i === act); });
    };
    var raf = null;
    window.addEventListener('scroll', function () { if (raf) return; raf = requestAnimationFrame(function () { raf = null; spy(); }); }, { passive: true });
    window.addEventListener('resize', spy); spy();
  }
}

/* ---------- search ---------- */
/* Each entry: [page title, page url from the site root, section title, anchor, text] */
var IDX = /*__SEARCH_INDEX__*/[];
var sIn = $('#search'), sOut = $('#results'), sSel = -1;
function norm(s) { return s.toLowerCase(); }
function snippet(text, terms) {
  var lt = norm(text), at = -1;
  for (var i = 0; i < terms.length; i++) { var p = lt.indexOf(terms[i]); if (p >= 0 && (at < 0 || p < at)) at = p; }
  var start = Math.max(0, at - 50), s = text.slice(start, start + 170);
  var out = esc((start > 0 ? '…' : '') + s + (start + 170 < text.length ? '…' : ''));
  terms.forEach(function (t) { if (t.length < 2) return; out = out.replace(new RegExp('(' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig'), '<mark>$1</mark>'); });
  return out;
}
function search(q) {
  var terms = norm(q).split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  var res = [];
  IDX.forEach(function (e) {
    var page = norm(e[0]), sec = norm(e[2]), body = norm(e[4]), score = 0;
    for (var i = 0; i < terms.length; i++) {
      var t = terms[i], s = 0;
      if (sec.indexOf(t) >= 0) s += 8;
      if (page.indexOf(t) >= 0) s += 5;
      var c = 0, p = body.indexOf(t); while (p >= 0 && c < 10) { c++; p = body.indexOf(t, p + t.length); }
      s += c;
      if (!s) return;
      score += s;
    }
    res.push([score, e]);
  });
  res.sort(function (a, b) { return b[0] - a[0]; });
  return res.slice(0, 12).map(function (r) { return r[1]; }).concat([]).map(function (e) { return { e: e, terms: terms }; });
}
function showResults() {
  var q = sIn.value.trim(); sSel = -1;
  if (!q) { sOut.classList.remove('open'); sOut.innerHTML = ''; sIn.setAttribute('aria-expanded', 'false'); return; }
  var r = search(q);
  sOut.innerHTML = r.length ? r.map(function (x, i) {
    var e = x.e, href = ROOT + e[1] + (e[3] ? '#' + e[3] : '');
    return '<a href="' + esc(href) + '" id="sr-' + i + '" role="option"><span class="rt">' + esc(e[2] || e[0]) + '</span> <span class="rp">' + (e[2] ? esc(e[0]) : '') +
      '</span><span class="rx">' + snippet(e[4], x.terms) + '</span></a>';
  }).join('') : '<div class="empty">No results for “' + esc(q) + '”.</div>';
  sOut.classList.add('open'); sIn.setAttribute('aria-expanded', 'true');
}
function moveSel(d) {
  var a = $$('a', sOut); if (!a.length) return;
  sSel = (sSel + d + a.length) % a.length;
  a.forEach(function (x, i) { x.classList.toggle('sel', i === sSel); });
  a[sSel].scrollIntoView({ block: 'nearest' }); sIn.setAttribute('aria-activedescendant', a[sSel].id);
}
if (sIn && sOut) {
  sIn.addEventListener('input', showResults);
  sIn.addEventListener('focus', function () { if (sIn.value.trim()) showResults(); });
  sIn.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); moveSel(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveSel(-1); }
    else if (e.key === 'Enter') { var a = $$('a', sOut); var t = a[sSel >= 0 ? sSel : 0]; if (t) { e.preventDefault(); location.href = t.href; } }
    else if (e.key === 'Escape') { sIn.value = ''; showResults(); sIn.blur(); }
  });
  document.addEventListener('click', function (e) { if (!e.target.closest || !e.target.closest('.search')) { sOut.classList.remove('open'); sIn.setAttribute('aria-expanded', 'false'); } });
  document.addEventListener('keydown', function (e) {
    var tag = (document.activeElement && document.activeElement.tagName) || '';
    if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(tag) && !e.metaKey && !e.ctrlKey) { e.preventDefault(); sIn.focus(); sIn.select(); }
  });
}
window.CSOC_DOCS_SEARCH = function (q) { return search(q).map(function (x) { return x.e[1] + '#' + x.e[3]; }); };

/* ---------- timers ---------- */
function fmt(ms) { var s = Math.max(0, Math.floor(ms / 1000)), m = Math.floor(s / 60); return (m < 10 ? '0' : '') + m + ':' + ('0' + (s % 60)).slice(-2); }
var timers = $$('.timer');
timers.forEach(function (el) {
  var id = el.getAttribute('data-t'), typ = +el.getAttribute('data-typ'), hi = +el.getAttribute('data-hi'), label = el.getAttribute('data-label');
  el.innerHTML = '<button type="button" class="go">Start timer</button><button type="button" class="rs">Reset</button>' +
    '<span class="clock" aria-live="off">00:00</span><span class="tbar" aria-hidden="true"><i></i><b style="left:' + (100 * typ / hi) + '%"></b></span>' +
    '<span class="tmsg"></span>';
  el._u = function () {
    var t = store.timers[id] || {}, now = Date.now();
    var ms = t.start ? ((t.stop || now) - t.start) : 0, min = ms / 60000;
    $('.clock', el).textContent = fmt(ms);
    $('.tbar i', el).style.width = Math.min(100, 100 * min / hi) + '%';
    var go = $('.go', el); go.textContent = t.start && !t.stop ? 'Stop' : (t.start ? 'Resume' : 'Start timer');
    go.classList.toggle('run', !!(t.start && !t.stop));
    el.classList.toggle('slow', min > typ && min <= hi); el.classList.toggle('late', min > hi);
    var tt = el.getAttribute('data-typtext');
    var msg = !t.start ? 'Optional. A typical ' + label + ' takes ' + tt + '. Start the timer when you press the button.'
      : min <= typ ? 'On track: a typical ' + label + ' takes ' + tt + '.'
      : min <= hi ? 'Longer than typical, but still normal up to ' + hi + ' minutes. Keep an eye on the log.'
      : 'Over ' + hi + ' minutes: check the banner and the log, and see Troubleshooting below.';
    if (t.stop) msg = 'Stopped at ' + fmt(ms) + '.';
    $('.tmsg', el).textContent = msg;
  };
  $('.go', el).addEventListener('click', function () {
    var t = store.timers[id] || {};
    if (!t.start) t = { start: Date.now() };
    else if (!t.stop) t.stop = Date.now();
    else { t.start = Date.now() - (t.stop - t.start); delete t.stop; }
    store.timers[id] = t; save(); el._u();
  });
  $('.rs', el).addEventListener('click', function () { delete store.timers[id]; save(); el._u(); });
  el._u();
});
if (timers.length) setInterval(function () { timers.forEach(function (el) { el._u(); }); }, 1000);

/* ---------- animated diagrams ---------- */
/* node:  [id, x, y, w, h, label, sub, frame, opts]   opts: {b: built-style, go: page, also: [frames]}
   edge:  [from, to, frame, label, opts]               opts: {back, bend, also}
   group: [x, y, w, h, label, frame, opts]             opts: {solid, go} */
var SPECS = {
overview: { w: 980, h: 430,
  groups: [[10, 26, 250, 394, 'Your laptop', 1, {}], [285, 26, 685, 394, 'Your AWS account', 2, {}], [300, 132, 655, 276, 'VPC', 3, { go: 'apply' }], [505, 150, 440, 250, 'EKS cluster', 3, { solid: 1, go: 'apply' }]],
  nodes: [
    ['br', 30, 56, 210, 46, 'Browser', 'the wizard, then the portal', 1, { go: 'start-the-wizard' }],
    ['fe', 30, 126, 210, 46, 'frontend :3000', 'bootstrap wizard', 1, { go: 'start-the-wizard' }],
    ['api', 30, 196, 210, 46, 'API 127.0.0.1:8002', 'uses your ~/.aws', 1, { go: 'start-the-wizard' }],
    ['px', 30, 266, 210, 46, 'docker socket proxy', 'containers only', 1, { go: 'start-the-wizard' }],
    ['rn', 30, 346, 210, 50, 'runner container', 'terraform · helm · kubectl', 3, { go: 'plan', also: [5, 6] }],
    ['s3', 305, 56, 150, 50, 'S3 state bucket', 'state + registry', 2, { go: 'setup' }],
    ['r53', 470, 56, 150, 50, 'Route 53 zone', '<your-domain>', 2, { go: 'setup', also: [6, 8] }],
    ['acm', 635, 56, 150, 50, 'ACM certificate', 'portal + auth', 4, { go: 'certificate-and-dns' }],
    ['sm', 800, 56, 155, 50, 'Secrets Manager', 'gen3-csoc/<name>/', 5, { go: 'install' }],
    ['sq', 315, 170, 175, 46, 'NAT + Squid', 'controlled outbound traffic', 3, { go: 'apply', b: 1 }],
    ['alb', 315, 330, 175, 50, 'ALB (allowlist)', 'HTTPS for portal + auth', 6, { go: 'finish' }],
    ['eks', 520, 180, 200, 46, 'EKS + Karpenter', 'cluster, nodes on demand', 3, { go: 'apply', b: 1 }],
    ['ctl', 735, 180, 200, 46, 'ESO · LBC · external-dns', 'controllers', 5, { go: 'install', b: 1 }],
    ['kc', 520, 250, 200, 46, 'Keycloak', 'sign-in, PostgreSQL', 5, { go: 'sign-in', b: 1 }],
    ['csoc', 735, 250, 200, 46, 'CSOC portal + API', 'endpoint for agents', 5, { go: 'sign-in', b: 1, also: [7, 8] }],
    ['ag', 520, 325, 200, 50, 'Agent', 'mTLS to the CSOC', 7, { go: 'connect-cluster', b: 1, also: [8] }],
    ['g3', 735, 325, 200, 50, 'Gen3 commons-a', 'helm release gen3', 8, { go: 'deploy-gen3', b: 1 }]
  ],
  edges: [['br', 'fe', 1, ''], ['fe', 'api', 1, ''], ['api', 'px', 1, ''], ['px', 'rn', 3, ''], ['api', 's3', 2, 'state'], ['api', 'r53', 2, '', { bend: -80 }],
    ['rn', 'eks', 3, 'apply · install'], ['sm', 'ctl', 5, 'ESO'], ['alb', 'csoc', 6, '', { bend: 75 }], ['alb', 'kc', 6, ''], ['r53', 'alb', 6, 'CNAMEs', { bend: -40 }],
    ['csoc', 'ag', 7, 'gRPC mTLS'], ['ag', 'g3', 8, ''], ['ctl', 'r53', 8, 'commons DNS', { bend: 30 }]]
},
stack: { w: 760, h: 330,
  groups: [[10, 10, 740, 310, 'Your laptop · Docker', 0, {}]],
  nodes: [
    ['br', 30, 44, 150, 52, 'Browser', 'localhost:3000/bootstrap', 1],
    ['fe', 220, 44, 150, 52, 'frontend', 'Next.js · 127.0.0.1:3000', 1],
    ['api', 410, 44, 150, 52, 'api', 'Go · 127.0.0.1:8002', 2, { also: [3, 4, 7] }],
    ['aws', 410, 170, 150, 52, '~/.aws', 'profiles, SSO cache', 3, { also: [5] }],
    ['px', 600, 44, 140, 52, 'docker-proxy', 'create · start · logs', 4],
    ['rn', 600, 170, 140, 52, 'runner', 'gen3-terraform image', 5, { also: [6, 7] }],
    ['cl', 600, 262, 140, 48, 'AWS', 'your account', 6]
  ],
  edges: [['br', 'fe', 1, 'page'], ['fe', 'api', 2, '/api/…'], ['aws', 'api', 3, 'read'], ['api', 'px', 4, 'docker run'], ['px', 'rn', 5, 'start'],
    ['aws', 'rn', 5, 'copied in'], ['rn', 'cl', 6, 'API calls'], ['rn', 'api', 7, 'log stream', { back: 1, bend: -34 }], ['api', 'br', 7, 'live log', { back: 1, bend: 70 }]]
},
creds: { w: 760, h: 230,
  nodes: [
    ['sso', 15, 90, 140, 58, 'SSO session', 'aws sso login', 1],
    ['def', 180, 90, 140, 58, 'SSO profile', '<your-sso-profile>', 2],
    ['role', 345, 90, 160, 58, 'assume role', '<your-aws-profile>', 3, { also: [4, 5] }],
    ['id', 545, 20, 200, 58, 'Blue identity box', 'account <account-id>', 4],
    ['rn', 545, 150, 200, 58, 'runner container', 'AWS_PROFILE=<your-aws-profile>', 5]
  ],
  edges: [['sso', 'def', 2, 'token'], ['def', 'role', 3, 'sts:AssumeRole'], ['role', 'id', 4, 'GetCallerIdentity'], ['role', 'rn', 5, 'same chain']]
},
dns: { w: 760, h: 240,
  nodes: [
    ['par', 20, 30, 210, 58, 'Parent zone', '<parent-domain>', 0],
    ['ch', 290, 30, 210, 58, 'New hosted zone', '<your-domain>', 1, { b: 1 }],
    ['ns', 290, 150, 210, 58, 'NS record set', '4 Route 53 name servers', 2, { b: 1 }],
    ['pub', 560, 30, 180, 58, 'Public resolver', 'e.g. 1.1.1.1', 3],
    ['ok', 560, 150, 180, 58, 'Domain Verified', 'wizard re-checks', 4]
  ],
  edges: [['ch', 'ns', 2, 'name servers'], ['ns', 'par', 2, 'added to parent', { bend: 30 }], ['pub', 'par', 3, 'who serves it?', { bend: 75 }], ['pub', 'ch', 3, 'answer'], ['pub', 'ok', 4, 'resolves']]
},
plan: { w: 760, h: 270,
  nodes: [
    ['rn', 20, 105, 150, 58, 'runner', 'terraform init / plan', 1, { also: [2, 3] }],
    ['pv', 225, 20, 180, 52, 'Providers + modules', 'aws, helm · vpc, eks', 1],
    ['s3', 225, 190, 180, 52, 'S3 backend', 'state + lock file', 2],
    ['pl', 300, 105, 150, 58, 'plan', '≈100 to create', 3, { b: 1 }],
    ['full', 560, 20, 180, 52, 'Full plan file', 'stays in the runner', 4],
    ['sum', 560, 190, 180, 52, 'Summary', 'address · type · action', 4],
    ['ui', 560, 105, 180, 58, 'Plan review', 'List + Diagram', 5]
  ],
  edges: [['rn', 'pv', 1, 'download'], ['rn', 's3', 2, 'backend'], ['rn', 'pl', 3, ''], ['pl', 'full', 4, ''], ['pl', 'sum', 4, ''], ['sum', 'ui', 5, 'to browser']]
},
apply: { w: 760, h: 400,
  groups: [[10, 10, 740, 380, 'AWS account', 0, {}], [25, 40, 710, 335, 'VPC · 3 availability zones', 1, {}]],
  nodes: [
    ['sub', 45, 72, 210, 48, 'Subnets + route tables', 'public · private', 1, { b: 1 }],
    ['nat', 45, 140, 210, 48, 'Internet + NAT gateway', 'public subnet', 2, { b: 1 }],
    ['sq', 45, 208, 210, 48, 'Squid proxy', 'allowlisted outbound traffic', 3, { b: 1, also: [4, 8] }],
    ['lm', 45, 288, 210, 48, 'Route-check function', 'AWS Lambda', 4, { b: 1 }],
    ['pz', 290, 288, 200, 48, 'Private DNS · key · logs', 'alongside the network', 2, { b: 1 }],
    ['eks', 290, 72, 200, 48, 'EKS control plane', 'about 10 minutes', 5, { b: 1, also: [6, 7] }],
    ['iam', 520, 72, 200, 48, 'IAM roles', 'one per controller', 6, { b: 1 }],
    ['kp', 290, 140, 200, 48, 'Karpenter', 'on AWS Fargate', 7, { b: 1, also: [8] }],
    ['nd', 290, 208, 200, 48, 'EC2 nodes', 'started on demand', 8, { b: 1 }]
  ],
  edges: [['nat', 'sq', 3, 'out'], ['lm', 'sq', 4, 'health check'], ['lm', 'pz', 4, ''], ['sub', 'eks', 5, 'subnets'], ['eks', 'iam', 6, ''],
    ['eks', 'kp', 7, ''], ['kp', 'nd', 8, 'launch'], ['nd', 'sq', 8, 'outbound', { back: 1 }]]
},
cert: { w: 760, h: 250,
  nodes: [
    ['wz', 20, 30, 150, 56, 'Wizard', 'Request', 1, { also: [3] }],
    ['acm', 230, 30, 170, 56, 'ACM', 'pending validation', 1, { also: [2, 5] }],
    ['rec', 460, 30, 280, 56, 'Validation records', 'one per hostname', 2],
    ['z', 460, 160, 170, 56, 'Route 53 zone', '<your-domain>', 3, { b: 1 }],
    ['pub', 230, 160, 170, 56, 'Public DNS', 'follows the delegation', 4],
    ['ok', 20, 160, 150, 56, 'Issued', 'on to Install', 5, { b: 1 }]
  ],
  edges: [['wz', 'acm', 1, 'request'], ['acm', 'rec', 2, 'publishes'], ['wz', 'z', 3, 'writes records', { bend: -60 }], ['pub', 'z', 4, 'lookup'], ['acm', 'pub', 5, 'checks'], ['acm', 'ok', 5, '']]
},
install: { w: 760, h: 380,
  groups: [[10, 92, 740, 280, 'EKS cluster', 0, { solid: 1 }]],
  nodes: [
    ['rn', 20, 20, 150, 50, 'runner', 'connects to the cluster', 1, { also: [2, 3, 4] }],
    ['sm', 195, 20, 175, 50, 'Secrets Manager', 'CSOC secrets', 2, { b: 1 }],
    ['pr', 390, 20, 170, 50, 'Outbound IP check', 'for the allowlist', 3, { b: 1 }],
    ['pw', 580, 20, 165, 50, 'First admin password', 'read once by Keycloak', 4, { b: 1 }],
    ['eso', 25, 120, 133, 50, 'External Secrets', 'secrets into the cluster', 5, { b: 1, also: [10] }],
    ['lbc', 170, 120, 133, 50, 'LB Controller', 'load balancers', 6, { b: 1, also: [11] }],
    ['dns', 315, 120, 133, 50, 'external-dns', 'commons hostnames', 7, { b: 1 }],
    ['ebs', 460, 120, 133, 50, 'EBS CSI driver', 'storage volumes', 8, { b: 1, also: [9] }],
    ['pg', 605, 120, 133, 50, 'CloudNativePG', 'PostgreSQL', 9, { b: 1 }],
    ['kc', 210, 210, 345, 50, 'Keycloak + CSOC realm', 'sign-in, with its database', 10, { b: 1 }],
    ['cs', 570, 210, 165, 50, 'CSOC portal', 'portal + API', 11, { b: 1 }],
    ['ing', 210, 300, 525, 50, 'Internet-facing load balancer', 'only the allowed addresses', 11, { b: 1 }]
  ],
  edges: [['rn', 'sm', 2, ''], ['sm', 'eso', 10, 'copied in', { bend: -20 }], ['eso', 'kc', 10, ''], ['pg', 'kc', 10, ''], ['ebs', 'kc', 10, ''],
    ['cs', 'ing', 11, ''], ['kc', 'ing', 11, '']]
},
finish: { w: 760, h: 250,
  nodes: [
    ['al', 20, 30, 170, 56, 'Allowlist', 'yours + the cluster\'s', 1, { b: 1 }],
    ['kc', 230, 30, 160, 56, 'Keycloak Ready', 'portal rolled out', 2, { b: 1, also: [3] }],
    ['rl', 430, 30, 150, 56, 'Realm imported', 'first password removed', 3, { b: 1 }],
    ['alb', 620, 30, 125, 56, 'Load balancer', 'address read', 4, { b: 1, also: [5] }],
    ['r53', 430, 160, 180, 56, 'DNS records', 'portal + Keycloak', 5, { b: 1, also: [6] }],
    ['pub', 150, 160, 200, 56, 'Public DNS answers', 'the link appears', 6]
  ],
  edges: [['al', 'kc', 2, 're-applied'], ['kc', 'rl', 3, ''], ['rl', 'alb', 4, ''], ['alb', 'r53', 5, ''], ['r53', 'pub', 6, '']]
},
signin: { w: 760, h: 260,
  nodes: [
    ['br', 20, 100, 140, 58, 'Your browser', 'your address allowed', 1, { also: [2, 3, 4] }],
    ['alb', 210, 100, 130, 58, 'ALB', 'allowlist + TLS', 1, { also: [4] }],
    ['po', 400, 20, 160, 58, 'CSOC portal', 'portal.<your-domain>', 2, { also: [4, 5] }],
    ['kc', 400, 180, 160, 58, 'Keycloak', 'auth.<your-domain>', 3, { also: [4] }],
    ['pg', 600, 180, 145, 58, 'Postgres (CNPG)', 'users, sessions', 3],
    ['aws', 600, 20, 145, 58, 'AWS (IRSA)', 'state bucket, ACM…', 5]
  ],
  edges: [['br', 'alb', 1, 'https'], ['alb', 'po', 2, ''], ['po', 'br', 2, '', { back: 1, bend: -50 }], ['br', 'kc', 3, 'sign in', { bend: 40 }], ['kc', 'pg', 3, ''],
    ['po', 'kc', 4, 'confirms the sign-in', { bend: 30 }], ['po', 'aws', 5, 'Connected to AWS']]
},
agent: { w: 760, h: 260,
  groups: [[200, 10, 550, 240, 'CSOC cluster', 0, { solid: 1 }]],
  nodes: [
    ['po', 20, 100, 150, 58, 'Portal', 'Deploy Agent', 1],
    ['api', 230, 40, 160, 58, 'CSOC API', 'creates the agent', 1, { also: [2, 3, 5] }],
    ['ca', 230, 160, 160, 58, 'CSOC CA', 'issues a certificate', 2, { b: 1 }],
    ['mf', 440, 40, 160, 58, 'Agent install', 'with its certificate', 3, { b: 1 }],
    ['ag', 440, 160, 160, 58, 'Agent pod', 'dials out', 4, { b: 1, also: [5] }],
    ['grpc', 620, 100, 120, 58, 'CSOC endpoint', 'gRPC', 4, { also: [5] }]
  ],
  edges: [['po', 'api', 1, ''], ['api', 'ca', 2, 'issue cert'], ['api', 'mf', 3, 'apply'], ['mf', 'ag', 4, ''], ['ag', 'grpc', 4, 'mTLS'], ['grpc', 'api', 5, 'registered', { back: 1, bend: -40 }]]
},
gen3: { w: 760, h: 400,
  groups: [[200, 120, 550, 270, 'CSOC cluster', 0, { solid: 1 }], [215, 250, 325, 125, 'namespace commons-a', 6, {}]],
  nodes: [
    ['po', 20, 150, 150, 56, 'Portal', 'Gen3 Deployment Wizard', 1, { also: [2, 3] }],
    ['acm', 20, 20, 150, 52, 'ACM', 'commons-a certificate', 1, { b: 1 }],
    ['z', 220, 20, 170, 52, 'Route 53 zone', '<your-domain>', 1, { also: [8] }],
    ['kc', 420, 20, 160, 52, 'Keycloak', 'registers the commons', 2, { b: 1, also: [9] }],
    ['api', 220, 150, 150, 52, 'CSOC API', 'forwards the install', 3, { also: [4] }],
    ['ag', 400, 150, 140, 52, 'Agent', 'helm install', 4, { also: [5] }],
    ['dns', 570, 150, 165, 52, 'external-dns', 'watches Ingresses', 8, { b: 1 }],
    ['pods', 230, 280, 295, 40, 'Fence · Arborist · Indexd · Sheepdog · …', '+ local Postgres', 6, { b: 1 }],
    ['ing', 230, 327, 295, 40, 'Load balancer', 'with the commons certificate', 7, { b: 1, also: [9] }],
    ['you', 570, 280, 165, 52, 'You', 'log in as admin', 9]
  ],
  edges: [['po', 'acm', 1, 'request'], ['po', 'z', 1, 'validation', { bend: -30 }], ['po', 'kc', 2, 'Use CSOC login', { bend: 20 }], ['po', 'api', 3, 'values'], ['api', 'ag', 4, 'gRPC mTLS'],
    ['ag', 'pods', 5, 'helm'], ['ing', 'dns', 8, '', { bend: -20 }], ['dns', 'z', 8, 'commons-a CNAME'], ['you', 'ing', 9, 'https']]
},
teardown: { w: 760, h: 270,
  nodes: [
    ['lm', 20, 20, 165, 52, 'Route-check function', 'removed first', 1],
    ['lb', 205, 20, 165, 52, 'Ingresses + LBs', 'ALBs, NLBs, SGs', 2],
    ['ns', 390, 20, 165, 52, 'Apps + namespaces', 'CSOC, Keycloak, commons', 3],
    ['vol', 575, 20, 165, 52, 'Volumes + nodes', 'EBS, Karpenter EC2', 4],
    ['dns', 575, 120, 165, 52, 'DNS + secrets', 'CSOC records, secrets', 5],
    ['tf', 300, 120, 240, 52, 'terraform destroy', 'cluster, IAM, Squid, NAT, VPC', 6],
    ['zb', 300, 210, 240, 52, 'Zone, then bucket', 'optional, last', 7]
  ],
  edges: [['lm', 'lb', 2, ''], ['lb', 'ns', 3, ''], ['ns', 'vol', 4, ''], ['vol', 'dns', 5, ''], ['dns', 'tf', 6, 'uninstall done'], ['tf', 'zb', 7, '']]
}
};

function clip(cx, cy, hw, hh, dx, dy) {
  var tx = dx ? hw / Math.abs(dx) : Infinity, ty = dy ? hh / Math.abs(dy) : Infinity, t = Math.min(tx, ty);
  return [cx + dx * t, cy + dy * t];
}
function txt(v) { return typeof v === 'function' ? v() : (v || ''); }
function fit(t, w, px) { var max = Math.floor((w - 10) / px); return t.length > max ? t.slice(0, Math.max(1, max - 1)) + '…' : t; }

if ($('figure.anim')) {
  var defs = document.createElement('div');
  defs.innerHTML = '<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs>' +
    '<marker id="m-dim" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#8f98b3"/></marker>' +
    '<marker id="m-act" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#4c6ef5"/></marker>' +
    '<marker id="m-back" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#15aabf"/></marker>' +
    '</defs></svg>';
  document.body.insertBefore(defs.firstChild, document.body.firstChild);
}

function Diagram(fig) {
  var name = fig.getAttribute('data-dg'), self = this;
  this.fig = fig; this.spec = SPECS[name]; this.caps = $$('ol.caps li', fig); this.n = this.caps.length;
  // Every diagram starts complete ("at rest"); Play walks through the order.
  this.frame = this.n; this.timer = null; this.rest = true;
  var ctl = $('.ctl', fig);
  ctl.innerHTML = '<button type="button" class="rs" aria-label="Back to start">⏮</button>' +
    '<button type="button" class="pv" aria-label="Previous step">◀</button>' +
    '<button type="button" class="play" aria-label="Play">▶ Play</button>' +
    '<button type="button" class="nx" aria-label="Next step">▶|</button>' +
    '<span class="fr" aria-live="polite"></span>';
  ctl.setAttribute('role', 'group'); ctl.setAttribute('aria-label', 'Diagram controls');
  ctl.addEventListener('click', function () { self.rest = false; }, true);
  $('.rs', ctl).addEventListener('click', function () { self.stop(); self.go(0); });
  $('.pv', ctl).addEventListener('click', function () { self.stop(); self.go(Math.max(0, self.frame - 1)); });
  $('.nx', ctl).addEventListener('click', function () { self.stop(); self.go(Math.min(self.n, self.frame + 1)); });
  $('.play', ctl).addEventListener('click', function () { if (self.timer) self.stop(); else self.play(); });
  this.caps.forEach(function (li, i) {
    li.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('a')) return; self.rest = false; self.stop(); self.go(i + 1); });
  });
  this.render();
}
Diagram.prototype.render = function () {
  var s = this.spec, h = [], byId = {}, labels = [], label = this.fig.getAttribute('data-label') || this.fig.getAttribute('data-dg');
  var list = $('ol.caps', this.fig);
  h.push('<svg class="dg" viewBox="0 0 ' + s.w + ' ' + s.h + '" role="img" aria-label="Diagram: ' + esc(label) + '"' + (list && list.id ? ' aria-describedby="' + list.id + '"' : '') + '>');
  (s.groups || []).forEach(function (g) {
    var o = g[6] || {}, link = o.go ? ' data-go="' + o.go + '"' : '';
    h.push('<g class="grp' + (o.solid ? ' solid' : '') + '" data-f="' + g[5] + '"' + link + '><rect x="' + g[0] + '" y="' + g[1] + '" width="' + g[2] + '" height="' + g[3] + '" rx="12"/>' +
      '<text x="' + (g[0] + 12) + '" y="' + (g[1] + 16) + '">' + esc(g[4]) + '</text></g>');
  });
  s.nodes.forEach(function (n) { byId[n[0]] = n; });
  s.edges.forEach(function (e) {
    var a = byId[e[0]], b = byId[e[1]], o = e[4] || {};
    var ax = a[1] + a[3] / 2, ay = a[2] + a[4] / 2, bx = b[1] + b[3] / 2, by = b[2] + b[4] / 2;
    var mx = (ax + bx) / 2, my = (ay + by) / 2, dx = bx - ax, dy = by - ay, len = Math.sqrt(dx * dx + dy * dy) || 1;
    var bend = o.bend || 0, cx = mx - dy / len * bend, cy = my + dx / len * bend;
    var p1 = clip(ax, ay, a[3] / 2 + 3, a[4] / 2 + 3, cx - ax, cy - ay);
    var p2 = clip(bx, by, b[3] / 2 + 5, b[4] / 2 + 5, cx - bx, cy - by);
    var d = bend ? 'M' + p1[0].toFixed(1) + ',' + p1[1].toFixed(1) + ' Q' + cx.toFixed(1) + ',' + cy.toFixed(1) + ' ' + p2[0].toFixed(1) + ',' + p2[1].toFixed(1)
      : 'M' + p1[0].toFixed(1) + ',' + p1[1].toFixed(1) + ' L' + p2[0].toFixed(1) + ',' + p2[1].toFixed(1);
    var lx = bend ? 0.25 * p1[0] + 0.5 * cx + 0.25 * p2[0] : (p1[0] + p2[0]) / 2;
    var ly = bend ? 0.25 * p1[1] + 0.5 * cy + 0.25 * p2[1] : (p1[1] + p2[1]) / 2;
    var cls = 'e' + (o.back ? ' back' : ''), fa = '" data-f="' + e[2] + '"' + (o.also ? ' data-also="' + o.also.join(',') + '"' : '');
    h.push('<g class="' + cls + fa + '><path d="' + d + '"/></g>');
    if (e[3]) {
      var tw = e[3].length * 6.2, gx = Math.abs(p2[0] - p1[0]), gy = Math.abs(p2[1] - p1[1]), anchor = 'middle', ty = ly - 4, tx = lx;
      if (!bend && gx >= gy && tw > gx - 6) { ty = Math.min(a[2], b[2]) - 6; }
      else if (!bend && gy > gx && gy < 34) { tx = lx + 7; ty = ly + 4; anchor = 'start'; }
      labels.push('<g class="' + cls + fa + '><text x="' + tx.toFixed(1) + '" y="' + ty.toFixed(1) + '" text-anchor="' + anchor + '">' + esc(e[3]) + '</text></g>');
    }
  });
  s.nodes.forEach(function (n) {
    var o = n[8] || {}, cx = n[1] + n[3] / 2, full = txt(n[6]), sub = fit(full, n[3], 5.9), lab = fit(txt(n[5]), n[3], 7.4);
    var link = o.go ? ' data-go="' + o.go + '"' : '';
    h.push('<g class="n' + (o.b ? ' b' : '') + '" data-f="' + n[7] + '"' + (o.also ? ' data-also="' + o.also.join(',') + '"' : '') + link + '>' +
      '<title>' + esc(txt(n[5]) + (full ? ': ' + full : '')) + '</title><rect x="' + n[1] + '" y="' + n[2] + '" width="' + n[3] + '" height="' + n[4] + '" rx="8"/>' +
      '<text class="t" x="' + cx + '" y="' + (n[2] + n[4] / 2 - (sub ? 3 : -4)) + '" text-anchor="middle">' + esc(lab) + '</text>' +
      (sub ? '<text class="s" x="' + cx + '" y="' + (n[2] + n[4] / 2 + 13) + '" text-anchor="middle">' + esc(sub) + '</text>' : '') + '</g>');
  });
  h.push(labels.join(''), '</svg>');
  $('.svgwrap', this.fig).innerHTML = h.join('');
  $$('[data-go]', this.fig).forEach(function (el) {
    function jump() { location.href = ROOT + el.getAttribute('data-go') + '.html#whats-happening'; }
    el.addEventListener('click', jump);
  });
  this.go(this.frame);
};
Diagram.prototype.go = function (f) {
  var self = this; this.frame = f;
  $$('[data-f]', this.fig).forEach(function (el) {
    var k = +el.getAttribute('data-f'), also = (el.getAttribute('data-also') || '').split(',').filter(Boolean).map(Number);
    var act = !self.rest && f > 0 && (k === f || also.indexOf(f) >= 0);
    el.classList.toggle('act', act);
    el.classList.toggle('pend', k > f);
    el.classList.toggle('done', k <= f && !act);
  });
  this.caps.forEach(function (li, i) {
    var cur = !self.rest && i === f - 1;
    li.classList.toggle('cur', cur); li.classList.toggle('seen', !self.rest && i < f - 1);
    if (cur) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
  });
  $('.fr', this.fig).textContent = this.rest ? 'Showing everything. Press Play to see the order (' + this.n + ' steps).' : f === 0 ? 'Press Play or step through (' + this.n + ' steps)' : 'Step ' + f + ' of ' + this.n;
};
Diagram.prototype.play = function () {
  var self = this; if (this.timer) return;
  this.rest = false;
  if (this.frame >= this.n) this.go(0);
  var b = $('.play', this.fig); b.textContent = '❚❚ Pause'; b.setAttribute('aria-label', 'Pause');
  var tick = function () { if (self.frame >= self.n) { self.stop(); return; } self.go(self.frame + 1); };
  tick(); this.timer = setInterval(tick, REDUCE ? 4000 : 2600);
};
Diagram.prototype.stop = function () {
  if (this.timer) { clearInterval(this.timer); this.timer = null; }
  var b = $('.play', this.fig); b.textContent = '▶ Play'; b.setAttribute('aria-label', 'Play');
};
$$('figure.anim').forEach(function (f) { if (SPECS[f.getAttribute('data-dg')]) DIAGS.push(new Diagram(f)); });

/* ---------- print: every diagram complete, every <details> open ---------- */
var opened = [];
window.addEventListener('beforeprint', function () {
  DIAGS.forEach(function (d) { d.stop(); d._pf = d.frame; d._pr = d.rest; d.rest = true; d.go(d.n); });
  $$('details:not([open])').forEach(function (x) { x.setAttribute('open', ''); opened.push(x); });
});
window.addEventListener('afterprint', function () {
  DIAGS.forEach(function (d) { d.rest = d._pr; d.go(d._pf); });
  opened.forEach(function (x) { x.removeAttribute('open'); }); opened = [];
});

})();
