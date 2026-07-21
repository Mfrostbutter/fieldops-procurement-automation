# FieldOps Procurement Automation

Automated procurement approval for FieldOps Co., built in n8n. One workflow shape
serves every business unit; the units differ in their config rows, not their logic.

This repository is the single source of truth for the system: the workflows
themselves, the documentation to operate and change them, and the evaluation suite
that proves a change is safe before it ships. Everything you would need to run it,
fix it, change it, or replicate it is here.

## Start here

| I want to | Go to |
|---|---|
| Understand the system | [WORKFLOW-ARCHITECTURE.md](WORKFLOW-ARCHITECTURE.md) - the three workflows, how they relate, the roadmap |
| See the workflows | [WORKFLOW-BREAKDOWN.md](WORKFLOW-BREAKDOWN.md) - each workflow on the canvas, with what it does |
| Operate or change a node | [docs/WORKFLOW-REFERENCE.md](docs/WORKFLOW-REFERENCE.md) - every node, what it does, what to change. Rendered: https://your-runbook.example |
| Stand it up myself | [SETUP.md](SETUP.md) - import the workflows, seed the tables, set the secrets |
| Prove a change is safe | [golden/](golden/) - the regression suite |

## What's here

```
WORKFLOW-ARCHITECTURE.md   the system: three workflows, how they relate, roadmap
WORKFLOW-BREAKDOWN.md      each workflow on the canvas, with what it does
SETUP.md                   stand it up in your own n8n
docs/
  WORKFLOW-REFERENCE.md    node-by-node operator runbook
  assets/workflow-board.png
screenshots/               canvas screenshots for the breakdown
workflows/
  fieldops-procure-to-approve.prod.json   production (the live workflow)
  fieldops-procure-to-approve.dev.json    DEV copy for testing changes
  fieldops-regression-runner.json         the evaluation harness
  fieldops-revision-loop.json             reject -> revise -> re-approve loop
golden/
  run_golden.mjs           the regression runner
  golden_cases.json        19 known requests, known-correct outcomes
  golden_config.json       point-in-time snapshot of the config tables
  README.md
```

## The system in one line

`Intake -> Policy -> Price -> Route -> Approve -> Record`, over four config tables,
with a dev/prod split and an evaluation harness so a change is proven before it
reaches production.

## Quickstart: verify correctness without n8n

```
node golden/run_golden.mjs
```

```
19 passed, 0 failed, 19 total
```

The suite runs the production workflow's own decision code against a config
snapshot, so it cannot drift from what is deployed. It is the concrete answer to
"how do you know green means correct."

## Working together

This repo is the shared surface for the engagement and after it. Changes are made
here, reviewed here, and proven with the golden set before they reach production,
whether that is the FieldOps team, a support engineer, or both.
