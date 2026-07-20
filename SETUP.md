# Setup

How to stand this system up in your own n8n, seed the config, and wire the secrets.
Nothing here needs a code change; the whole system is config over canvas.

## Prerequisites

- n8n, version 2.x (self-hosted or cloud).
- Node 18+ (to run the golden set locally).
- A Slack workspace with incoming webhooks for four channels.

## 1. Import the workflows

Import the three JSONs under `workflows/` (n8n → Workflows → Import from File):

- `fieldops-procure-to-approve.prod.json` — production, the live workflow.
- `fieldops-procure-to-approve.dev.json` — DEV, the copy you edit and test.
- `fieldops-regression-runner.json` — the evaluation harness.

The DEV workflow uses its own form path so it can run alongside production. The
Runner calls DEV by workflow id; after import, open the Runner's **Run DEV logic**
node and reselect the imported DEV workflow.

## 2. Create the config tables

The workflow reads four n8n Data Tables. Create them with these columns and seed
the first three (a working snapshot is in `golden/golden_config.json`, which
doubles as the column reference and starting data):

- **doa_rules** — the routing engine. One row per threshold band:
  `business_unit, category, threshold_min, threshold_max, approver_primary,
  approver_fallback, approval_mode, escalation_hours, auto_approve_under,
  max_lead_time_days, cost_center`
- **vendor_catalog** — approved suppliers, one row per SKU per vendor:
  `sku, description, category, vendor_id, vendor_name, unit_price, currency, uom,
  lead_time_days, asl_flag, contract_flag`
- **business_units** — the unit registry: `code, name, active`
- **pr_events** — the audit log. Create it empty; the workflow writes one row per
  transition.

Bands must not overlap: the evaluator asserts exactly one band claims an amount and
default-denies if more than one does. A unit with no `doa_rules` rows is safe;
every request from it default-denies to a human until somebody writes its policy.

## 3. Set the secrets

Four Slack incoming-webhook URLs, referenced as environment variables so they never
live in the workflow. An export of these workflows leaks nothing.

| Variable | Channel |
|---|---|
| `REQUESTS_SLACK_WEBHOOK` | #requests, raised and priced |
| `APPROVALS_SLACK_WEBHOOK` | #approvals, needs a human |
| `ORDERS_SLACK_WEBHOOK` | #orders, decided |
| `REGRESSION_SLACK_WEBHOOK` | #regression, evaluation results (DEV runner) |

Inject them into the n8n container from your secret store at runtime. Rotating a
channel is a secret change and a restart, not a workflow edit.

## 4. Verify

```
node golden/run_golden.mjs
```

`18 passed` means the imported logic produces the known-correct outcomes. Then open
the **Regression Test Runner** form, pick a business unit, and confirm green
in-platform. Green there means every request still routes to the right place for the
right amount.

## Changing anything

The rule is: change the tables, not the canvas. For the specific edit-to-place
mapping (onboard a unit, move a threshold, reprice a vendor, add a case), see
[docs/WORKFLOW-REFERENCE.md](docs/WORKFLOW-REFERENCE.md) → "Change cookbook" and
"Configure the evaluations".

## The workflow to promote a change

1. Edit **DEV**.
2. Run the **Regression Test Runner** for the affected business unit (or ALL).
3. Green means every request still routes correctly. Red prints a per-field diff.
4. Promote DEV to production.
