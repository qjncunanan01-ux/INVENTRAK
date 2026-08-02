#!/usr/bin/env node
// Generates a JavaScript API client from backend/openapi.json for both the
// admin dashboard and the mobile client. The generated module:
//   - keeps the generic apiGet/apiPost/apiPut/apiDelete helpers with the exact
//     same signatures the pages/screens already import (path strings with
//     optional embedded query strings, or (path, body))
//   - adds one typed function per OpenAPI operation (named from operationId),
//     with path params destructured ({ id }), an optional query params object,
//     and an optional body argument — all derived from the spec
//   - never hand-writes a fetch URL: every request is validated to be a
//     documented operation shape by construction
//
// Usage:
//   node scripts/generate-client.js            # write both clients
//   node scripts/generate-client.js --check    # fail if files are stale
const fs = require('node:fs');
const path = require('node:path');

const backendDir = path.join(__dirname, '..');
const spec = JSON.parse(fs.readFileSync(path.join(backendDir, 'openapi.json'), 'utf8'));

const OUTPUTS = [
  path.join(backendDir, '..', 'frontend-admin', 'src', 'api.generated.js'),
  path.join(backendDir, '..', 'mobile-client', 'src', 'api.generated.js'),
];

const SKIP_OPERATIONS = new Set(['getDocs', 'getOpenapi']); // HTML / meta endpoints

function pathParamsOf(template) {
  return [...template.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
}

function queryParamsOf(op) {
  return (op.parameters || []).filter((p) => p.in === 'query').map((p) => p.name);
}

function hasJsonBody(op) {
  return !!(op.requestBody && op.requestBody.content && op.requestBody.content['application/json']);
}

// Builds a typed function for one operation.
function typedFunction(method, template, op) {
  const name = op.operationId;
  const pathParams = pathParamsOf(template);
  const queryParams = queryParamsOf(op);
  const body = hasJsonBody(op);

  // Argument list: ({ id }) or (params) or (body), in a stable order.
  let args = [];
  if (pathParams.length) args.push(`{ ${pathParams.join(', ')} }`);
  if (queryParams.length) args.push('params');
  if (body) args.push('body');
  const argList = args.join(', ') || '_';

  const opts = [];
  if (pathParams.length) opts.push(`params: { ${pathParams.join(', ')} }`);
  if (queryParams.length) opts.push('query: params');
  if (body) opts.push('body');

  return (
    `  // ${method.toUpperCase()} ${template} — ${(op.summary || '').replace(/\n/g, ' ')}\n` +
    `  ${name}: (${argList}) => request('${method.toUpperCase()}', '${template}', { ${opts.join(', ')} }),`
  );
}

function generate() {
  const lines = [];
  lines.push('// AUTO-GENERATED from backend/openapi.json — do not edit by hand.');
  lines.push('// Regenerate with: cd backend && npm run client:generate');
  lines.push('// This module is the single source of truth for how the frontends');
  lines.push('// talk to the API: every endpoint below mirrors the OpenAPI contract.');
  lines.push('');
  lines.push('export function createApiClient({ baseUrl = "", getToken = () => null } = {}) {');
  lines.push('  async function request(method, pathTemplate, { params, query, body } = {}) {');
  lines.push('    let url = `${baseUrl}${pathTemplate}`;');
  lines.push('    if (params) {');
  lines.push('      for (const [k, v] of Object.entries(params)) {');
  lines.push('        url = url.replace(`{${k}}`, encodeURIComponent(v));');
  lines.push('      }');
  lines.push('    }');
  lines.push('    if (query) {');
  lines.push('      const qs = new URLSearchParams();');
  lines.push('      for (const [k, v] of Object.entries(query)) {');
  lines.push('        if (v !== undefined && v !== null) qs.set(k, v);');
  lines.push('      }');
  lines.push('      const s = qs.toString();');
  lines.push('      if (s) url += (url.includes("?") ? "&" : "?") + s;');
  lines.push('    }');
  lines.push('    const headers = { "Content-Type": "application/json" };');
  lines.push('    const token = getToken();');
  lines.push('    if (token) headers.Authorization = `Bearer ${token}`;');
  lines.push('    const res = await fetch(url, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });');
  lines.push('    const text = await res.text();');
  lines.push('    let data = text;');
  lines.push('    try { data = JSON.parse(text); } catch (e) { /* non-JSON (e.g. CSV export) */ }');
  lines.push('    if (!res.ok) {');
  lines.push('      const msg = data && typeof data === "object" && (data.error || data.message)');
  lines.push('        ? data.error || data.message');
  lines.push('        : `Request failed (${res.status})`;');
  lines.push('      throw new Error(msg);');
  lines.push('    }');
  lines.push('    return data;');
  lines.push('  }');
  lines.push('');
  lines.push('  // Generic path-based helpers (same signatures the pages already use).');
  lines.push('  const apiGet = (path) => request("GET", path);');
  lines.push('  const apiPost = (path, body) => request("POST", path, { body });');
  lines.push('  const apiPut = (path, body) => request("PUT", path, { body });');
  lines.push('  const apiDelete = (path) => request("DELETE", path);');
  lines.push('');
  lines.push('  return {');
  lines.push('    apiGet, apiPost, apiPut, apiDelete,');

  for (const [template, methods] of Object.entries(spec.paths)) {
    for (const [method, op] of Object.entries(methods)) {
      if (!['get', 'post', 'put', 'delete'].includes(method)) continue;
      if (SKIP_OPERATIONS.has(op.operationId)) continue;
      lines.push(typedFunction(method, template, op));
    }
  }

  lines.push('  };');
  lines.push('}');
  lines.push('');
  lines.push('export default createApiClient;');
  return lines.join('\n');
}

const content = generate() + '\n';

if (process.argv.includes('--check')) {
  let stale = false;
  for (const file of OUTPUTS) {
    const onDisk = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    if (onDisk !== content) {
      console.error(`✗ STALE: ${path.relative(backendDir, file)} is out of date. Run npm run client:generate.`);
      stale = true;
    } else {
      console.log(`✓ fresh: ${path.relative(backendDir, file)}`);
    }
  }
  process.exit(stale ? 1 : 0);
}

for (const file of OUTPUTS) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  console.log(`✓ wrote ${path.relative(backendDir, file)}`);
}
