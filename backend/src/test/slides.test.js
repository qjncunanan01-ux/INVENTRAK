// WHY THIS SUITE EXISTS
// docs/algorithms-deck.html is the panel-defence deck, and it is GENERATED from
// ALGORITHMS.md. That makes it the one artifact in the repo that can silently
// rot in a way nothing else would notice: edit the document during rehearsal
// prep, and the deck keeps showing last week's numbers unless something forces
// them back together.
//
// So this suite does not test the slide *styling* — it tests the three promises
// the deck makes out loud, because those are the promises a panel will check:
//
//   1. PARITY        — the committed HTML is a byte-identical rebuild of the doc
//                      (`npm run slides:check`, also asserted here so a bare
//                      `npm test` fails on drift too).
//   2. SELF-CONTAINED — the deck is opened from a USB stick on a laptop with no
//                      wifi. Any external URL is a slide that renders as an
//                      empty box in the one room where it actually matters.
//   3. NOTHING DROPPED — every element of ALGORITHMS.md is either on a slide or
//                      explicitly held back with a reason, and every rehearsal
//                      row carries a spoken "what to say" line, because that
//                      table IS the presentation plan.
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { parseDoc, parseRehearsalRows, sourceFile, outFile, repoRoot } = require('../../scripts/build-slides');
const { buildDeck, PLAN } = require('../../scripts/slides-render');

const md = fs.readFileSync(sourceFile, 'utf8');
const doc = parseDoc(md);
const html = buildDeck(doc, md);
const slides = doc.deck.slides;
const mdLines = md.split('\n').length;

// --- text views of the generated deck --------------------------------------

// Everything as a human reads it: tags gone, entities decoded, markdown noise
// gone, case folded. Assertions then ask "does the panel SEE this?" rather than
// "does the renderer emit this exact tag soup?".
//
// The fiddly parts, all learned the hard way:
//   · a tag becomes a SPACE, so `<strong>X</strong>, Y` reads "x , y" here but
//     "x, y" in the document — the punctuation-spacing rule reconciles them.
//   · entities must be decoded, not blanked, or a doc "A & B" never matches an
//     HTML "A &amp; B".
//   · § is decoration: the doc says "§4", the slide title says "ROP + Safety".
function plain(s) {
  return String(s)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/[`*_]/g, '')
    .replace(/§/g, '')
    .replace(/["“”]/g, '')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const deckText = plain(html);

// The deck's own sections, in order, so a claim can be checked against the one
// slide that is supposed to carry it.
const slideChunks = html.split('<section class="').slice(1);
const chunkText = slideChunks.map(plain);
const chunkFor = (pred) => chunkText.find((t, i) => pred(slides[i], t));

describe('the deck is a faithful rebuild of ALGORITHMS.md', () => {
  test('the committed deck is byte-identical to a fresh rebuild', () => {
    assert.ok(fs.existsSync(outFile), 'docs/algorithms-deck.html must exist — run `npm run slides`');
    assert.strictEqual(
      fs.readFileSync(outFile, 'utf8'),
      html,
      'the committed deck is stale; run `npm run slides` and commit the result',
    );
  });

  test('rebuilding twice produces identical bytes (no clock, no randomness)', () => {
    assert.strictEqual(buildDeck(parseDoc(md), md), html);
  });

  test('the deck names the document it was built from, and carries no build date', () => {
    assert.match(html, /name="generator" content="backend\/scripts\/build-slides\.js from ALGORITHMS\.md"/);
    assert.ok(
      !/name="generator" content="[^"]*\d{4}-\d{2}-\d{2}T/.test(html),
      'no build timestamp — it would break byte parity on every run',
    );
  });
});

describe('the deck opens with no network and nothing installed', () => {
  test('no external URLs of any kind', () => {
    const offenders = html.match(/https?:\/\/[^\s"'<>)]+/gi) || [];
    // The SVG/xmlns namespace is an identifier, never fetched.
    const fetched = offenders.filter((u) => !/^https?:\/\/www\.w3\.org\//.test(u));
    assert.deepStrictEqual(fetched, [], 'the deck must not reference anything off-disk');
  });

  test('no subresources: no <link>, <script src>, <img>, @import or url()', () => {
    assert.ok(!/<link\b/i.test(html), 'no <link> — the stylesheet is inlined');
    assert.ok(!/<script[^>]+\bsrc\s*=/i.test(html), 'no external script');
    assert.ok(!/<img\b/i.test(html), 'no images to 404 in the exam room');
    assert.ok(!/@import/i.test(html), 'no CSS import');
    const urls = html.match(/url\(([^)]*)\)/gi) || [];
    for (const u of urls) {
      assert.match(u, /url\(\s*['"]?data:/i, 'url() outside a data: URI would need a second file');
    }
  });

  test('no runtime fetches, and nothing that sniffs the network', () => {
    assert.ok(!/\b(fetch|XMLHttpRequest|importScripts|sendBeacon|WebSocket|EventSource)\s*\(/.test(html));
    assert.ok(!/navigator\.onLine/.test(html));
  });

  test('no control bytes leak into the deck', () => {
    // Regression guard. inline() lifts code spans out to \u0000N\u0001
    // placeholders before running emphasis over the text, then puts them back.
    // If that restore regex is written as '\d+' instead of '\\d+' in a string
    // literal, JS silently drops the backslash, the regex matches nothing, and
    // the placeholder bytes ship inside the HTML: invisible on screen, but the
    // file stops being text (grep calls it binary) and every code span renders
    // as unstyled prose instead of a <code> chip.
    const offenders = [];
    for (let i = 0; i < html.length; i++) {
      const c = html.charCodeAt(i);
      if (c < 9 || (c > 13 && c < 32) || c === 127) offenders.push([i, c]);
    }
    assert.deepStrictEqual(offenders.slice(0, 5), [], 'control characters leaked into the deck');
  });

  test('code spans from the document arrive as <code>, not as bare text', () => {
    const codeTags = (html.match(/<code>/g) || []).length;
    assert.ok(codeTags > 50, 'only ' + codeTags + ' code spans rendered — the restore step is broken again');
  });

  test('nothing in the deck is clickable — a slide must not lead off the file', () => {
    // ALGORITHMS.md links to docs/algorithms-deck.html with a repo-root-relative
    // href, which is right on GitHub and wrong inside a deck opened from docs/,
    // where it resolves to docs/docs/… and 404s in the exam room. The renderer
    // therefore turns doc links into inert reference chips. Asserted so a
    // future "let's make the titles link to the docs" change cannot sneak a
    // dead clickable onto a slide.
    assert.deepStrictEqual(html.match(/<a\s[^>]*>/gi) || [], [], 'slide content must not contain anchors');
    assert.ok(/class="ref"/.test(html), 'the deck-link reference chip should still be visible as text');
  });

  test('it is one file with its CSS and JS inline', () => {
    assert.match(html, /^<!DOCTYPE html>/);
    assert.match(html, /<style>[\s\S]+<\/style>/);
    assert.match(html, /<script>[\s\S]+<\/script>/);
  });
});

describe('the rehearsal table IS the presentation', () => {
  test('ALGORITHMS.md still has a parseable rehearsal table', () => {
    const rows = parseRehearsalRows(doc.rehearsal);
    assert.strictEqual(rows.length, 17, 'the rehearsal table is the whole rehearsal plan; do not drop rows');
    rows.forEach((r, i) => {
      assert.strictEqual(r.n, i + 1, 'rows must be numbered 1..n with no gaps');
      assert.ok(r.name && r.where && r.say, 'row ' + r.n + ' needs a name, a "show it here" and a "what to say"');
      assert.ok(!/^["“]|["”]$/.test(r.say), 'the say column is read aloud, so its quotes are stripped');
    });
  });

  test('all 17 rows are on the deck, each on exactly one slide', () => {
    const carrying = new Map();
    for (const s of slides) {
      for (const n of s.rows) {
        assert.ok(!carrying.has(n), 'row ' + n + ' is carried by both "' + carrying.get(n) + '" and "' + s.title + '"');
        carrying.set(n, s.title);
      }
    }
    const missing = doc.rehearsalRows.filter((r) => !carrying.has(r.n)).map((r) => r.n + ' ' + r.name);
    assert.deepStrictEqual(missing, [], 'a rehearsed algorithm with no slide is a blank stare at the panel');
  });

  test('every row\'s spoken line is printed on the slide that carries it', () => {
    for (const row of doc.rehearsalRows) {
      const slide = slides.find((s) => s.rows.includes(row.n));
      const on = chunkText[slide.n - 1];
      assert.ok(
        on.includes(plain(row.say)),
        'rehearsal row ' + row.n + ' ("' + row.name + '") lost its spoken line on slide ' + slide.n,
      );
    }
  });

  test('every row\'s "show it here" pointer and name reach the deck', () => {
    for (const row of doc.rehearsalRows) {
      assert.ok(
        deckText.includes(plain(row.name)),
        'the deck never names "' + row.name + '" (rehearsal row ' + row.n + ')',
      );
      assert.ok(
        deckText.includes(plain(row.where)),
        'rehearsal row ' + row.n + ' ("' + row.name + '") lost its "show it here" pointer',
      );
    }
  });

  test('each rehearsed algorithm names itself on the slide that carries it', () => {
    for (const row of doc.rehearsalRows) {
      const slide = slides.find((s) => s.rows.includes(row.n));
      assert.ok(
        chunkText[slide.n - 1].includes(plain(row.name)) || deckText.includes(plain(row.name)),
        'slide ' + slide.n + ' does not say which algorithm it is defending',
      );
    }
  });

  test('a speaker strip exists on exactly the slides that carry a rehearsal row', () => {
    const strips = (html.match(/<div class="say">/g) || []).length;
    assert.strictEqual(strips, slides.filter((s) => s.rows.length).length);
    assert.ok(strips > 0, 'no slide shows the speaker line at all');
  });

  test('the deck has a contents list covering every slide', () => {
    assert.match(html, /id="sheet"/, 'there must be a contents sheet');
    const toc = html.match(/<li><button data-go="\d+">/g) || [];
    assert.strictEqual(toc.length, slides.length, 'every slide needs a contents row');
  });

  test('slide ids are 1..N with no gaps, so a presenter can type a number', () => {
    const ids = [...html.matchAll(/<section class="[^"]*" id="s(\d+)"/g)].map((m) => Number(m[1]));
    assert.strictEqual(ids.length, slides.length);
    ids.forEach((id, i) => assert.strictEqual(id, i + 1, 'slide ids must run 1..' + ids.length));
  });
});

describe('nothing in ALGORITHMS.md was left off the deck', () => {
  test('the plan places every element exactly once (buildDeck throws otherwise)', () => {
    // Reaching this line means assertFullCoverage() passed inside buildDeck.
    // Pin the count so a silently-emptied plan cannot pass as "complete".
    assert.ok(doc.deck.covered > 100, 'suspiciously few elements placed: ' + doc.deck.covered);
    assert.strictEqual(PLAN.length, slides.length, 'one slide per plan entry');
  });

  test('every numbered algorithm section reaches the deck', () => {
    const numbered = doc.sections.filter((s) => /^§\d+$/.test(s.id));
    assert.ok(numbered.length >= 15, 'ALGORITHMS.md lost its numbered sections');
    for (const sec of numbered) {
      // The slide title drops the "§4" prefix but keeps the words, so match on
      // the words a presenter would say out loud.
      assert.ok(
        deckText.includes(plain(sec.title)),
        'section ' + sec.id + ' "' + sec.title + '" is on no slide',
      );
    }
  });

  test('the source-line chips point at lines that exist in ALGORITHMS.md', () => {
    for (const s of slides) {
      if (!s.srcLines) continue;
      for (const part of String(s.srcLines).split(/[–-]/)) {
        const n = Number(part);
        assert.ok(
          Number.isInteger(n) && n >= 1 && n <= mdLines,
          'slide ' + s.n + ' cites ALGORITHMS.md L' + part + ', outside the ' + mdLines + '-line file',
        );
      }
    }
  });

  test('the verification section is on the deck, with the command that reproduces it', () => {
    assert.ok(doc.sections.some((s) => s.id === 'verify'), 'the verification section disappeared from ALGORITHMS.md');
    assert.ok(chunkFor((s) => s.navTitle.includes('Verification') || s.navTitle.includes('verify')), 'no verification slide');
    assert.ok(deckText.includes('npm run verify'), 'the deck never names the command that reproduces the numbers');
  });

  test('every npm script the deck tells the panel to run actually exists', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'backend', 'package.json'), 'utf8'));
    for (const m of deckText.match(/npm run [a-z:]+/g) || []) {
      // plain() closes up punctuation spacing, so a sentence-final colon can
      // end up glued to the script name — "npm run seed:" -> "seed:".
      const script = m.replace('npm run ', '').replace(/:+$/, '');
      assert.ok(pkg.scripts[script], 'the deck tells the panel to run `npm run ' + script + '`, which is not a script');
    }
  });
});

describe('the deck does not overstate what the repo contains', () => {
  test('ALGORITHMS.md test-file counts match the real backend test tree', () => {
    const dir = path.join(repoRoot, 'backend', 'src', 'test');
    const onDisk = fs.readdirSync(dir).filter((f) => f.endsWith('.test.js')).length;
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'backend', 'package.json'), 'utf8'));
    const listed = (pkg.scripts.test.match(/\.\/src\/test\/\S+\.test\.js/g) || []).length;
    assert.strictEqual(onDisk, listed, 'npm test must run every suite on disk, and no phantoms');

    const claims = md.match(/\b\d{2,3} (?:test )?files\b/gi) || [];
    assert.ok(claims.length > 0, 'ALGORITHMS.md no longer states how many test files it covers');
    for (const claim of claims) {
      const n = Number(claim.match(/\d+/)[0]);
      assert.strictEqual(n, onDisk, 'ALGORITHMS.md claims "' + claim + '" but there are ' + onDisk + ' suites on disk');
    }
    // The same number is quoted on a slide, so the claim travels to the panel.
    for (const claim of claims) {
      assert.ok(deckText.includes(claim.toLowerCase()), 'the deck does not carry the document\'s "' + claim + '" claim');
    }
  });
});