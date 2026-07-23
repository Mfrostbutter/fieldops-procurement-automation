# Golden set

A deterministic regression suite for the procurement workflow. Known inputs,
known-correct outcomes. Run it after any change to the workflow or the config
tables to confirm nothing silently broke.

This is the artifact the whole submission argues for: the workflow has no LLM,
so its correctness is a **test suite**, not a model evaluation. "Green" on the
canvas means every node ran without throwing. The golden set measures the thing
green is supposed to mean, that each request routed to the right place for the
right amount.

## What it does

`run_golden.mjs` pulls the four decision Code nodes' **actual source** from
`../workflows/fieldops-procure-to-approve.prod.json` (Normalize, Load BU Policy, Best Price, Threshold
Eval), replays them against the config snapshot in `golden_config.json`, and
asserts each case in `golden_cases.json`. Because it runs the workflow's own
code, the suite cannot drift from what is deployed: change the node logic and the
golden set re-runs the new logic.

The two Data Table lookups are the only things reproduced (as plain filters),
since they are node config, not code.

## Run it

```
node run_golden.mjs
```

Exit code 0 = all pass, 1 = a case failed (with a per-field diff). No network,
no n8n instance, no waiting on approvals: it tests the deterministic decision
path (intake to route), which is everything that happens before a human is asked.

## The 19 cases

Coverage across every route and every default-deny reason:

- the rework re-score: the same SKU that needs single approval at qty 30 auto-approves
  at qty 15, proving a revised request is re-priced and re-routed, not re-stamped
- auto-approve under the floor (BU-01 and BU-03, different floors)
- single and dual approver bands
- lead-time-aware selection: the same SKU picks a different vendor for BU-01
  (30-day tolerance) than BU-03 (20-day), and BU-03 can pay a **premium** or a
  **negative saving** to hit its deadline
- default-deny on: no rule row (BU-04), lead-time breach (only source too slow),
  amount outside every band
- no catalog match to sourcing (RFQ)
- maverick flag when the requester names a vendor that is not the best source
- the quantity guard: `0` and `"two boxes"` both **throw** rather than defaulting
  to 1 (the silent-wrong-order bug the guard exists to stop)

## Config integrity: does green mean the config is intact?

The golden cases prove the decision **logic** is correct against a known config.
They do not, on their own, prove the **live config** is intact: a case only
catches a deleted or changed table row if that row would change a decision the
case checks. Delete a row no case exercises, and the cases stay green. Coverage
is exactly as good as the case set.

`check_config.mjs` closes that gap with two checks that do not depend on case
coverage:

- **Invariants** - structural rules the tables must always hold: the threshold
  ladder starts at 0 with no gaps or overlaps, every `doa_rules` row references a
  real BU, approvers and escalation windows are present, every routed category is
  sourceable in the catalog.
- **Drift** - a row-level diff of a supplied config against the approved
  `golden_config.json` snapshot, failing on ANY added, removed, or changed row.

```
# structural invariants on the approved snapshot
node check_config.mjs

# invariants on the LIVE config + drift vs the snapshot
node pull_live_config.mjs > live.json      # exports the 3 tables in snapshot shape
node check_config.mjs live.json
```

`pull_live_config.mjs` reads the tables from the instance (`N8N_URL`, `N8N_EMAIL`,
`N8N_PASSWORD`; discovers the tables by name) and prints them in the
`golden_config.json` shape. Point `check_config.mjs` at that file and a deleted
row shows up two ways at once: the invariant that row was holding up fails, and
the drift diff names the exact missing row. Exit 0 = clean, 1 = any invariant
failure or any drift.

So the golden cases answer "is the logic right"; `check_config.mjs` answers "is
the live config the one we approved." You want both.

## Refresh the config snapshot

`golden_config.json` is a point-in-time copy of the `doa_rules`,
`vendor_catalog`, and `business_units` tables. If those tables change, refresh
it and re-lock the expectations:

```
# 1. re-dump the tables from the instance into golden_config.json
# 2. regenerate expectations from the current logic + config:
node run_golden.mjs --generate > golden_cases.new && mv golden_cases.new golden_cases.json
# 3. review the diff by hand before committing (this is the known-correct step)
```

Step 3 matters: regenerating locks whatever the code currently produces, so a
human has to confirm the new expected values are actually right. That review is
what keeps the suite honest rather than tautological.
