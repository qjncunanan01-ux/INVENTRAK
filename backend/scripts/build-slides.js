#!/usr/bin/env node
// Reads ALGORITHMS.md and hands the model to slides-render.js, which turns it
// into the defense slide deck (docs/algorithms-deck.html).
//
// The deck is GENERATED, never hand-written, so it cannot drift from the
// document and cannot invent a number. Everything an audience reads on a slide
// is lifted verbatim out of ALGORITHMS.md:
//
//   - the "How to show this without showing the code" rehearsal table becomes
//     the contents slide AND the per-slide speaker strip ("SAY ...")
//   - each "## N. Title" section becomes one or more slides, sourced from its
//     own "### ..." subsections
//   - the ASCII algorithm map and the verification tables are rendered as-is
//
// Document model
//   section  — one "## ..." heading. Sections carry an `id`:
//                "§7"               a numbered algorithm
//                "rehearsal"        how to show this without showing the code
//                "map"              the ASCII algorithm map
//                "verify"           Verification — reproduce every number ...
//   block    — one "### ..." subsection, or "@intro" for the text between the
//              "## ..." heading and the first "### ..." of that section
//   element  — a paragraph / table / fenced block / quote / list inside a block
//
// The slide plan addresses elements by name ("#table:0", "#!para:0"), and the
// renderer asserts that EVERY element lands on exactly one slide. Content
// therefore cannot silently fall off the deck, and cannot appear twice by
// accident.
//
// Output is byte-deterministic: no timestamps, no randomness, no locale, so
// `--check` can diff a rebuild against the committed file. That is the "the
// deck is still in sync with the document" guard wired into `verify`.
//
// Usage:
//   node scripts/build-slides.js           # write docs/algorithms-deck.html
//   node scripts/build-slides.js --check   # fail if the committed deck is stale
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..', '..');
const sourceFile = path.join(repoRoot, 'ALGORITHMS.md');
const outFile = path.join(repoRoot, 'docs', 'algorithms-deck.html');

// Level-2 headings that are not numbered algorithms get a stable id so the
// slide plan can address them by name instead of by position.
const LEVEL2_IDS = [
  ['how-to-show-this-without-showing-the-code', 'rehearsal'],
  ['algorithm-map', 'map'],
  ['verification', 'verify'],
];

function level2Id(text) {
  const s = slug(text);
  for (const [prefix, id] of LEVEL2_IDS) if (s === prefix || s.startsWith(prefix)) return id;
  return s;
}

// ---------------------------------------------------------------------------
// Inline + block markdown -> HTML
// ---------------------------------------------------------------------------

/** Escape, then wrap code spans / links / strong / em. Code spans are lifted
 *  out into placeholders first so `**` inside them is never emphasised. */
const PH_OPEN = '\u0000';
const PH_CLOSE = '\u0001';

function inline(text) {
  const codes = [];
  let s = String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  s = s.replace(/`([^`]+)`/g, (_, c) => {
    codes.push(c);
    return PH_OPEN + (codes.length - 1) + PH_CLOSE;
  });
  // Links inside slide bodies are shown, not followed. A slide deck opened from
  // disk must not send a presenter off to a URL that may not resolve: the
  // doc's own `[docs/algorithms-deck.html](docs/algorithms-deck.html)` is
  // correct on GitHub, where it resolves from the repo root, but inside the
  // generated deck it would resolve against docs/ and 404. So every link in a
  // slide body becomes an inert reference chip — the words still read, the
  // deck still depends on nothing but itself (asserted by slides.test.js:
  // no external URLs, no network).
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t) => `<span class="ref">${t}</span>`);
  s = s.replace(/\*\*([\s\S]+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[\s([])\*([^*\s][^*]*?)\*(?=$|[\s.,;:!?)"'}])/g, '$1<em>$2</em>');
  // NOTE: '\\d' must be written with TWO backslashes. In a JS string literal
  // '\d' is not a recognised escape, so the backslash is silently dropped and
  // the regex becomes /d+/ — which matches nothing, leaks the placeholder bytes
  // into the HTML, and renders every code span as unstyled text. Asserted by
  // src/test/slides.test.js ("no control bytes leak into the deck").
  s = s.replace(new RegExp(PH_OPEN + '(\\d+)' + PH_CLOSE, 'g'), (_, i) => '<code>' + codes[Number(i)] + '</code>');
  return s;
}

function splitTableRow(line) {
  const cells = [];
  let cur = '';
  let escaped = false;
  const body = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  for (const ch of body) {
    if (escaped) {
      cur += ch;
      escaped = false;
    } else if (ch === '\\') {
      escaped = true;
      cur += ch;
    } else if (ch === '|') {
      cells.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  cells.push(cur.trim());
  return cells;
}

const isTableSep = (line) => line.includes('-') && /^\s*\|?[\s:|-]+$/.test(line);

function tableHtml(rows) {
  let html = '<table class="tbl"><thead><tr>';
  for (const c of rows[0]) html += `<th>${inline(c) || '&nbsp;'}</th>`;
  html += '</tr></thead><tbody>';
  for (const r of rows.slice(1)) {
    html += '<tr>';
    for (const c of r) html += `<td>${inline(c)}</td>`;
    html += '</tr>';
  }
  return html + '</tbody></table>';
}

const isRule = (line) => /^\s*(?:---+|\*\*\*+)\s*$/.test(line);
const isBullet = (line) => /^\s*[-*]\s+/.test(line);
const isNumbered = (line) => /^\s*\d+[.)]\s+/.test(line);
const isQuote = (line) => /^\s*>/.test(line);

/** markdown chunk -> [{ name, html }]. `name` is how a slide selects a piece. */
function renderElements(chunk) {
  const lines = String(chunk).split('\n');
  const els = [];
  let para = [];
  let i = 0;

  const flushPara = () => {
    if (!para.length) return;
    const html = `<p>${inline(para.join(' ').trim())}</p>`;
    els.push({ name: 'para', html });
    para = [];
  };

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      flushPara();
      i++;
      continue;
    }

    // fenced code (also matches an *opening* fence; run-of-fences is handled by
    // the caller stripping the fences before it gets here)
    const fence = /^```(\S*)\s*$/.exec(line);
    if (fence) {
      flushPara();
      const body = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) body.push(lines[i++]);
      i++; // closing fence
      const text = body.join('\n');
      els.push({
        name: 'code',
        html:
          '<pre class="code' +
          (fence[1] ? ' lang-' + fence[1] : '') +
          '"><code>' +
          text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') +
          '</code></pre>',
      });
      continue;
    }

    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      flushPara();
      const lvl = Math.min(6, h[1].length + 2);
      els.push({ name: 'h', html: `<h${lvl}>${inline(h[2])}</h${lvl}>` });
      i++;
      continue;
    }

    if (isRule(line)) {
      flushPara();
      els.push({ name: 'hr', html: '<hr class="rule" />' });
      i++;
      continue;
    }

    if (/^\s*\|/.test(line) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      flushPara();
      const rows = [splitTableRow(line)];
      i += 2;
      while (i < lines.length && /^\s*\|/.test(lines[i]) && lines[i].trim()) {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      els.push({ name: 'table', html: tableHtml(rows), rawRows: rows });
      continue;
    }

    if (isQuote(line)) {
      flushPara();
      const body = [];
      while (i < lines.length && isQuote(lines[i])) {
        body.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      els.push({
        name: 'quote',
        html: '<blockquote class="callout">' + renderElements(body.join('\n')).map((e) => e.html).join('') + '</blockquote>',
      });
      continue;
    }

    if (isBullet(line) || isNumbered(line)) {
      flushPara();
      const ordered = isNumbered(line);
      const re = ordered ? /^\s*\d+[.)]\s+(.*)$/ : /^\s*[-*]\s+(.*)$/;
      const items = [];
      while (
        i < lines.length &&
        (re.test(lines[i]) || (items.length && /^\s{2,}\S/.test(lines[i]) && !isRule(lines[i])))
      ) {
        const m = re.exec(lines[i]);
        if (m) items.push(m[1].trim());
        else items[items.length - 1] += ' ' + lines[i].trim();
        i++;
      }
      els.push({
        name: ordered ? 'ol' : 'ul',
        html: `<${ordered ? 'ol' : 'ul'} class="bul">` + items.map((t) => `<li>${inline(t)}</li>`).join('') + `</${ordered ? 'ol' : 'ul'}>`,
      });
      continue;
    }

    para.push(line.trim());
    i++;
  }
  flushPara();
  return els;
}

// ---------------------------------------------------------------------------
// ALGORITHMS.md -> document model
// ---------------------------------------------------------------------------

const slug = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/**
 * Walk the file once, tracking fenced-code state so a `#` inside a code block
 * is never read as a heading, and grouping everything under the current
 * level-2 heading.
 */
function parseDoc(md) {
  const rawLines = md.split('\n');
  const doc = { rawLines, lineCount: rawLines.length, sections: [], parts: [] };
  doc.title = (rawLines[0] || '').replace(/^#\s+/, '');

  let part = null;
  let cur = null; // the section being filled
  let buf = [];
  let bufNo = 0;
  let pendingName = null;
  let fence = null;
  let front = null;

  // Trailing `---` between sections is a document divider, not content, and a
  // buffer holding nothing else must not become a block.
  const trimTail = (lines) => {
    let end = lines.length;
    while (end > 0 && (!lines[end - 1].trim() || isRule(lines[end - 1]))) end--;
    return lines.slice(0, end);
  };

  const flush = () => {
    const body = trimTail(buf);
    buf = [];
    if (!body.some((l) => l.trim())) return;
    const els = renderElements(body.join('\n'));
    if (!cur) {
      if (!front) front = { no: bufNo, els };
      return;
    }
    const block = { id: `${cur.id}:${pendingName}`, name: pendingName, no: bufNo, els };
    if (pendingName === '@intro') cur.intro = block;
    else cur.blocks.push(block);
  };

  const seal = () => {
    flush();
    if (!cur) return;
    cur.els = (cur.intro ? cur.intro.els : []).concat(...cur.blocks.map((b) => b.els));
    cur.endNo = bufNo;
    const first = (cur.intro && cur.intro.els[0]) || null;
    cur.question = first ? first.html.replace(/^<p>|<\/p>$/g, '') : '';
    doc.sections.push(cur);
    cur = null;
    pendingName = null;
  };

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    const no = i + 1;

    const f = /^```(\S*)\s*$/.exec(line);
    if (f) {
      if (fence === null) {
        fence = f[1] || '';
        buf.push(line);
        if (!bufNo) bufNo = no;
      } else {
        buf.push(line);
        fence = null;
      }
      continue;
    }
    if (fence !== null) {
      buf.push(line);
      continue;
    }

    const h = /^(#{1,2})\s+(.*)$/.exec(line);
    if (h) {
      seal();
      if (h[1] === '#') {
        if (/^PART\b/.test(h[2])) {
          part = { title: h[2], no, sections: [] };
          doc.parts.push(part);
        }
      } else {
        const m = /^(\d+)\.\s+(.*)$/.exec(h[2]);
        const key = m ? '§' + m[1] : null;
        const id = key || level2Id(h[2]);
        cur = {
          id,
          key,
          heading: h[2],
          title: m ? m[2] : h[2],
          part: part ? part.title : '',
          partNo: no,
          no,
          blocks: [],
          intro: null,
        };
        pendingName = '@intro';
      }
      bufNo = no + 1;
      continue;
    }

    const lvl3 = /^#{3,}\s+(.*)$/.exec(line);
    if (lvl3 && cur) {
      flush();
      pendingName = lvl3[1];
      bufNo = no + 1;
      continue;
    }
    if (lvl3) {
      // a level-3 heading before any level-2: part of the front matter
      buf.push(line);
      continue;
    }

    if (!buf.some((l) => l.trim()) && line.trim()) bufNo = no;
    buf.push(line);
  }
  seal();

  doc.front = front || { no: 1, els: [] };
  doc.front.id = 'front';
  doc.front.blocks = doc.front.els.map((e, i) => ({ id: 'front:@intro', name: '@intro', no: doc.front.no, els: doc.front.els, _flat: i }));
  doc.rehearsal = doc.sections.find((s) => s.id === 'rehearsal') || null;
  doc.map = doc.sections.find((s) => s.id === 'map') || null;
  doc.verify = doc.sections.find((s) => s.id === 'verify') || null;
  doc.algos = doc.sections.filter((s) => s.key);
  doc.rehearsalRows = parseRehearsalRows(doc.rehearsal);
  return doc;
}

/** | # | Algorithm | Show it here | What to say | -> [{ n, name, where, say }] */
function parseRehearsalRows(section) {
  if (!section) throw new Error('ALGORITHMS.md: no "How to show this without showing the code" section');
  const table = section.els.find((e) => e.name === 'table');
  if (!table) throw new Error('ALGORITHMS.md: the rehearsal section contains no table');
  const lines = table.rawRows;
  if (!lines || lines.length < 2) throw new Error('ALGORITHMS.md: the rehearsal table has no data rows');
  const header = lines[0].map((h) => h.toLowerCase());
  for (const need of ['#', 'algorithm', 'show it here', 'what to say']) {
    if (!header.includes(need)) {
      throw new Error(`ALGORITHMS.md: the rehearsal table is missing its "${need}" column (found: ${header.join(' | ')})`);
    }
  }
  const rows = lines.slice(1).map((r, idx) => ({
    n: Number(r[0]),
    name: r[1],
    where: r[2],
    say: stripQuotes(r[3]),
    at: idx,
  }));
  rows.forEach((r, idx) => {
    if (r.n !== idx + 1) {
      throw new Error(`ALGORITHMS.md: rehearsal table row ${idx + 1} is numbered ${r.n}; the "#" column must count 1..n`);
    }
  });
  return rows;
}

function stripQuotes(s) {
  const t = String(s).trim();
  if (t.length > 1 && t[0] === '"' && t[t.length - 1] === '"') return t.slice(1, -1).trim();
  if (t.length > 1 && t[0] === '\u201c' && t[t.length - 1] === '\u201d') return t.slice(1, -1).trim();
  return t;
}

module.exports = {
  repoRoot,
  sourceFile,
  outFile,
  parseDoc,
  parseRehearsalRows,
  renderElements,
  inline,
  tableHtml,
  splitTableRow,
  stripQuotes,
};

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main(argv) {
  const check = argv.includes('--check');
  const { buildDeck } = require('./slides-render.js');
  const md = fs.readFileSync(sourceFile, 'utf8');
  const doc = parseDoc(md);
  const html = buildDeck(doc, md);

  if (check) {
    if (!fs.existsSync(outFile)) {
      console.error('✗ slides:check FAILED — docs/algorithms-deck.html does not exist.');
      console.error('  Run `npm run slides` to generate it.');
      process.exit(1);
    }
    const existing = fs.readFileSync(outFile, 'utf8');
    if (existing !== html) {
      const a = existing.split('\n');
      const b = html.split('\n');
      let i = 0;
      while (i < a.length && i < b.length && a[i] === b[i]) i++;
      console.error('✗ slides:check FAILED — docs/algorithms-deck.html is stale.');
      console.error(`  ALGORITHMS.md changed; the deck differs from line ${i + 1} of the rebuild.`);
      if (a[i] !== undefined) console.error(`  committed: ${a[i].slice(0, 110)}`);
      if (b[i] !== undefined) console.error(`  rebuilt:   ${b[i].slice(0, 110)}`);
      console.error('  Run `npm run slides` and commit the result.');
      process.exit(1);
    }
    console.log('✓ slides:check: the committed deck is a byte-identical rebuild from ALGORITHMS.md');
    return;
  }

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, html);
  console.log('✓ Built the defense deck from ALGORITHMS.md');
  console.log(`  ${path.relative(process.cwd(), outFile)}`);
  console.log(
    `  ${doc.deck.slides.length} slides · ${doc.rehearsalRows.length} rehearsed algorithms · all ${doc.deck.covered} source elements placed`,
  );
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    console.error('✗ build-slides FAILED: ' + err.message);
    if (process.env.SLIDES_DEBUG) console.error(err.stack);
    process.exit(1);
  }
}
