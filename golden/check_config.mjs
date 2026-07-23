// Config-integrity gate. Complements run_golden.mjs: the golden cases prove the
// decision LOGIC is correct; this proves the CONFIG itself is intact.
//
// Two jobs:
//   1. Invariants  - structural rules the tables must always satisfy
//                    (no gaps/overlaps in the threshold ladder, referential
//                    integrity, complete bands, sane values).
//   2. Drift diff  - compares a supplied config against the approved snapshot
//                    (golden_config.json) and fails on ANY added/removed/changed
//                    row. This is what catches a deleted data-table row that no
//                    decision case happens to exercise.
//
// Usage:
//   node golden/check_config.mjs                 invariants on the snapshot itself
//   node golden/check_config.mjs live.json       invariants on live.json + drift vs snapshot
//
// Exit code is non-zero on any invariant failure or any drift.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASELINE = join(HERE, 'golden_config.json');

const load = (p) => JSON.parse(readFileSync(p, 'utf8'));

// ---- invariants -------------------------------------------------------------

function checkInvariants(cfg) {
  const fails = [];
  const fail = (m) => fails.push(m);

  const units = cfg.business_units || [];
  const rules = cfg.doa_rules || [];
  const catalog = cfg.vendor_catalog || [];

  const codes = new Set(units.map((u) => u.code));

  // business_units: unique codes, required fields
  const seen = new Set();
  for (const u of units) {
    if (!u.code || !u.name) fail(`business_units row missing code/name: ${JSON.stringify(u)}`);
    if (seen.has(u.code)) fail(`business_units duplicate code ${u.code}`);
    seen.add(u.code);
  }

  // doa_rules: referential integrity + per-row sanity
  for (const r of rules) {
    if (!codes.has(r.business_unit)) fail(`doa_rules references unknown BU ${r.business_unit} (not in business_units)`);
    if (!['single', 'dual'].includes(r.approval_mode)) fail(`doa_rules ${r.business_unit} ${r.threshold_min}-${r.threshold_max}: approval_mode "${r.approval_mode}" not single|dual`);
    if (!r.approver_primary || !r.approver_fallback) fail(`doa_rules ${r.business_unit} ${r.threshold_min}-${r.threshold_max}: missing approver_primary/fallback`);
    if (!(r.escalation_hours > 0)) fail(`doa_rules ${r.business_unit} ${r.threshold_min}-${r.threshold_max}: escalation_hours must be > 0`);
    if (!(r.max_lead_time_days > 0)) fail(`doa_rules ${r.business_unit} ${r.threshold_min}-${r.threshold_max}: max_lead_time_days must be > 0`);
    if (!(r.threshold_min < r.threshold_max)) fail(`doa_rules ${r.business_unit} band ${r.threshold_min}-${r.threshold_max}: min must be < max`);
    if (r.auto_approve_under < 0 || r.auto_approve_under > r.threshold_max) fail(`doa_rules ${r.business_unit} band ${r.threshold_min}-${r.threshold_max}: auto_approve_under ${r.auto_approve_under} outside band`);
  }

  // threshold ladder per (BU, category): starts at 0, contiguous, no overlap/gap
  const byBand = {};
  for (const r of rules) (byBand[`${r.business_unit}|${r.category}`] ||= []).push(r);
  for (const [key, band] of Object.entries(byBand)) {
    band.sort((a, b) => a.threshold_min - b.threshold_min);
    if (band[0].threshold_min !== 0) fail(`ladder ${key}: first band starts at ${band[0].threshold_min}, not 0 (a configured BU must cover from 0)`);
    for (let i = 1; i < band.length; i++) {
      const prev = band[i - 1], cur = band[i];
      if (cur.threshold_min > prev.threshold_max) fail(`ladder ${key}: GAP between ${prev.threshold_max} and ${cur.threshold_min}`);
      if (cur.threshold_min < prev.threshold_max) fail(`ladder ${key}: OVERLAP, band [${cur.threshold_min},${cur.threshold_max}) starts before ${prev.threshold_max}`);
    }
  }

  // vendor_catalog: every ruled category is sourceable; rows well-formed
  const ruledCategories = new Set(rules.map((r) => r.category));
  const catCategories = new Set(catalog.map((c) => c.category));
  for (const cat of ruledCategories) if (!catCategories.has(cat)) fail(`vendor_catalog has no entries for category "${cat}" (doa_rules route it, nothing prices it)`);
  for (const c of catalog) {
    if (!c.sku || !c.vendor_id) fail(`vendor_catalog row missing sku/vendor_id: ${JSON.stringify(c)}`);
    if (!(c.unit_price > 0)) fail(`vendor_catalog ${c.sku}/${c.vendor_id}: unit_price must be > 0`);
  }

  // informational: registered-but-unconfigured BUs (default-deny by design, not a failure)
  const configured = new Set(rules.map((r) => r.business_unit));
  const empties = units.filter((u) => u.active && !configured.has(u.code)).map((u) => u.code);

  return { fails, empties };
}

// ---- drift ------------------------------------------------------------------

const KEY = {
  business_units: (r) => r.code,
  doa_rules: (r) => `${r.business_unit}|${r.category}|${r.threshold_min}|${r.threshold_max}`,
  vendor_catalog: (r) => `${r.sku}|${r.vendor_id}`,
};

const canon = (r) => JSON.stringify(Object.fromEntries(Object.entries(r).sort()));

function diffTable(name, base, cur) {
  const keyOf = KEY[name];
  const b = new Map((base || []).map((r) => [keyOf(r), r]));
  const c = new Map((cur || []).map((r) => [keyOf(r), r]));
  const changes = [];
  for (const [k, r] of b) {
    if (!c.has(k)) changes.push({ kind: 'removed', table: name, key: k });
    else if (canon(r) !== canon(c.get(k))) changes.push({ kind: 'changed', table: name, key: k });
  }
  for (const k of c.keys()) if (!b.has(k)) changes.push({ kind: 'added', table: name, key: k });
  return changes;
}

function diffConfig(base, cur) {
  return Object.keys(KEY).flatMap((t) => diffTable(t, base[t], cur[t]));
}

// ---- run --------------------------------------------------------------------

const currentPath = process.argv[2] || BASELINE;
const isSelf = currentPath === BASELINE;
const baseline = load(BASELINE);
const current = load(currentPath);

console.log(`=== Config invariants (${isSelf ? 'golden_config.json' : currentPath}) ===`);
const { fails, empties } = checkInvariants(current);
if (fails.length === 0) console.log('PASS  all invariants hold');
else fails.forEach((f) => console.log(`FAIL  ${f}`));
if (empties.length) console.log(`info  registered-but-unconfigured BUs (default-deny by design): ${empties.join(', ')}`);

let drift = [];
if (!isSelf) {
  console.log(`\n=== Config drift vs approved snapshot (golden_config.json) ===`);
  drift = diffConfig(baseline, current);
  if (drift.length === 0) console.log('PASS  live config matches the approved snapshot');
  else {
    const mark = { added: '+', removed: '-', changed: '~' };
    drift.forEach((d) => console.log(`DRIFT ${mark[d.kind]} ${d.table}: ${d.kind} ${d.key}`));
  }
}

const failed = fails.length + drift.length;
console.log(`\n${fails.length} invariant failure(s), ${drift.length} drift row(s)`);
process.exit(failed === 0 ? 0 : 1);
