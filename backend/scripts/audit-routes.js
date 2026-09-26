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

// --- Express route extraction (app.js + src/routes/*.js) ---
//
// The backend was refactored so routes live in per-domain Express Routers
// mounted in app.js (app.use('/api/auth', authRoutes) + router.post('/login'))
// rather than flat app.get('/api/auth/login', ...) calls. The extractor now
// parses BOTH shapes:
//   1. flat registrations:      app.get('/api/x', ...)
//   2. mounted routers:         app.use('/api/auth', xRoutes) combined with
//                               xRoutes = express.Router(); router.post('/login')
// Router files are located by the require() in app.js that binds the mount to
// the routes variable, so a router added to app.js is picked up automatically.
function expressRoutes(appSrc) {
  const routesDir = path.join(backendDir, 'src', 'routes');
  const routes = [];

  // 1. Flat app-level registrations.
  const flatRe = /app\.(get|post|put|delete)\s*\(\s*(['"`])([^'"`]+)\2/g;
  let m;
  while ((m = flatRe.exec(appSrc)) !== null) {
    routes.push({ method: m[1].toUpperCase(), path: normalize(m[3]) });
  }

  // 2. Mounted routers. Map `const xRoutes = require('./routes/x')` to its
  //    mount path from `app.use('<mount>', xRoutes)`.
  const requireRe = /const\s+(\w+)\s*=\s*require\(\s*['"]\.\/routes\/([\w-]+)['"]\s*\)/g;
  const varToFile = {};
  while ((m = requireRe.exec(appSrc)) !== null) {
    varToFile[m[1]] = m[2];
  }

  const mountRe = /app\.use\(\s*['"]([^'"]+)['"]\s*,\s*(\w+)\s*\)/g;
  while ((m = mountRe.exec(appSrc)) !== null) {
    const mountPath = m[1];
    const routerFile = varToFile[m[2]];
    if (!routerFile) continue; // non-router mount (static, middleware)
    const routerPath = path.join(routesDir, routerFile + '.js');
    if (!fs.existsSync(routerPath)) continue;
    const routerSrc = fs.readFileSync(routerPath, 'utf8');
    const reRe = /router\.(get|post|put|delete|patch)\s*\(\s*(['"`])([^'"`]+)\2/g;
    let rm;
    while ((rm = reRe.exec(routerSrc)) !== null) {
      const sub = rm[3];
      const full = mountPath + (sub === '/' ? '' : sub);
      routes.push({ method: rm[1].toUpperCase(), path: normalize(full) });
    }
  }

  return routes;
}

// --- npm-free URL matcher extraction (server_npmfree.js) ---
// Collects the literal paths used in url === / startsWith / endsWith /
// url.split('?')[0] === dispatches. Prefix matchers (e.g. '/api/products/')
// intentionally cover every deeper documented path.
function npmfreeLiterals(src) {
  const literals = new Set();
  const re = /url\s*(?:\.startsWith\(|\.endsWith\(|\.split\('\?'\)\[0\]\s*===|===)\s*'([^']+)'/g;
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
  // Both extractors scope themselves to API surfaces: npmfreeLiterals keeps
  // only '/api/…' literals, so the Express side ignores non-API paths too.
  // (The public GET /t/:code tag page is a web surface, not part of the API
  // contract — it is covered by functional tests, not by this audit.)
  const apiExpress = express.filter(r => r.path.startsWith('/api/'));
  const errors = [];

  // (a) Every Express API route must be documented (exact template match).
  for (const r of apiExpress) {
    if (!specPaths.includes(r.path)) {
      errors.push(`Express route ${r.method} ${r.path} is NOT documented in openapi.json`);
    }
  }

  // (a2) Every npm-free literal must be consistent with a documented path
  // (equal, a prefix of it, or a prefix of the literal).
  for (const lit of npmfree) {
    const ok = specPaths.some(p => p === lit || p.startsWith(lit) || lit.startsWith(p));
    if (!ok) {
      errors.push(`npm-free matcher '${lit}' matches no documented path in openapi.json`);
    }
  }

  // (b) Every documented path must be served by Express (exact or template)
  // AND reachable from the npm-free fallback (exact or prefix literal).
  for (const p of specPaths) {
    const inExpress = apiExpress.some(r => r.path === p || templateMatches(r.path, p));
    const inNpmfree = npmfree.some(lit => p === lit || p.startsWith(lit));
    if (!inExpress) errors.push(`Path ${p} (openapi.json) has no matching Express route`);
    if (!inNpmfree) errors.push(`Path ${p} (openapi.json) is not reachable in the npm-free fallback`);
  }

  if (errors.length) {
    console.error('✗ Route <-> spec coverage audit FAILED:');
    for (const e of errors) console.error(`   - ${e}`);
    process.exit(1);
  }
  console.log(
    `✓ audit: ${apiExpress.length} Express API routes + ${npmfree.length} npm-free matchers ↔ ${specPaths.length} documented paths all covered`
  );
}

main();
