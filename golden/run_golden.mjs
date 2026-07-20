#!/usr/bin/env node
// Golden set runner. Replays the workflow's own decision code against the
// config snapshot and asserts each case. Run: node run_golden.mjs [--generate]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const wf = JSON.parse(readFileSync(join(HERE, '..', 'workflows', 'fieldops-procure-to-approve.prod.json'), 'utf8'));
const config = JSON.parse(readFileSync(join(HERE, 'golden_config.json'), 'utf8'));
const cases = JSON.parse(readFileSync(join(HERE, 'golden_cases.json'), 'utf8'));
const GENERATE = process.argv.includes('--generate');

const codeOf = (id) => {
  const n = wf.nodes.find(n => n.id === id);
  if (!n) throw new Error('node not found: ' + id);
  return n.parameters.jsCode;
};
const CODE = {
  normalize: codeOf('normalize-request'),
  policy:    codeOf('load-policy'),
  price:     codeOf('best-price--maverick-flag'),
  route:     codeOf('threshold-eval--self-check'),
};

// Run one Code node's source with n8n-style $input / $ helpers.
function runNode(code, inputItems, ctx) {
  const $input = {
    first: () => inputItems[0],
    last:  () => inputItems[inputItems.length - 1],
    all:   () => inputItems,
  };
  const $ = (name) => ({
    first: () => (ctx[name] || [])[0],
    last:  () => (ctx[name] || [])[(ctx[name] || []).length - 1],
    all:   () => ctx[name] || [],
  });
  // eslint-disable-next-line no-new-func
  return new Function('$input', '$', code)($input, $);
}

// The two Data Table "get / allConditions" nodes, as plain filters.
const doaLookup = (req) => config.doa_rules
  .filter(r => r.business_unit === req.business_unit && r.category === req.category)
  .map(json => ({ json }));
const vendorLookup = (req) => config.vendor_catalog
  .filter(r => r.sku === req.sku && r.category === req.category)
  .map(json => ({ json }));

function decide(input) {
  const ctx = {};
  const norm = runNode(CODE.normalize, [{ json: input }], ctx);
  ctx['Normalize Request'] = norm;
  const req = norm[0].json;

  ctx['DoA Rule Lookup'] = doaLookup(req);
  ctx['Load BU Policy'] = runNode(CODE.policy, ctx['DoA Rule Lookup'], ctx);

  ctx['Vendor Catalog Lookup'] = vendorLookup(req);
  const price = runNode(CODE.price, ctx['Vendor Catalog Lookup'], ctx);
  ctx['Best Price + Maverick Flag'] = price;
  const priced = price[0].json;

  if (!priced.catalog_match) return priced;            // NEEDS_SOURCING, no routing
  return runNode(CODE.route, price, ctx)[0].json;
}

// ---- run ----
const CHECK = ['route', 'route_reason', 'state', 'self_check', 'catalog_match',
               'best_vendor_id', 'derived_amount', 'savings_vs_incumbent', 'maverick_flag'];
let pass = 0, fail = 0;
const gen = [];

for (const c of cases) {
  let got, err = null;
  try { got = decide(c.input); } catch (e) { err = e.message; }

  if (GENERATE) {
    gen.push({ name: c.name, input: c.input,
      expect: err ? { error: true } : Object.fromEntries(
        CHECK.filter(k => got[k] !== undefined).map(k => [k, got[k]])) });
    continue;
  }

  // expected error case
  if (c.expect.error) {
    if (err) { pass++; console.log(`PASS  ${c.name}  (threw as expected: ${err.slice(0,50)})`); }
    else { fail++; console.log(`FAIL  ${c.name}  expected an error, got route=${got.route}`); }
    continue;
  }
  if (err) { fail++; console.log(`FAIL  ${c.name}  unexpected error: ${err}`); continue; }

  const diffs = [];
  for (const [k, v] of Object.entries(c.expect)) {
    if (got[k] !== v) diffs.push(`${k}: expected ${JSON.stringify(v)}, got ${JSON.stringify(got[k])}`);
  }
  if (diffs.length) { fail++; console.log(`FAIL  ${c.name}`); diffs.forEach(d => console.log('        ' + d)); }
  else { pass++; console.log(`PASS  ${c.name}`); }
}

if (GENERATE) { console.log(JSON.stringify(gen, null, 2)); process.exit(0); }

console.log(`\n${pass} passed, ${fail} failed, ${cases.length} total`);
process.exit(fail ? 1 : 0);
