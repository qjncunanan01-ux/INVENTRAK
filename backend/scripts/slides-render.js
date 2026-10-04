#!/usr/bin/env node
// Turns the ALGORITHMS.md model (see build-slides.js) into a single
// self-contained HTML slide deck.
//
// Two rules govern this file:
//
//   1. THE PLAN CANNOT INVENT. Every slide names the ALGORITHMS.md elements it
//      shows ("§7:Basis — unit normalisation", "verify:@intro#table:0"). There is
//      no place to type a number, a figure or a claim: if it is not in the
//      document it cannot be on a slide. The handful of strings below are
//      presentation scaffolding only — slide titles, subtitles and part-divider
//      furniture — and they are worded to assert nothing the document does not.
//
//   2. NOTHING MAY GO MISSING. After the plan is resolved, every element of
//      every section of ALGORITHMS.md must have been placed on exactly one
//      slide, or be listed in HELD_BACK with a reason. A build that would drop
//      content, or show it twice, fails instead of quietly shipping.
const crypto = require('node:crypto');

const { inline, tableHtml } = require('./build-slides.js');

// The deck runs in five colours. `part` is the PART heading the slide belongs
// to, taken from the document; `meta` is everything that is not an algorithm.
// The values live in CSS (--acc per .k-A … .k-meta), so there is nothing to
// keep in sync here — partKeyOf() only has to name the band.

/**
 * The slide plan. `pick` entries are refs of the form
 *   sectionId:blockNamePrefix[#name:occurrence | #!name:occurrence]
 * A block name is matched by exact text first, then by unique prefix; an
 * ambiguous prefix is an error, never a silent first-match.
 *   §7:Basis                 -> all elements of that "### ..." subsection
 *   §7:Basis#table:0         -> only its first table
 *   §16:@intro#para:0        -> only the **Question:** line
 *   §16:@intro#!para:0       -> everything in the intro except that line
 * `say` lists rehearsal row numbers whose "What to say" line becomes this
 * slide's speaker strip. Each rehearsal row appears on exactly one slide.
 */
const PLAN = [
  {
    kind: 'title',
    pick: ['front:@intro'],
  },
  {
    sec: 'rehearsal',
    pick: ['rehearsal:@intro#para:0'],
    title: 'How to show this without showing the code',
    subtitle: 'Read this part out loud. It is the whole rehearsal.',
    footer: 'Nothing below needs the source opened. Every algorithm is visible in the running app.',
  },
  {
    sec: 'rehearsal',
    pick: ['rehearsal:@intro#table:0[1-9]'],
    title: 'The rehearsal table, as the running order (1–9)',
    subtitle: 'Seventeen algorithms. Seventeen screen moves. No code, no slides of source.',
  },
  {
    sec: 'rehearsal',
    pick: ['rehearsal:@intro#table:0[10-17]'],
    title: 'The rehearsal table, as the running order (10–17)',
    subtitle: 'The pricing, costing and counter-sales half.',
  },
  {
    sec: 'rehearsal',
    pick: ['rehearsal:@intro#para:1'],
    title: 'If a panel member says "prove it"',
    subtitle: 'The single strongest move available in this project.',
    hero: true,
  },
  {
    sec: 'map',
    pick: ['map:@intro#code:0'],
    hero: true,
  },

  // ---- PART A -------------------------------------------------------------
  { kind: 'part', sec: '§1' },
  {
    sec: '§1',
    pick: ['§1:@intro#para:0', '§1:Basis — the Pareto principle', '§1:Formula (as implemented'],
    say: [1],
  },
  {
    sec: '§1',
    pick: ['§1:Live result — the Pareto shape', '§1:The A-list top 7'],
    title: 'ABC — what the running endpoint reports',
    subtitle: 'Every figure on this slide is the endpoint\'s own output.',
  },
  {
    sec: '§2',
    pick: ['§2:@intro#para:0', '§2:Basis — usage-rate classification', '§2:Formula (as implemented'],
    say: [2],
  },
  {
    sec: '§2',
    pick: ['§2:Live result — 90-day window'],
    title: 'FSN — the window is stamped on purpose',
    subtitle: 'Recency is measured against today, so this slide is dated.',
  },
  {
    sec: '§3',
    pick: ['§3:@intro#para:0', '§3:Basis — the Harris classical'],
    subtitle: 'Two costs, opposing, and the crossing point is the answer.',
  },
  {
    sec: '§3',
    pick: ['§3:Formula (as implemented)', '§3:Worked example — Da Vinci Caramel Sauce#!table:0'],
    say: [3],
  },
  {
    sec: '§3',
    pick: ['§3:Worked example — Da Vinci Caramel Sauce#table:0'],
    title: 'Turnover ratio',
    subtitle: 'Capital parked on shelves — the column the owners never look at.',
    say: [7],
  },
  {
    sec: '§4',
    pick: ['§4:@intro#para:0', '§4:ROP + Safety Stock (as implemented)'],
    say: [4],
  },
  {
    sec: '§4',
    pick: ['§4:Critical Level — the per-product threshold', '§4:Formula#code:0', '§4:Formula#table:0', '§4:Formula#para:0'],
    subtitle: 'Per-product, not one flat number.',
    say: [5],
  },
  {
    sec: '§4',
    pick: ['§4:Formula#!code:0,table:0,para:0'],
    title: 'Critical level — the motivating case, and the badge ladder',
    subtitle: 'A fast mover selling 40 a day, and what the badges do with the answer.',
  },
  {
    sec: '§5',
    pick: ['§5:@intro#para:0', '§5:Basis — the two classical issue disciplines', '§5:Formula (the consumption sort'],
    say: [6],
  },

  // ---- PART B -------------------------------------------------------------
  { kind: 'part', sec: '§6' },
  {
    sec: '§6',
    pick: ['§6:@intro#para:0', '§6:Basis — gross margin on price'],
    say: [8],
  },
  {
    sec: '§6',
    pick: ['§6:The rounding detail worth defending', '§6:Live result'],
    title: 'Target margin — the rounding detail worth defending',
    subtitle: 'Rounded up, on purpose. Rounding to nearest leaves the row flagged forever.',
  },
  {
    sec: '§7',
    pick: ['§7:@intro#para:0', '§7:Basis — unit normalisation'],
    say: [9],
  },
  {
    sec: '§7',
    pick: ['§7:The bug this design guards against', '§7:Conservative by construction'],
    title: 'Cost normalisation — the bug it exists to prevent',
    subtitle: 'And why a parse that is not sure must fail closed.',
  },
  {
    sec: '§7',
    pick: ['§7:Live result'],
    title: 'Cost normalisation — the reading, and the gap',
  },
  {
    sec: '§8',
    pick: ['§8:@intro#para:0', '§8:Basis — ambiguity must resolve'],
    say: [10],
  },
  {
    sec: '§9',
    pick: ['§9:@intro#para:0', '§9:Basis — derived figures must be frozen'],
    say: [11],
  },
  {
    sec: '§10',
    pick: ['§10:@intro#para:0', '§10:Basis — deterministic entity resolution'],
    say: [12],
  },

  // ---- PART C -------------------------------------------------------------
  { kind: 'part', sec: '§11' },
  {
    sec: '§11',
    pick: ['§11:@intro#para:0', '§11:Basis — role hierarchies'],
    say: [13],
  },
  {
    sec: '§12',
    pick: ['§12:Basis — throttling a sustained attack'],
    say: [14],
  },
  {
    sec: '§13',
    pick: ['§13:Basis — RFC 6238'],
    say: [15],
  },

  // ---- PART D -------------------------------------------------------------
  { kind: 'part', sec: '§16' },
  {
    sec: '§16',
    pick: ['§16:@intro', '§16:The request'],
    subtitle: 'A customer walks in, pays, and walks out.',
  },
  {
    sec: '§16',
    pick: ['§16:What the server does, in order'],
    title: 'The counter sale — eight steps, in server order',
    subtitle: 'Read the "Why it is that way" column. That is the design, not the code.',
  },
  {
    sec: '§16',
    pick: ['§16:Showing it without showing the code'],
    say: [16],
  },
  {
    sec: '§16',
    pick: ['§16:The bug this design closed'],
    title: 'The bug this design closed',
    subtitle: 'Found by running the previous commit against the same seed — not by reading code.',
  },
  {
    sec: '§16',
    pick: ['§16:The parity bug behind it'],
    title: 'Why the counter and the back-room cannot drift',
  },
  {
    sec: '§17',
    pick: ['§17:@intro#para:0', '§17:Basis — and the two things it refuses', '§17:Formula'],
    subtitle: 'Two facts constrain the whole design, and both were found by reading the schema.',
  },
  {
    sec: '§17',
    pick: ['§17:Worked example — verified against the running backend', '§17:What it deliberately does not claim'],
    title: 'Reconciliation — the finding, and what it refuses to call it',
    say: [17],
  },
  {
    sec: '§17',
    pick: ['§17:The bug worth defending'],
    title: 'The reconciliation bug worth defending',
    subtitle: 'Found by running the report, not by reading it.',
  },

  // ---- VERIFICATION -------------------------------------------------------
  { kind: 'part', sec: 'verify' },  {
    sec: 'verify',
    pick: ['verify:@intro#code:0', 'verify:@intro#para:0'],
    hero: true,
  },
  {
    sec: 'verify',
    pick: ['verify:@intro#table:0'],
    title: 'Which test locks which claim',
    subtitle: 'Every assertion this deck makes has a suite that fails if it stops being true.',
  },
  {
    sec: 'verify',
    pick: ['verify:Reproducing the dataset figures'],
    title: 'Reproducible, not hand-typed',
  },
  {
    kind: 'closing',
    pick: ['rehearsal:@intro#para:1'],
    title: 'Questions',
  },
];

// Content deliberately kept off the deck. Empty by design: every element of
// ALGORITHMS.md belongs on a slide.
const HELD_BACK = {};

// The closing slide deliberately re-states the "if a panel says prove it"
// paragraph. One repeat, named here, instead of a silent duplicate.
const ALLOW_REPEAT = new Set(['rehearsal:@intro#para:1', 'rehearsal:@intro#table:0']);

// ---------------------------------------------------------------------------
// Ref resolution + coverage accounting
// ---------------------------------------------------------------------------

/** key an element by block, name and occurrence so it can be counted exactly. */
function elementKey(block, el, i) {
  const occ = block.els.slice(0, i).filter((e) => e.name === el.name).length;
  return block.id + '#' + el.name + ':' + occ;
}

function findBlock(sec, ref) {
  const blocks = (sec.intro ? [sec.intro] : []).concat(sec.blocks);
  const exact = blocks.filter((b) => b.name === ref);
  if (exact.length) return exact[0];
  const prefix = blocks.filter((b) => b.name.startsWith(ref));
  if (prefix.length === 1) return prefix[0];
  if (!prefix.length) {
    const near = blocks.map((b) => b.name).join(' / ');
    throw new Error('slide plan references "' + ref + '" but ' + sec.id + ' has no such block.\n    blocks: ' + near);
  }
  throw new Error(
    'slide plan references "' + ref + '" in ' + sec.id + ' ambiguously; it matches: ' + prefix.map((b) => b.name).join(' / '),
  );
}

/** Apply an optional `#name:occ` selector to a block. The target list may name
 *  several elements (`#code:0,table:0`); a leading `!` inverts it, so
 *  `#!code:0,para:0` is "everything except those two" — which is how one
 *  subsection is split across two slides without either half repeating.
 *  A trailing `[a-b]` narrows a table to those rows, keeping the header: a
 *  17-row table is unreadable on one slide, and splitting it beats shrinking
 *  the type. */
function selectElements(block, selector) {
  if (!selector) return block.els.map((el, i) => ({ el, key: elementKey(block, el, i) }));
  let range = null;
  const br = selector.match(/\[(\d+)-(\d+)\]$/);
  if (br) {
    range = [Number(br[1]), Number(br[2])];
    selector = selector.slice(0, br.index);
  }
  const negate = selector.startsWith('!');
  const targets = new Set();
  for (const one of (negate ? selector.slice(1) : selector).split(',')) {
    const cut = one.indexOf(':');
    const name = cut === -1 ? one : one.slice(0, cut);
    const occ = cut === -1 ? 0 : Number(one.slice(cut + 1));
    let found = false;
    block.els.forEach((el, i) => {
      const seen = block.els.slice(0, i).filter((e) => e.name === el.name).length;
      if (el.name === name && seen === occ) {
        targets.add(i);
        found = true;
      }
    });
    if (!found) {
      throw new Error(
        'slide plan selector "#' + selector + '" matches no "' + name + '" occurrence ' + occ + ' in "' + block.id + '"; it has: ' +
          block.els.map((e) => e.name).join(', '),
      );
    }
  }
  const picked = block.els
    .map((el, i) => ({ el, key: elementKey(block, el, i) }))
    .filter((x, i) => (negate ? !targets.has(i) : targets.has(i)));

  if (range && !negate) {
    for (const p of picked) {
      if (p.el.name !== 'table') {
        throw new Error('a [a-b] row range only applies to a table, but "' + block.id + '#' + selector + '" is a ' + p.el.name);
      }
      const rows = p.el.rawRows;
      if (!rows) throw new Error('"' + block.id + '" has a table with no source rows');
      const body = rows.slice(1).slice(range[0] - 1, range[1]);
      if (!body.length) throw new Error('row range [' + range + '] is outside "' + block.id + '" (' + (rows.length - 1) + ' data rows)');
      p.el = { name: 'table', html: tableHtml([rows[0]].concat(body)) };
    }
  }
  return picked;
}

function sectionById(doc, id) {
  if (id === 'front') return doc.front;
  const hit = doc.sections.find((s) => s.id === id);
  if (!hit) throw new Error('slide plan references an unknown section: "' + id + '"');
  return hit;
}

// ---------------------------------------------------------------------------
// Slide assembly
// ---------------------------------------------------------------------------

function partKeyOf(sec) {
  if (!sec || !sec.part) return 'meta';
  const letter = /PART\s+([A-Z])/.exec(sec.part);
  return letter ? letter[1] : 'meta';
}

function partLabel(sec) {
  if (!sec || !sec.part) return 'INVENTRAK';
  return sec.part.replace(/^#\s*/, '').replace(/\s*\(.*\)\s*$/, '').toUpperCase();
}

/** Split "§7:Basis — unit normalisation#table:0" into its parts and resolve. */
function resolveRef(doc, ref) {
  const hash = ref.indexOf('#');
  const loc = hash === -1 ? ref : ref.slice(0, hash);
  const selector = hash === -1 ? '' : ref.slice(hash + 1);
  const colon = loc.indexOf(':');
  const secId = colon === -1 ? loc : loc.slice(0, colon);
  const blockRef = colon === -1 ? '@intro' : loc.slice(colon + 1);
  const sec = sectionById(doc, secId);
  const block = findBlock(sec, blockRef);
  return { block, chosen: selectElements(block, selector) };
}

function resolveSlide(doc, spec, tally) {
  const picked = [];
  const blockNos = [];
  for (const ref of spec.pick || []) {
    const { block, chosen } = resolveRef(doc, ref);
    if (!chosen.length) throw new Error('slide plan ref "' + ref + '" selected no elements');
    for (const c of chosen) tally.set(c.key, (tally.get(c.key) || 0) + 1);
    picked.push(...chosen);
    blockNos.push(block.no);
  }
  const sec = spec.sec ? sectionById(doc, spec.sec) : null;
  return { sec, picked, blockNos };
}

function assertFullCoverage(doc, tally) {
  const problems = [];
  const check = (sec) => {
    const blocks = (sec.intro ? [sec.intro] : []).concat(sec.blocks);
    for (const block of blocks) {
      block.els.forEach((el, i) => {
        const key = elementKey(block, el, i);
        if (HELD_BACK[key]) return;
        const n = tally.get(key) || 0;
        if (n === 0) problems.push('never shown:  ' + key + '   (' + block.id + ' L' + block.no + ')');
        else if (n > 1 && !ALLOW_REPEAT.has(key))
          problems.push('shown ' + n + 'x:    ' + key + '   (' + block.id + ' L' + block.no + ')');
      });
    }
  };
  check(doc.front);
  for (const s of doc.sections) check(s);
  if (problems.length) {
    throw new Error(
      'slide coverage is incomplete (' +
        problems.length +
        '):\n  ' +
        problems.join('\n  ') +
        '\n\n  Fix the PLAN in slides-render.js, or add the element to HELD_BACK with a reason.',
    );
  }
}

function assertEveryRowRehearsed(slides, doc) {
  const seen = new Map();
  for (const s of slides) {
    for (const n of s.rows || []) {
      if (seen.has(n)) {
        throw new Error(
          'rehearsal row ' + n + ' ("' + doc.rehearsalRows[n - 1].name + '") is carried by two slides: ' + seen.get(n) + ' and ' + s.title,
        );
      }
      seen.set(n, s.title);
    }
  }
  const missing = doc.rehearsalRows.filter((r) => !seen.has(r.n)).map((r) => r.n + ' ' + r.name);
  if (missing.length) {
    throw new Error('these rehearsal rows carry no speaker strip:\n  ' + missing.join('\n  '));
  }
  return seen;
}

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------

const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function slideHtml(s, index, total) {
  const cls = ['slide', 'k-' + s.color];
  if (s.kind === 'part') cls.push('is-part');
  if (s.kind === 'title' || s.kind === 'closing') cls.push('is-cover');
  if (s.hero) cls.push('is-hero');

  const parts = [];
  if (s.kicker) parts.push('<div class="kicker">' + esc(s.kicker) + '</div>');
  parts.push('<h2 class="slide-title">' + (s.titleHtml || esc(s.title)) + '</h2>');
  if (s.subtitle) parts.push('<p class="subtitle">' + inline(s.subtitle) + '</p>');

  if (s.kind === 'part') {
    parts.push('<ol class="part-list">' + s.contents.map((c) => '<li>' + esc(c) + '</li>').join('') + '</ol>');
  } else if (s.body) {
    parts.push('<div class="body' + (s.twoCol ? ' two-col' : '') + '">' + s.body + '</div>');
  }

  const chrome = [
    '<div class="chrome">',
    '<span class="where">' + (s.rows.map((n) => s.rowMeta[n].where).filter(Boolean).map((w) => inline(w)).join(' &nbsp;·&nbsp; ') || '') + '</span>',
    '<span class="spacer"></span>',
    '<span class="src">' + (s.srcLines ? 'ALGORITHMS.md&nbsp;L' + s.srcLines : '') + '</span>',
    '<span class="num">' + index + ' / ' + total + '</span>',
    '</div>',
  ].join('');

  const say = s.rows.length
    ? '<div class="say"><span class="say-label">SAY</span><div class="say-body">' +
      s.rows.map((n) => '<p>' + inline(s.rowMeta[n].say) + '</p>').join('') +
      '</div></div>'
    : '';

  return (
    '<section class="' + cls.join(' ') + '" id="s' + index + '" data-i="' + index + '" data-nav="' + esc(s.navTitle) + '" data-part="' + s.color + '" aria-label="Slide ' + index + ' of ' + total + '">' +
    chrome +
    '<div class="stage"><div class="stage-inner">' +
    parts.join('') +
    '</div></div>' +
    say +
    '</section>'
  );
}

function buildDeck(doc, md) {
  const tally = new Map();
  const slides = [];

  PLAN.forEach((spec, i) => {
    const { sec, picked, blockNos } = resolveSlide(doc, spec, tally);
    const kind = spec.kind || 'content';
    const rows = spec.say || [];
    const rowMeta = Object.fromEntries(rows.map((n) => [n, doc.rehearsalRows[n - 1]]));

    let contents = [];
    if (kind === 'part') {
      if (sec.id === 'verify') {
        contents = ['npm run verify  —  the claim-to-suite table', 'reproducing the dataset figures byte-identically'];
      } else {
        contents = doc.sections.filter((s) => s.part === sec.part && s.key).map((s) => s.key + '   ' + s.title);
      }
    }

    const title =
      spec.title ||
      (kind === 'title'
        ? doc.title.replace(/^ALGORITHMS\.md\s*—\s*/, '')
        : kind === 'part'
          ? partLabel(sec)
          : sec.title);

    const kicker =
      spec.kicker ||
      (kind === 'title'
        ? 'INVENTRAK · CAPSTONE DEFENCE'
        : kind === 'closing'
          ? 'INVENTRAK'
          : kind === 'part'
            ? ''
            : partLabel(sec) + (rows.length ? '   ·   REHEARSAL ' + rows.join(' & ') + ' OF ' + doc.rehearsalRows.length : ''));

    slides.push({
      n: i + 1,
      kind,
      color: partKeyOf(sec || {}),
      kicker,
      title,
      navTitle: title,
      subtitle: spec.subtitle || '',
      body: picked.map((p) => p.el.html).join(''),
      hero: !!spec.hero,
      rows,
      rowMeta,
      contents,
      srcLines: blockNos.length ? blockNos[0] + (blockNos.length > 1 ? '–' + blockNos[blockNos.length - 1] : '') : '',
    });
  });

  assertFullCoverage(doc, tally);
  assertEveryRowRehearsed(slides, doc);

  doc.deck = { slides, covered: tally.size };

  const total = slides.length;
  const hash = crypto.createHash('sha256').update(md).digest('hex').slice(0, 12);

  const html = [
    '<!DOCTYPE html>',
    '<html lang="en" data-part="meta">',
    '<head>',
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    '<meta name="generator" content="backend/scripts/build-slides.js from ALGORITHMS.md" />',
    '<meta name="description" content="INVENTRAK capstone defence deck, generated from ALGORITHMS.md" />',
    '<title>INVENTRAK — Algorithms, defended without the code</title>',
    '<style>',
    CSS,
    '</style>',
    '</head>',
    '<body>',
    '<div class="progress"><i></i></div>',
    '<div class="deck" id="deck">',
    slides.map((s) => slideHtml(s, s.n, total)).join('\n'),
    '</div>',
    '<nav class="pager" aria-hidden="true"><button data-go="prev" title="Previous (Left arrow)">&#8249;</button><button data-go="next" title="Next (Right arrow)">&#8250;</button></nav>',
    '<aside class="sheet" id="sheet" hidden>',
    '<div class="sheet-in"><h3>Contents</h3><ol class="toc">' +
      slides.map((s, i) => '<li><button data-go="' + (i + 1) + '">' + (i + 1) + '</button><span>' + esc(s.navTitle) + '</span></li>').join('') +
      '</ol>',
    '<p class="keys">' +
      '<b>→</b>/<b>Space</b> next · <b>←</b> back · <b>Home</b>/<b>End</b> · <b>C</b> contents · <b>N</b> speaker notes · <b>F</b> fullscreen · <b>P</b> print to PDF' +
      '</p></div>',
    '</aside>',
    '<footer class="build">Generated from <b>ALGORITHMS.md</b> · ' + doc.lineCount + ' lines · sha256:' + hash + ' · rebuild with <code>npm run slides</code></footer>',
    '<script>',
    CLIENT_JS,
    '</' + 'script>',
    '</body>',
    '</html>',
    '',
  ].join('\n');

  return html;}

module.exports = { buildDeck, PLAN };

// ---------------------------------------------------------------------------
// Styles + client script. Inline, no CDN, no network: the file opens from disk
// on a machine that has never seen this repository.
// ---------------------------------------------------------------------------

const CSS = [
  ':root{--bg:#0a0e18;--panel:#111a2e;--ink:#e9edf7;--muted:#94a3c4;--line:#243049;--acc:#a78bfa;}',
  '*{box-sizing:border-box}',
  'html,body{height:100%}',
  'body{margin:0;background:radial-gradient(1200px 800px at 78% -8%,#1a2140 0%,#0a0e18 62%);color:var(--ink);',
  '  font:16px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;',
  '  -webkit-font-smoothing:antialiased;overflow:hidden}',
  '.progress{position:fixed;top:0;left:0;right:0;height:3px;background:#1a2340;z-index:40}',
  '.progress i{display:block;height:100%;width:0;background:var(--acc);transition:width .18s ease}',
  '.deck{position:absolute;inset:3px 0 0}',
  '.slide{position:absolute;inset:0;display:none;flex-direction:column;padding:22px clamp(22px,4.4vw,72px) 14px;overflow:auto}',
  '.slide.active{display:flex}',
  '.slide.k-A{--acc:#4f8cff}.slide.k-B{--acc:#22c58b}.slide.k-C{--acc:#f5a524}.slide.k-D{--acc:#ff5d73}.slide.k-meta{--acc:#a78bfa}',
  '.chrome{display:flex;align-items:center;gap:14px;font-size:12.5px;color:var(--muted);letter-spacing:.06em;',
  '  text-transform:uppercase;border-bottom:1px solid var(--line);padding-bottom:9px;flex:0 0 auto}',
  '.chrome .spacer{flex:1}',
  '.chrome .where{color:var(--acc);font-weight:600}',
  '.chrome .src{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;opacity:.65;text-transform:none;letter-spacing:0}',
  '.chrome .num{font-variant-numeric:tabular-nums}',
  '.stage{flex:1 1 auto;display:flex;align-items:center;min-height:0}',
  '.stage-inner{width:100%;max-width:1200px;margin:0 auto;padding:clamp(10px,2.2vh,30px) 0}',
  '.kicker{font-size:13px;letter-spacing:.18em;text-transform:uppercase;color:var(--acc);font-weight:700;margin:0 0 12px}',
  '.slide-title{margin:0 0 9px;font-size:clamp(23px,3.05vw,44px);line-height:1.08;letter-spacing:-.02em;font-weight:700}',
  '.is-cover .slide-title{font-size:clamp(30px,4.6vw,66px)}',
  '.is-part .slide-title{font-size:clamp(27px,4.2vw,56px)}',
  '.subtitle{margin:0 0 14px;font-size:clamp(14.5px,1.32vw,19px);color:#c3cde4;max-width:76ch}',
  '.body{max-width:1200px}',
  '.body>*:first-child{margin-top:0}',
  '.body p{margin:0 0 11px;font-size:clamp(13.5px,1.16vw,17px);color:#dbe3f5}',
  '.body ul,.body ol{margin:0 0 11px;padding-left:1.15em}',
  '.body li{margin:0 0 6px;font-size:clamp(13.5px,1.16vw,17px);color:#dbe3f5}',
  '.body li::marker{color:var(--acc);font-weight:700}',
  'code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.9em;background:#182238;',
  '  border:1px solid #26324f;border-radius:5px;padding:.05em .34em;color:#bcd0ff;white-space:nowrap}',
  '.ref{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.9em;background:#182238;',
  '  border:1px solid #26324f;border-radius:5px;padding:.05em .34em;color:#bcd0ff;white-space:nowrap;',
  '  cursor:default;text-decoration:none}',
  'pre.code{background:#0c1220;border:1px solid #26324f;border-left:3px solid var(--acc);',
  '  border-radius:10px;padding:11px 14px;overflow:auto;margin:0 0 11px;max-height:min(38vh,300px)}',
  'pre.code code{background:none;border:0;padding:0;white-space:pre;color:#d8e2f7;font-size:clamp(11px,0.94vw,13.5px);line-height:1.48}',
  'blockquote.callout{margin:0 0 11px;padding:9px 13px;background:rgba(255,255,255,.045);',
  '  border:1px solid var(--line);border-left:3px solid var(--acc);border-radius:9px}',
  'blockquote.callout p{margin:0 0 8px;color:#e6ecfb;font-size:clamp(13.5px,1.16vw,17px)}',
  'blockquote.callout p:last-child{margin-bottom:0}',
  'blockquote.callout pre.code{margin-bottom:0}',
  'table.tbl{border-collapse:collapse;width:100%;margin:0 0 11px;font-size:clamp(11.8px,0.98vw,14.6px)}',
  'table.tbl th,table.tbl td{border:1px solid var(--line);padding:5px 9px;text-align:left;vertical-align:top;color:#dbe3f5}',
  'table.tbl th{background:#162038;color:#eaf0ff;font-weight:600;text-transform:none;letter-spacing:.01em}',
  'table.tbl tr:nth-child(even) td{background:rgba(255,255,255,.022)}',
  'table.tbl strong{color:#fff}',
  'a{color:var(--acc)}',
  '.is-hero .stage-inner{max-width:none}',
  '.is-hero pre.code{max-height:none;font-size:clamp(13px,1.35vw,21px);line-height:1.42}',
  '.is-hero .stage{align-items:stretch}',
  '.is-hero .stage-inner{display:flex;flex-direction:column;justify-content:center}',
  '.part-list{list-style:none;counter-reset:alg;margin:6px 0 0;padding:0;display:grid;gap:7px;',
  '  grid-template-columns:repeat(auto-fill,minmax(310px,1fr));max-width:1080px}',
  '.part-list li{counter-increment:alg;font-size:clamp(14px,1.3vw,19px);color:#dbe3f5;margin:0;',
  '  border:1px solid var(--line);border-radius:9px;padding:7px 12px;background:rgba(255,255,255,.03)}',
  '.part-list li::before{content:counter(alg);display:inline-block;min-width:1.9em;color:var(--acc);font-weight:700}',
  '.say{flex:0 0 auto;margin:6px auto 0;width:100%;max-width:1180px;display:flex;gap:13px;align-items:flex-start;',
  '  background:linear-gradient(90deg,rgba(255,255,255,.06),rgba(255,255,255,.015));',
  '  border:1px solid var(--line);border-left:3px solid var(--acc);border-radius:10px;padding:10px 14px}',
  '.say-label{font-size:11px;letter-spacing:.16em;font-weight:800;color:var(--acc);padding-top:4px;flex:0 0 auto}',
  '.say-body p{margin:0;font-size:clamp(14px,1.3vw,18.5px);color:#eef2fc;font-style:italic}',
  '.say-body p+p{margin-top:5px}',
  'body.no-notes .say{display:none}',
  '.build{position:fixed;left:0;right:0;bottom:0;padding:5px 16px;font-size:11px;color:#5f6d8c;',
  '  background:linear-gradient(0deg,#0a0e18 60%,rgba(10,14,24,0));text-align:center;z-index:30}',
  '.build code{background:none;border:0;color:#8091b5;padding:0}',
  '.pager{position:fixed;right:16px;bottom:16px;display:flex;gap:7px;z-index:35}',
  '.pager button{width:38px;height:38px;border-radius:9px;border:1px solid var(--line);background:#141d33;color:#c8d3ec;',
  '  font-size:19px;cursor:pointer;line-height:1}',
  '.pager button:hover{border-color:var(--acc);color:#fff}',
  '.sheet{position:fixed;inset:0;background:rgba(6,9,18,.94);z-index:50;overflow:auto;padding:34px clamp(18px,5vw,70px)}',
  '.sheet[hidden]{display:none}',
  '.sheet-in{max-width:1000px;margin:0 auto}',
  '.sheet h3{margin:0 0 16px;font-size:20px;letter-spacing:.1em;text-transform:uppercase;color:var(--acc)}',
  '.toc{list-style:none;margin:0 0 20px;padding:0;display:grid;gap:5px;grid-template-columns:repeat(auto-fill,minmax(280px,1fr))}',
  '.toc button{display:inline-block;min-width:2.3em;margin-right:9px;padding:1px 6px;border-radius:6px;border:1px solid var(--line);',
  '  background:#141d33;color:var(--acc);font-size:12.5px;font-weight:700;cursor:pointer}',
  '.toc li{display:flex;align-items:baseline;color:#cdd7ee;font-size:14.5px}',
  '.toc button:hover{border-color:var(--acc)}',
  '.keys{color:var(--muted);font-size:13.5px;border-top:1px solid var(--line);padding-top:14px}',
  '.keys b{color:#dbe6ff}',
  '@media print{',
  '  @page{size:A4 landscape;margin:9mm}',
  '  body{overflow:visible;background:#fff;color:#111}',
  '  .progress,.pager,.build,.sheet{display:none!important}',
  '  .deck{position:static;inset:auto}',
  '  .slide{display:flex!important;position:relative;inset:auto;break-after:page;page-break-after:always;min-height:178mm;',
  '    background:#fff;color:#111;padding:6mm 4mm}',
  '  .slide:last-child{break-after:auto;page-break-after:auto}',
  '  .chrome{color:#555;border-bottom-color:#ddd}.chrome .where{color:#0a4}.chrome .src{opacity:.7}',
  '  .slide-title{color:#0b1020}.subtitle,.body p,.body li,table.tbl th,table.tbl td{color:#1d2330}',
  '  .body li::marker{color:#0a4}.say{background:#f5f6fa;border-color:#d6dae6;border-left-color:#0a4}',
  '  .say-body p{color:#111}.say-label{color:#0a4}',
  '  pre.code{background:#f6f7fb;border-color:#d6dae6;border-left-color:#0a4}',
  '  pre.code code{color:#16203a}code{background:#eef1f7;border-color:#d6dae6;color:#16203a}',
  '  .ref{background:#eef1f7;border-color:#d6dae6;color:#16203a}',
  '  blockquote.callout{background:#f5f6fa;border-color:#d6dae6;border-left-color:#0a4}',
  '  blockquote.callout p{color:#111}table.tbl th{background:#eef1f7;color:#0b1020}',
  '  table.tbl tr:nth-child(even) td{background:#fafbfd}',
  '}',
].join('\n');

const CLIENT_JS = [
  '(function(){',
  '  var slides=[].slice.call(document.querySelectorAll(".slide"));',
  '  var bar=document.querySelector(".progress i");',
  '  var sheet=document.getElementById("sheet");',
  '  var i=0;',
  '  function fit(slide){',
  '    var inner=slide.querySelector(".stage-inner"),stage=slide.querySelector(".stage");',
  '    if(!inner||!stage)return;',
  '    inner.style.zoom="";',
  '    var avail=stage.clientHeight-6,h=inner.offsetHeight;',
  '    if(avail>40&&h>avail){var k=avail/h;inner.style.zoom=(k<0.62?0.62:Math.floor(k*1000)/1000);}',
  '  }',
  '  function show(n,viaHash){',
  '    i=Math.max(0,Math.min(slides.length-1,n));',
  '    slides.forEach(function(s,k){s.classList.toggle("active",k===i);});',
  '    document.documentElement.setAttribute("data-part",slides[i].getAttribute("data-part"));',
  '    bar.style.width=((i+1)/slides.length*100)+"%";',
  '    var h="#s"+(i+1);',
  '    if(!viaHash&&location.hash!==h){history.replaceState(null,"",h);}',
  '    slides[i].scrollTop=0;',
  '    fit(slides[i]);',
  '  }',
  '  function fromHash(){var m=/^#s(\\d+)$/.exec(location.hash);return m?Number(m[1])-1:0;}',
  '  document.addEventListener("keydown",function(e){',
  '    if(e.metaKey||e.ctrlKey||e.altKey)return;',
  '    var k=e.key;',
  '    if(k==="ArrowRight"||k==="ArrowDown"||k===" "||k==="PageDown"||k==="Enter"){e.preventDefault();show(i+1);}',
  '    else if(k==="ArrowLeft"||k==="ArrowUp"||k==="PageUp"||k==="Backspace"){e.preventDefault();show(i-1);}',
  '    else if(k==="Home"){e.preventDefault();show(0);}',
  '    else if(k==="End"){e.preventDefault();show(slides.length-1);}',
  '    else if(k==="c"||k==="C"||k==="o"){sheet.hidden=!sheet.hidden;}',
  '    else if(k==="n"||k==="N"){document.body.classList.toggle("no-notes");}',
  '    else if(k==="p"||k==="P"){window.print();}',
  '    else if(k==="f"||k==="F"){',
  '      if(document.fullscreenElement){document.exitFullscreen();}',
  '      else if(document.documentElement.requestFullscreen){document.documentElement.requestFullscreen();}',
  '    }',
  '    else if(k==="Escape"){sheet.hidden=true;}',
  '    else if(/^[0-9]$/.test(k)){buffer+=k;clearTimeout(timer);timer=setTimeout(function(){',
  '      var n=parseInt(buffer,10);buffer="";if(n>=1&&n<=slides.length)show(n-1);},420);}',
  '  });',
  '  var buffer="",timer=null;',
  '  document.addEventListener("click",function(e){',
  '    var b=e.target.closest("[data-go]");if(!b)return;',
  '    var g=b.getAttribute("data-go");',
  '    if(g==="next")show(i+1);else if(g==="prev")show(i-1);else show(Number(g)-1);',
  '    sheet.hidden=true;',
  '  });',
  '  window.addEventListener("hashchange",function(){show(fromHash(),true);});',
  '  window.addEventListener("resize",function(){fit(slides[i]);});',
  '  show(fromHash());',
  '})();',
].join('\n');
