# Setup

How to stand this system up in your own n8n, seed the config, and wire the secrets.
Nothing here needs a code change; the whole system is config over canvas.

## Prerequisites

- n8n, version 2.x (self-hosted or cloud).
- Node 18+ (to run the golden set locally).
- A Slack workspace with incoming webhooks for five channels (or any other messaging provider; see the note under "Set the secrets").

## 1. Import the workflows

Import the five JSONs under `workflows/` (n8n → Workflows → Import from File):

- `fieldops-procure-to-approve.prod.json` - production, the live workflow.
- `fieldops-procure-to-approve.dev.json` - DEV, the copy you edit and test.
- `fieldops-regression-runner.json` - the evaluation harness.
- `fieldops-revision-loop.json` - the reject, revise, re-approve loop.
- `fieldops-global-error-poller.json` - watches every workflow and alerts on failure.

The DEV workflow uses its own form path so it can run alongside production. The
Runner calls DEV by workflow id; after import, open the Runner's **Run DEV logic**
node and reselect the imported DEV workflow.

The Revision Loop exposes two webhooks (`fde-reject-form`, `fde-revision-notify`); the
production flow's approval card links its **Reject** button to the first, and fires the
second after it writes the `REJECTED` row. Both are wired by path, so importing and
activating is enough. The pre-filled revision link and the reject/notify URLs use the
instance host in `your-n8n.example`; point them at your own base URL.

The Global Error Poller reads the n8n API to find failed runs, so it needs the n8n
**public API enabled** and an API key. Create a key (Settings → n8n API) and expose it to
the workflow as `FDE_N8N_API`. The poller self-calls `http://localhost:5678/api/v1`, so it
runs against the same instance it monitors. On first activation it seeds silently and posts
nothing; from then on it alerts only on new failures.

## 2. Create the config tables

The workflow reads four n8n Data Tables. Create them with these columns and seed
the first three (a working snapshot is in `golden/golden_config.json`, which
doubles as the column reference and starting data):

- **doa_rules** - the routing engine. One row per threshold band:
  `business_unit, category, threshold_min, threshold_max, approver_primary,
  approver_fallback, approval_mode, escalation_hours, auto_approve_under,
  max_lead_time_days, cost_center`
- **vendor_catalog** - approved suppliers, one row per SKU per vendor:
  `sku, description, category, vendor_id, vendor_name, unit_price, currency, uom,
  lead_time_days, asl_flag, contract_flag`
- **business_units** - the unit registry: `code, name, active`
- **pr_events** - the audit log. Create it empty; the workflow writes one row per
  request at its terminal state:
  `request_id, event, detail, actor, ts, submitted_at, decided_at, cycle_seconds,
  revision_of, revision_count`.
  The timestamp columns make cycle time and stall rate a direct query; the two
  revision columns make rework rate and end-to-end case cycle time queries too.

Bands must not overlap: the evaluator asserts exactly one band claims an amount and
default-denies if more than one does. A unit with no `doa_rules` rows is safe;
every request from it default-denies to a human until somebody writes its policy.

## 3. Set the secrets

Five Slack incoming-webhook URLs, referenced as environment variables so they never
live in the workflow. An export of these workflows leaks nothing.

| Variable | Channel |
|---|---|
| `REQUESTS_SLACK_WEBHOOK` | #requests, raised and priced |
| `APPROVALS_SLACK_WEBHOOK` | #approvals, needs a human |
| `ORDERS_SLACK_WEBHOOK` | #orders, decided |
| `REGRESSION_SLACK_WEBHOOK` | #regression, evaluation results (DEV runner) |
| `ERRORS_SLACK_WEBHOOK` | #errors, a workflow failed (error poller) |

Two more, both for the error poller:

| Variable | What |
|---|---|
| `FDE_N8N_API` | n8n API key the poller uses to read failed executions |
| `ERROR_NOTIFY_EMAIL` | recipient for the error email (only used once the email node is enabled) |

Inject them into the n8n container from your secret store at runtime. Rotating a
channel is a secret change and a restart, not a workflow edit.

**Messaging provider is a swap, not a dependency.** Slack is used here because it was on
hand. Every notification, including the error alert, is a single send node at the end of
its path, so pointing them at Teams, Google Chat, WhatsApp, or any provider the customer
runs is a node swap, not a rebuild.

## 3b. Enable email notifications (optional)

The workflows carry an email layer that **ships disabled**: five `emailSend` nodes in the
production flow (request received, awaiting approval, auto-approval, order approved, and a
parse bounce-back), two in the Revision Loop (revision requested, final rejection), and one
in the Error Poller (the failure alert, sent to `ERROR_NOTIFY_EMAIL`). To turn it on: create
an SMTP credential for your mail server, assign it to those nodes, and enable them. Each node
continues on error, so an unreachable mail server never breaks a run. Until you do this,
Slack is the notification channel.

## 4. Verify

```
node golden/run_golden.mjs
```

`19 passed` means the imported logic produces the known-correct outcomes. Then open
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
