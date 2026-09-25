// Builds the project site pages (site/index.html, site/<lang>/index.html) from
// scripts/site-text.json.
//
// Usage: node scripts/build-site.mjs
//
// Page copy lives in site-text.json (a \n in the headline marks where it
// breaks). Shared CSS/JS and images are in site/assets/ and are edited
// directly. Published to GitHub Pages by .github/workflows/pages.yml.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const T = JSON.parse(readFileSync(join(ROOT, 'scripts', 'site-text.json'), 'utf8'));

const BASE = 'https://tasict.github.io/homebridge-mqttthing-ex/';
const REPO = 'https://github.com/tasict/homebridge-mqttthing-ex';
const NPM = 'https://www.npmjs.com/package/homebridge-mqttthing-ex';
const UPSTREAM = 'https://github.com/arachnetech/homebridge-mqttthing';
const PAYPAL = 'https://paypal.me/tasict';
const BOBA = 'https://tasict.bobaboba.me';

// [hreflang, directory, html lang, native name, og locale]
const LANGS = [
  ['en', '', 'en', 'English', 'en_US'],
  ['zh-TW', 'zh-TW/', 'zh-Hant-TW', '繁體中文', 'zh_TW'],
  ['ja', 'ja/', 'ja', '日本語', 'ja_JP'],
];

// The demo's topics, also used by the configuration example so both show the same accessory.
const TOPICS = {
  setOn: 'living/lamp/setOn',
  getOn: 'living/lamp/getOn',
  setBrightness: 'living/lamp/setBrightness',
  getBrightness: 'living/lamp/getBrightness',
};
const QUEUE_MS = 300;

const GLOBE =
  '<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="10" cy="10" r="7.5"/><path d="M2.5 10h15M10 2.5c2.2 2.3 3.2 4.8 3.2 7.5s-1 5.2-3.2 7.5c-2.2-2.3-3.2-4.8-3.2-7.5s1-5.2 3.2-7.5z"/></svg>';
const BULB =
  '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6M10 21.5h4M12 2.5a6.5 6.5 0 0 0-4 11.6c.7.6 1 1.3 1 2.1V17h6v-.8c0-.8.4-1.5 1-2.1a6.5 6.5 0 0 0-4-11.6z"/></svg>';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' };
const e = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);
// Copy may mark code with `backticks`; everything else is escaped.
const rich = (s) => e(s).replace(/`([^`]+)`/g, '<code>$1</code>');

/**
 * One MQTT connection per accessory versus one per broker: devices on the
 * left, the broker on the right, and a line for every connection.
 */
function connections(shared, label) {
  const n = 12;
  const rows = Array.from({ length: n }, (_, i) => 22 + i * 24);
  const broker = { x: 316, y: 154 };
  const hub = { x: 170, y: 154 };
  const devices = rows.map((y) => `<rect class="dev" x="14" y="${y - 7}" width="26" height="14" rx="4"/>`).join('');
  const lines = shared
    ? rows.map((y) => `<path class="wire" d="M40 ${y}C105 ${y} 110 ${hub.y} ${hub.x - 14} ${hub.y}"/>`).join('') +
      `<path class="conn" d="M${hub.x + 14} ${hub.y}H${broker.x - 26}"/>` +
      `<circle class="hub" cx="${hub.x}" cy="${hub.y}" r="14"/>`
    : rows.map((y) => `<path class="conn" d="M40 ${y}C180 ${y} 210 ${broker.y} ${broker.x - 26} ${broker.y}"/>`).join('');
  return `<svg class="conns" viewBox="0 0 360 310" role="img" aria-label="${e(label)}">${lines}${devices}<circle class="broker" cx="${broker.x}" cy="${broker.y}" r="26"/><text x="${broker.x}" y="${broker.y + 5}" text-anchor="middle">MQTT</text></svg>`;
}

// The configuration example: the demo lamp as an accessory block, exactly as homebridge-mqttthing wrote it.
const CONFIG = `{
  <span class="k">"accessory"</span>: <span class="s">"mqttthing"</span>,
  <span class="k">"type"</span>: <span class="s">"lightbulb"</span>,
  <span class="k">"name"</span>: <span class="s">"Living Room Lamp"</span>,
  <span class="k">"url"</span>: <span class="s">"mqtt://broker.local:1883"</span>,
  <span class="k">"topics"</span>: {
    <span class="k">"setOn"</span>: <span class="s">"${TOPICS.setOn}"</span>,
    <span class="k">"getOn"</span>: <span class="s">"${TOPICS.getOn}"</span>,
    <span class="k">"setBrightness"</span>: <span class="s">"${TOPICS.setBrightness}"</span>,
    <span class="k">"getBrightness"</span>: <span class="s">"${TOPICS.getBrightness}"</span>
  }
}`;

// Root page only: send first-time visitors to their browser language; an explicit choice (saved by site.js) wins.
const REDIRECT = `<script>
try {
  if (!localStorage.getItem('lang')) {
    const pick = tag => {
      const t = tag.toLowerCase();
      if (t.startsWith('zh')) return 'zh-TW';
      return ['ja', 'en'].find(l => t.startsWith(l));
    };
    const lang = (navigator.languages || [navigator.language]).map(pick).find(Boolean);
    if (lang && lang !== 'en') location.replace(lang + '/' + location.search + location.hash);
  }
} catch { /* storage blocked: stay on English */ }
</script>
`;

function page([code, dir, htmlLang, native, og]) {
  const t = T[code];
  const up = dir ? '../' : '';
  const a = `${up}assets/`;

  const alts = LANGS.map(([c, d]) => `<link rel="alternate" hreflang="${c}" href="${BASE}${d}">`).join('\n');
  const menu = LANGS.map(
    ([c, d, hl, nm]) =>
      `<li><a href="${up + d || './'}" hreflang="${c}" lang="${hl}"${c === code ? ' aria-current="page"' : ''}>${e(nm)}</a></li>`,
  ).join('');
  const pairs = (items, tag = 'li') =>
    items.map(([h, p]) => `<${tag}><h3>${e(h)}</h3><p>${rich(p)}</p></${tag}>`).join('');

  // Demo strings and topics for site.js.
  const demo = { ...t.demo, topics: TOPICS, queueMs: QUEUE_MS };
  const types = t.types
    .map(([group, names]) => `<div><dt>${e(group)}</dt><dd>${names.map((n) => `<span>${e(n)}</span>`).join('')}</dd></div>`)
    .join('');
  const modes = t.modes
    .map(
      ([h, rows], i) =>
        `<figure class="mode${i ? ' is-platform' : ''}">
        <figcaption><h3>${e(h)}</h3><p class="count">${e(rows.count)}</p></figcaption>
        ${connections(i === 1, rows.alt)}
      </figure>`,
    )
    .join('\n      ');

  return `<!doctype html>
<html lang="${htmlLang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(t.title)}</title>
<meta name="description" content="${e(t.desc)}">
<link rel="canonical" href="${BASE}${dir}">
${alts}
<link rel="alternate" hreflang="x-default" href="${BASE}">
<meta property="og:type" content="website">
<meta property="og:title" content="${e(t.title)}">
<meta property="og:description" content="${e(t.desc)}">
<meta property="og:url" content="${BASE}${dir}">
<meta property="og:image" content="${BASE}assets/og.png">
<meta property="og:locale" content="${og}">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#f8f5f9" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#150d17" media="(prefers-color-scheme: dark)">
<link rel="icon" href="${a}icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="${a}icon.png">
<link rel="stylesheet" href="${a}site.css">
${dir ? '' : REDIRECT}</head>
<body>
<header class="wrap masthead">
  <a class="wordmark" href="./"><img src="${a}icon.svg" alt="" width="30" height="30">MQTT Thing EX</a>
  <a href="${REPO}">${e(t.source)}</a>
  <a class="tip head-tip" href="${BOBA}" aria-label="${e(t.boba)}"><img src="${a}boba.png" alt="" width="24" height="24"><span>${e(t.boba)}</span></a>
  <details class="lang">
    <summary aria-label="${e(t.lang_menu)}">${GLOBE}<span>${e(native)}</span></summary>
    <ul>${menu}</ul>
  </details>
</header>

<main>
<div class="wrap">
  <section class="hero" aria-labelledby="hero-title">
    <div class="hero-copy">
      <h1 id="hero-title">${e(t.h1).replace(/\n/g, '<br>')}</h1>
      <p class="lede">${rich(t.lede)}</p>
      <div class="actions">
        <a class="btn" href="#start">${e(t.cta)}</a>
        <a href="${REPO}">${e(t.github)}</a>
      </div>
      <p class="fine">${e(t.fine)}</p>
    </div>
    <div class="stage" data-demo data-t='${e(JSON.stringify(demo))}'>
      <div class="tile" data-on>
        <div class="tile-head">
          <span class="tile-icon">${BULB}</span>
          <div class="tile-name"><strong>${e(t.demo.name)}</strong><span data-status aria-live="polite"></span></div>
          <button type="button" class="power" role="switch" aria-checked="true" aria-label="${e(t.demo.power)}" data-power><span></span></button>
        </div>
        <label class="bright">
          <span class="bright-label">${e(t.demo.brightness)}</span>
          <input type="range" min="1" max="100" value="70" data-bright>
        </label>
      </div>
      <div class="wire-log">
        <div class="log-head">
          <span>${e(t.demo.log)}</span>
          <label class="queue"><input type="checkbox" data-queue checked><span class="mini-switch" aria-hidden="true"></span><code>publishMinIntervalms: ${QUEUE_MS}</code></label>
        </div>
        <ol class="log" data-log aria-live="off"></ol>
        <p class="tally" data-tally aria-live="polite"></p>
      </div>
      <p class="hint">${e(t.demo.hint)}</p>
    </div>
  </section>

  <section class="band" aria-labelledby="h-same">
    <div class="split">
      <div class="intro">
        <h2 id="h-same">${e(t.same_h2)}</h2>
        <p>${rich(t.same_p)}</p>
        <ol class="moves">${pairs(t.moves)}</ol>
        <p class="back">${rich(t.same_note)}</p>
      </div>
      <figure class="code">
        <figcaption>config.json</figcaption>
        <pre><code>${CONFIG}</code></pre>
      </figure>
    </div>
  </section>

  <section class="band" aria-labelledby="h-platform">
    <div class="intro">
      <h2 id="h-platform">${e(t.platform_h2)}</h2>
      <p>${rich(t.platform_p)}</p>
    </div>
    <div class="modes">
      ${modes}
    </div>
    <ul class="feats compact">${pairs(t.platform_points)}</ul>
  </section>

  <section class="band" aria-labelledby="h-feat">
    <div class="intro">
      <h2 id="h-feat">${e(t.feat_h2)}</h2>
      <p>${rich(t.feat_p)}</p>
    </div>
    <ul class="feats">${pairs(t.feats)}</ul>
  </section>

  <section class="band" aria-labelledby="h-types">
    <div class="intro">
      <h2 id="h-types">${e(t.types_h2)}</h2>
      <p>${rich(t.types_p)}</p>
    </div>
    <dl class="types">${types}</dl>
    <p class="fine">${e(t.types_note)} <a href="${REPO}/blob/master/docs/Accessories.md">${e(t.types_link)}</a></p>
  </section>

  <section class="band" id="start" aria-labelledby="h-start">
    <h2 id="h-start">${e(t.start_h2)}</h2>
    <ol class="steps">${pairs(t.steps)}</ol>
    <p class="fine">${e(t.start_note)} <a href="${REPO}/blob/master/docs/Configuration.md">${e(t.docs)}</a></p>
  </section>

  <section class="band" aria-labelledby="h-support">
    <div class="tipjar">
      <img src="${a}boba.png" alt="" width="120" height="120">
      <div>
        <h2 id="h-support">${e(t.support_h2)}</h2>
        <p>${e(t.support_p)}</p>
        <div class="actions">
          <a class="btn" href="${BOBA}"><img src="${a}boba.png" alt="" width="22" height="22">${e(t.boba)}</a>
          <a class="tip" href="${PAYPAL}">${e(t.paypal)}</a>
        </div>
        <p class="fine">${e(t.support_card)}</p>
      </div>
    </div>
  </section>
</div>
</main>

<footer>
  <div class="wrap">
    <div class="foot">
      <div>
        <p>${e(t.made)} <a href="${UPSTREAM}">${e(t.upstream)}</a></p>
        <ul>
          <li><a href="${REPO}">${e(t.source)}</a></li>
          <li><a href="${NPM}">${e(t.npm)}</a></li>
          <li><a href="${REPO}/blob/master/CHANGELOG.md">${e(t.changelog)}</a></li>
          <li><a href="${REPO}/issues">${e(t.issues)}</a></li>
        </ul>
      </div>
      <ul class="langs">${menu}</ul>
    </div>
    <p class="tm">${e(t.tm)}</p>
  </div>
</footer>
<script src="${a}site.js"></script>
</body>
</html>
`;
}

for (const lang of LANGS) {
  const file = join(ROOT, 'site', lang[1], 'index.html');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, page(lang));
  console.log('wrote', relative(ROOT, file));
}
