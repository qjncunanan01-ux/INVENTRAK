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

const PAGES_DIR = path.resolve(__dirname);
const pageFiles = fs
  .readdirSync(PAGES_DIR)
  .filter((f) => f.endsWith('.jsx') && !f.endsWith('.test.jsx'));

function read(file) {
  return fs.readFileSync(path.join(PAGES_DIR, file), 'utf8');
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
          offenders.push(`${file}:${line} <InputLabel${m[1]}>`);
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
          offenders.push(`${file}:${line} <Select${m[1].slice(0, 60)}…`);
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
      expect(dupes, `${file} reuses id(s): ${[...new Set(dupes)].join(', ')}`).toEqual([]);
    }
  });
});