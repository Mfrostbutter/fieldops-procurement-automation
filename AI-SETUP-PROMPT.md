# AI setup prompt

Paste the block below into your AI assistant (Claude, ChatGPT, or the assistant
built into your editor) with this repository open or attached. It gives the
assistant enough context to help you stand the system up, operate it, and extend it
safely. For a full plain-text export of the documentation to feed an assistant in
one shot, concatenate `WORKFLOW-ARCHITECTURE.md`, `WORKFLOW-BREAKDOWN.md`,
`SETUP.md`, and `docs/WORKFLOW-REFERENCE.md`.

---

You are helping me operate and extend an n8n-based procurement approval system in
this repository. Read these files before answering: `README.md`,
`WORKFLOW-ARCHITECTURE.md`, `WORKFLOW-BREAKDOWN.md`, `SETUP.md`, and
`docs/WORKFLOW-REFERENCE.md` (the node-by-node runbook and change cookbook).

Hold these principles, which the whole design rests on:

- **Config over canvas.** One workflow shape serves every business unit. Everything
  that changes between units lives in four n8n Data Tables (`doa_rules`,
  `vendor_catalog`, `business_units`, `pr_events`), not in the node graph. When I ask
  to change routing, thresholds, approvers, vendors, or lead times, the answer is
  almost always a table-row edit, and you point me to the exact table and column via
  the "Change cookbook" in `docs/WORKFLOW-REFERENCE.md`. Do not tell me to edit a
  Code node unless the runbook says that is the right place.
- **Two things are derived, never asserted.** The amount is computed from the vendor
  catalog (a requester never types a price); the route is computed from the policy
  table. A missing or ambiguous rule default-denies to a human and never
  auto-approves. Preserve both properties in any change you propose.
- **Prove a change before it ships.** After any edit to the workflow or the config,
  run `node golden/run_golden.mjs` (decision correctness) and, against a live
  instance, `node golden/check_config.mjs` (config invariants + drift). A change is
  not done until the golden set is green. If a change should alter an outcome, update
  `golden/golden_cases.json` deliberately and review the diff by hand.
- **No LLM on the decision path.** Routing is deterministic on purpose, so it is
  auditable and repeatable. Do not add a model to the pricing or routing logic.

Common tasks you can help me with, and where each is done:

- **Stand it up:** follow `SETUP.md` — import the workflows in `workflows/`, create
  the four Data Tables, seed the first three from `golden/golden_config.json`, set the
  Slack webhook and n8n-API secrets as environment variables, and verify with the
  golden set.
- **Onboard a business unit:** add a `business_units` row and its `doa_rules` bands
  (one per threshold band), then run the golden set for that unit.
- **Move a threshold / change an approver / reprice a vendor:** edit the relevant
  `doa_rules` or `vendor_catalog` row per the cookbook, then re-run the golden set.
- **Point it at your own instance:** the workflows carry placeholder hosts
  (`your-n8n.example`, `your-runbook.example`) and a placeholder project id
  (`YOUR_PROJECT_ID`) in email bodies and links. Replace them with your instance's
  base URL. Slack channels come from environment-variable webhooks, so rotating a
  channel is a secret change, not a workflow edit.
- **Swap the messaging provider:** every notification is a single send node at the end
  of its path; point it at Teams, Google Chat, WhatsApp, or another provider without
  rebuilding the flow.

When you are unsure where something lives, prefer `docs/WORKFLOW-REFERENCE.md` over
guessing, and keep changes to the tables rather than the canvas wherever the runbook
allows it.
