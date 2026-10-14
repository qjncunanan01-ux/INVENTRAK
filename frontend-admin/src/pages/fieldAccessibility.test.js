import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Every dropdown in the admin was built from the bare
// `<FormControl><InputLabel/><Select/></FormControl>` composition. That looks
// equivalent to `<TextField select>`, and it renders the caption — but unlike
// TextField, FormControl does NOT generate ids, so the label was never bound to
// the control. Each dropdown announced itself as an unnamed "combo box": on the
// Inventory page, three of them, all identical, all unlabelled.
//
// The fix is a labelId on the Select (which becomes aria-labelledby) and an id
// on the InputLabel. This test fails if either is ever dropped again, because
// nothing about the failure is visible on screen — the dropdown still looks
// perfectly labelled.

// Pages live in per-section subfolders (overview/, inventory/, …), so this
// walk has to recurse — a flat readdir over pages/ would only see the files
// still at the root and silently stop guarding the rest.
const PAGES_DIR = path.resolve(__dirname);
function collectPages(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectPages(full, acc);
    else if (entry.name.endsWith('.jsx') && !entry.name.endsWith('.test.jsx')) acc.push(full);
  }
  return acc;
}
const pageFiles = collectPages(PAGES_DIR);

function rel(file) {
  return path.relative(PAGES_DIR, file).split(path.sep).join('/');
}

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

describe('admin form fields are programmatically labelled', () => {
  it('finds the pages to check (guard against a silent no-op)', () => {
    expect(pageFiles.length).toBeGreaterThan(10);
  });

  it('every InputLabel carries an id', () => {
    const offenders = [];
    for (const file of pageFiles) {
      const src = read(file);
      for (const m of src.matchAll(/<InputLabel\b([^>]*)>/g)) {
        if (!/\bid\s*=/.test(m[1])) {
          const line = src.slice(0, m.index).split('\n').length;
          offenders.push(`${rel(file)}:${line} <InputLabel${m[1]}>`);
        }
      }
    }
    expect(offenders, `InputLabel without an id:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('every Select carries a labelId, so the label reaches aria-labelledby', () => {
    const offenders = [];
    for (const file of pageFiles) {
      const src = read(file);
      for (const m of src.matchAll(/<Select\b([^>]*)>/g)) {
        if (!/\blabelId\s*=/.test(m[1])) {
          const line = src.slice(0, m.index).split('\n').length;
          offenders.push(`${rel(file)}:${line} <Select${m[1].slice(0, 60)}…`);
        }
      }
    }
    expect(offenders, `Select without a labelId:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('no two field ids collide within a page (a duplicate breaks label[for])', () => {
    for (const file of pageFiles) {
      const src = read(file);
      const ids = [...src.matchAll(/\bid\s*=\s*"([^"]+)"/g)].map((m) => m[1]);
      const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
      expect(dupes, `${rel(file)} reuses id(s): ${[...new Set(dupes)].join(', ')}`).toEqual([]);
    }
  });
});