#!/usr/bin/env node
// Route <-> spec coverage audit.
//
// Parses the actual route registrations from the SQLite Express backend
// (backend/src/app.js) and the npm-free fallback (backend/src/server_npmfree.js)
// and asserts BOTH directions hold:
//   (a) every route registered in code is documented in backend/openapi.json
//   (b) every path documented in openapi.json is actually served by at least
//       one of the two backends
//
// This is the "spec stays in sync with the routes" guard: a developer who adds
// a route without updating the spec (or documents a route that doesn't exist)
// gets a red CI run.
//
// Usage: node scripts/audit-routes.js
const fs = require('node:fs');
const path = require('node:path');

const backendDir = path.join(__dirname, '..');
const spec = JSON.parse(fs.readFileSync(path.join(backendDir, 'openapi.json'), 'utf8'));
const specPaths = Object.keys(spec.paths);

// ':id' -> '{id}' so Express paths compare against OpenAPI templates.
function normalize(p) {
  return p.replace(/\/:(\w+)/g, '/{$1}');
}

// True if an OpenAPI template ('/api/products/{id}') can serve a concrete
// path ('/api/products/3') segment by segment.
function templateMatches(template, concrete) {
  const t = template.split('/');
  const c = concrete.split('/');
  if (t.length !== c.length) return false;
  return t.every((seg, i) => seg === c[i] || /^\{[^}]+\}$/.test(seg));
}

// --- Express route extraction (app.js) ---
function expressRoutes(src) {
  const routes = [];
  const re = /app\.(get|post|put|delete)\s*\(\s*(['"`])([^'"`]+)\2/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    routes.push({ method: m[1].toUpperCase(), path: normalize(m[3]) });
  }
  return routes;
}

// --- npm-free URL matcher extraction (server_npmfree.js) ---
// Collects the literal paths used in url === / startsWith / endsWith /
// url.split('?')[0] === dispatches. Prefix matchers (e.g. '/api/products/')
// intentionally cover every deeper documented path.
function npmfreeLiterals(src) {
  const literals = new Set();
  const re =
    /url\s*(?:\.startsWith\(|\.endsWith\(|\.split\('\?'\)\[0\]\s*===|===)\s*'([^']+)'/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    // Strip an accidental trailing query marker ('/api/products?').
    const clean = m[1].replace(/\?+$/, '');
    if (clean.startsWith('/api/')) literals.add(clean);
  }
  return [...literals];
}

function main() {
  const appSrc = fs.readFileSync(path.join(backendDir, 'src', 'app.js'), 'utf8');
  const npmfreeSrc = fs.readFileSync(path.join(backendDir, 'src', 'server_npmfree.js'), 'utf8');

  const express = expressRoutes(appSrc);
  const npmfree = npmfreeLiterals(npmfreeSrc);
  const errors = [];

  // (a) Every Express route must be documented (exact template match).
  for (const r of express) {
    if (!specPaths.includes(r.path)) {
      errors.push(`Express route ${r.method} ${r.path} is NOT documented in openapi.json`);
    }
  }

  // (a2) Every npm-free literal must be consistent with a documented path
  // (equal, a prefix of it, or a prefix of the literal).
  for (const lit of npmfree) {
    const ok = specPaths.some(
      (p) => p === lit || p.startsWith(lit) || lit.startsWith(p)
    );
    if (!ok) {
      errors.push(`npm-free matcher '${lit}' matches no documented path in openapi.json`);
    }
  }

  // (b) Every documented path must be served by Express (exact or template)
  // AND reachable from the npm-free fallback (exact or prefix literal).
  for (const p of specPaths) {
    const inExpress = express.some((r) => r.path === p || templateMatches(r.path, p));
    const inNpmfree = npmfree.some((lit) => p === lit || p.startsWith(lit));
    if (!inExpress) errors.push(`Path ${p} (openapi.json) has no matching Express route`);
    if (!inNpmfree) errors.push(`Path ${p} (openapi.json) is not reachable in the npm-free fallback`);
  }

  if (errors.length) {
    console.error('✗ Route <-> spec coverage audit FAILED:');
    for (const e of errors) console.error(`   - ${e}`);
    process.exit(1);
  }
  console.log(`✓ audit: ${express.length} Express routes + ${npmfree.length} npm-free matchers ↔ ${specPaths.length} documented paths all covered`);
}

main();
