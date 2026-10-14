import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { NAV_SECTIONS } from './layout/AdminLayout';

// The sidebar groups the admin modules into sections (NAV_SECTIONS in
// AdminLayout.jsx) and the page files are grouped into matching folders under
// pages/. Nothing on screen says whether the two still agree, and moving a
// single file breaks it silently — so it is checked here the same way the
// dropdown-label and layout-overflow guards are: by reading the source.
//
// A nav item's folder is resolved through App.jsx (path → page import →
// folder), not by guessing from the label, so a page dropped into the wrong
// section folder is caught even when its name looks right.

const PAGES_DIR = path.resolve(__dirname);
const APP_SRC = path.resolve(__dirname, '..', 'App.jsx');

// Folders that legitimately live under pages/ but are NOT sidebar sections:
// the login page (auth) and the layout shell every page renders inside.
const NON_SECTION_FOLDERS = new Set(['auth', 'layout']);

// label → folder slug, the same rule the tree uses ("Catalog & Orders" →
// "catalog-orders").
function slug(label) {
  return String(label)
    .toLowerCase()
    .replace(/&/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// path → '<folder>/<File>' for every page route in App.jsx. Each <Route> sits
// on a single line, so a line scan is more robust than a nested-JSX regex.
function routeModuleMap() {
  const src = fs.readFileSync(APP_SRC, 'utf8');
  const imports = {};
  for (const m of src.matchAll(/import\s+([A-Za-z_$][\w$]*)\s+from\s+'\.\/pages\/([^']+)'/g)) {
    imports[m[1]] = m[2];
  }
  const byPath = {};
  for (const line of src.split(/\r?\n/)) {
    const route = line.match(/<Route\s+path="([^"]+)"/);
    if (!route) continue;
    const name = Object.keys(imports).find((n) => new RegExp(`<${n}[\\s/>]`).test(line));
    if (name) byPath[route[1]] = imports[name];
  }
  return byPath;
}

const byPath = routeModuleMap();
const folderOf = (mod) => (mod.includes('/') ? mod.split('/')[0] : '');

// --- reachability ---------------------------------------------------------
// A page component is reachable if a <Route> in App.jsx renders it, or if a
// reachable page imports it (the extracted panels — ProductFormPanel,
// StatCard, AdminLayout … — are reached that way, so a "must be a route" rule
// would wrongly flag them). Anything reachable from neither is an orphan: a
// screen nothing can ever show.

// Every non-test .jsx under pages/, as posix-relative keys.
function listPageFiles() {
  const acc = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.jsx') && !entry.name.endsWith('.test.jsx')) {
        acc.push(path.relative(PAGES_DIR, full).split(path.sep).join('/'));
      }
    }
  })(PAGES_DIR);
  return acc;
}

// Relative import specifiers in a file.
function importsOf(absFile) {
  const src = fs.readFileSync(absFile, 'utf8');
  const specs = [];
  for (const m of src.matchAll(/\bfrom\s+['"](\.[^'"]+)['"]/g)) specs.push(m[1]);
  for (const m of src.matchAll(/\bimport\s+['"](\.[^'"]+)['"]/g)) specs.push(m[1]);
  return specs;
}

// Resolve a relative specifier to a pages/ file key, or null if it points
// outside pages/ (or at nothing on disk).
function resolvePageKey(absFile, spec) {
  const base = path.resolve(path.dirname(absFile), spec);
  for (const cand of [base, `${base}.jsx`, `${base}.js`]) {
    if (fs.existsSync(cand) && fs.statSync(cand).isFile()) {
      const rel = path.relative(PAGES_DIR, cand).split(path.sep).join('/');
      return rel.startsWith('..') ? null : rel;
    }
  }
  return null;
}

const allPageFiles = listPageFiles();
const routeTargets = new Set(Object.keys(byPath).map((p) => `${byPath[p]}.jsx`));

// Breadth-first over the pages/ import graph, starting from the routed pages.
function reachablePageKeys() {
  const seen = new Set();
  const queue = [...routeTargets];
  while (queue.length) {
    const key = queue.shift();
    if (seen.has(key)) continue;
    seen.add(key);
    const abs = path.join(PAGES_DIR, key);
    if (!fs.existsSync(abs)) continue;
    for (const spec of importsOf(abs)) {
      const target = resolvePageKey(abs, spec);
      if (target && !seen.has(target)) queue.push(target);
    }
  }
  return seen;
}

describe('admin page folders mirror the sidebar sections', () => {
  it('finds the sections and routes to check (guard against a silent no-op)', () => {
    expect(NAV_SECTIONS.length).toBeGreaterThan(4);
    expect(Object.keys(byPath).length).toBeGreaterThan(10);
  });

  it('every nav section has a matching folder', () => {
    const missing = NAV_SECTIONS
      .map((s) => slug(s.label))
      .filter((folder) => !fs.existsSync(path.join(PAGES_DIR, folder)));
    expect(missing, `NAV_SECTIONS with no pages/<slug>/ folder:\n${missing.join('\n')}`).toEqual([]);
  });

  it('every nav item renders a page that lives in its section folder', () => {
    const offenders = [];
    for (const section of NAV_SECTIONS) {
      const folder = slug(section.label);
      for (const item of section.items) {
        const mod = byPath[item.path];
        if (!mod) {
          offenders.push(`${item.label} (${item.path}) has no <Route> in App.jsx`);
          continue;
        }
        const dir = folderOf(mod);
        if (dir !== folder) {
          offenders.push(`${item.label} (${item.path}) → pages/${dir || '<root>'}/${mod.split('/').pop()}, but section "${section.label}" is pages/${folder}/`);
        }
      }
    }
    expect(offenders, `nav items living outside their section folder:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('has no section folders beyond the nav sections (plus the known non-nav folders)', () => {
    const dirs = fs.readdirSync(PAGES_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
    const allowed = new Set([...NAV_SECTIONS.map((s) => slug(s.label)), ...NON_SECTION_FOLDERS]);
    const unexpected = dirs.filter((d) => !allowed.has(d));
    const missing = [...allowed].filter((d) => !dirs.includes(d));
    expect(unexpected, `unexpected folder(s) under pages/ — give the section a NAV entry or add it to NON_SECTION_FOLDERS:\n${unexpected.join('\n')}`).toEqual([]);
    expect(missing, `expected folder(s) that are missing:\n${missing.join('\n')}`).toEqual([]);
  });
});

describe('no page is orphaned', () => {
  it('found page files and route targets to walk (guard against a silent no-op)', () => {
    expect(allPageFiles.length).toBeGreaterThan(15);
    expect(routeTargets.size).toBeGreaterThan(10);
  });

  it('every page .jsx is reachable from a route, directly or via another page', () => {
    const reachable = reachablePageKeys();
    const orphans = allPageFiles.filter((f) => !reachable.has(f));
    expect(orphans, `page file(s) nothing reaches from an App.jsx route — wire a route or delete them:\n${orphans.join('\n')}`).toEqual([]);
  });

  it('walks through page-to-page imports, not just the route targets', () => {
    // The extracted panels are only reachable via their page, so a rule that
    // only accepted route targets would either flag them or miss them. Prove
    // the walk actually follows an import edge to a non-routed page file.
    const reachable = reachablePageKeys();
    const nonRouted = [...reachable].filter((k) => !routeTargets.has(k));
    expect(nonRouted.length).toBeGreaterThan(0);
  });
});
