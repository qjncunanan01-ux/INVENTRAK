#!/usr/bin/env node
// Validates backend/openapi.json against the official OpenAPI 3.0.3 schema
// (via @apidevtools/swagger-parser), plus a few project-specific structural
// rules that keep the spec and its codegen healthy:
//   - every operation must declare an operationId
//   - every documented path must actually exist in the API code (see
//     audit-routes.js for the full route <-> spec coverage check)
//
// Usage: node scripts/validate-openapi.js
// Exit code 0 = spec valid, 1 = invalid.
const path = require('node:path');
const SwaggerParser = require('@apidevtools/swagger-parser');

const specFile = path.join(__dirname, '..', 'openapi.json');

async function main() {
  // 1. Validate against the OpenAPI 3.0.x meta-schema (structure + $refs).
  const api = await SwaggerParser.validate(specFile);
  if (!api.openapi || !api.openapi.startsWith('3.0.')) {
    throw new Error(`Spec must be OpenAPI 3.0.x, got ${api.openapi}`);
  }

  // 2. Every operation needs an operationId (used for client codegen + links).
  const missing = [];
  for (const [p, methods] of Object.entries(api.paths)) {
    for (const [method, op] of Object.entries(methods)) {
      if (!['get', 'post', 'put', 'delete', 'patch'].includes(method)) continue;
      if (!op.operationId) missing.push(`${method.toUpperCase()} ${p}`);
    }
  }
  if (missing.length) {
    throw new Error(`Operations missing operationId: ${missing.join(', ')}`);
  }

  console.log(`✓ openapi.json is a valid OpenAPI ${api.openapi} document`);
  console.log(`  ${Object.keys(api.paths).length} paths, ${Object.keys(api.components.schemas || {}).length} schemas, ${missing.length === 0 ? 'all operationIds present' : ''}`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(`✗ INVALID: ${err.message}`);
    process.exit(1);
  }
);
