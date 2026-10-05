import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Two layout faults, both invisible in a screenshot at 1400px and both
// reported as "the frontend overlaps itself" on a narrow window.
//
// 1. A wide <Table> with no scroll container. The inventory table is 744px of
//    columns; at a 420px window the document's scrollWidth became 785 and the
//    extra content slid out from under the page, on top of the 280px sticky
//    sidebar. Every table now lives in <TableContainer sx={{ overflowX: 'auto'
//    }}>, so the overflow is absorbed inside the table's own box.
//
// 2. A CSS Grid track declared as a bare `1fr`. `1fr` is really
//    `minmax(auto, 1fr)`, and `auto` resolves to the item's MIN-CONTENT width.
//    A native <select> inside a grid cell sizes its min-content to its widest
//    <option>, so one long product name pushed the track to 674px and blew the
//    page out to 739px. `minmax(0, 1fr)` lets the track shrink and the control
//    clip instead. A track written `minmax(200px, 1fr)` is already safe — the
//    min is a fixed length, so min-content never wins.
//
// Neither fault shows up as a failed test, and both are easy to reintroduce by
// adding one page, so they are checked here the same way the dropdown labels
// are: by reading the source.

const SRC_DIR = path.resolve(__dirname, '..');

// Every .jsx under src/, not just src/pages/. A bare `fr` inside a component
// blows out the page exactly as hard as one inside a page, and a table in a
// component is just as unscrollable — so scoping this to pages would leave the
// same bug reachable one directory over.
function collectJsx(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectJsx(full, acc);
    else if (entry.name.endsWith('.jsx') && !entry.name.endsWith('.test.jsx')) acc.push(full);
  }
  return acc;
}

const pageFiles = collectJsx(SRC_DIR);

function rel(file) {
  return path.relative(SRC_DIR, file).split(path.sep).join('/');
}

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function lineOf(src, index) {
  return src.slice(0, index).split('\n').length;
}

describe('admin pages cannot push content out sideways', () => {
  it('finds the files to check (guard against a silent no-op)', () => {
    expect(pageFiles.length).toBeGreaterThan(15);
    // The walk has to reach components/ too, or this whole file is a guard over
    // one directory with the other one unguarded.
    expect(pageFiles.some((f) => f.includes(`${path.sep}components${path.sep}`))).toBe(true);
  });

  it('every Table sits inside a TableContainer', () => {
    const offenders = [];
    for (const file of pageFiles) {
      const src = read(file);
      for (const m of src.matchAll(/<Table\b[^>]*>/g)) {
        // `size="small"` / `stickyHeader` props do not make a scroll container.
        if (!/<TableContainer\b[^>]*>\s*$/.test(src.slice(0, m.index))) {
          offenders.push(`${rel(file)}:${lineOf(src, m.index)} ${m[0]}`);
        }
      }
    }
    expect(offenders, `Table with no TableContainer:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('every TableContainer actually scrolls on the cross axis', () => {
    const offenders = [];
    for (const file of pageFiles) {
      const src = read(file);
      for (const m of src.matchAll(/<TableContainer\b([^>]*)>/g)) {
        if (!/overflowX/.test(m[1])) {
          offenders.push(`${rel(file)}:${lineOf(src, m.index)} <TableContainer${m[1]}>`);
        }
      }
    }
    expect(offenders, `TableContainer that does not scroll:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('no grid track is declared with a bare fr', () => {
    const offenders = [];
    for (const file of pageFiles) {
      const src = read(file);
      // The value is either a bare string, or a breakpoint map
      // ({ xs: '…', md: '…' }) — so take the declaration and read every quoted
      // track list inside it.
      for (const m of src.matchAll(/gridTemplateColumns:(.{0,160})/g)) {
        for (const q of m[1].matchAll(/'([^']*)'/g)) {
          const value = q[1];
          // Strip the sized tracks; whatever is left that still ends in a bare
          // `fr` is a min-content track waiting for a wide child.
          const bare = value
            .replace(/minmax\([^)]*\)/g, 'SAFE')
            .match(/(?:^|[\s(,])\d*\.?\d*fr(?=$|[\s,)])/g);
          if (bare) {
            offenders.push(`${rel(file)}:${lineOf(src, m.index)} gridTemplateColumns: '${value}'`);
          }
        }
      }
    }
    expect(offenders, `bare fr track(s) — use minmax(0, 1fr):\n${offenders.join('\n')}`).toEqual([]);
  });

  it('the guard above actually catches the two faults it claims to', () => {
    // A regex that matches nothing is worse than no test, so prove the two
    // detectors fire on the pre-fix shapes and stay quiet on the fixed ones.
    const bareFr = (decl) => {
      for (const q of decl.matchAll(/'([^']*)'/g)) {
        const stripped = q[1].replace(/minmax\([^)]*\)/g, 'SAFE');
        if (/(?:^|[\s(,])\d*\.?\d*fr(?=$|[\s,)])/.test(stripped)) return true;
      }
      return false;
    };
    expect(bareFr(`'1fr'`)).toBe(true);
    expect(bareFr(`{ xs: '1fr', md: '1fr 1.4fr' }`)).toBe(true);
    expect(bareFr(`'repeat(2, 1fr)'`)).toBe(true);
    expect(bareFr(`{ xs: 'minmax(0, 1fr)', md: 'minmax(0, 1fr) minmax(0, 1.4fr)' }`)).toBe(false);
    expect(bareFr(`'repeat(auto-fit, minmax(200px, 1fr))'`)).toBe(false);

    const wrapped = (src) => {
      const at = src.indexOf('<Table ');
      return /<TableContainer\b[^>]*>\s*$/.test(src.slice(0, at));
    };
    expect(wrapped('<TableContainer sx={{ overflowX: \'auto\' }}>\n  <Table size="small">')).toBe(true);
    expect(wrapped('  <Table size="small">')).toBe(false);
  });
});
