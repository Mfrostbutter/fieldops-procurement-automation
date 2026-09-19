# Attribution

## Built on n8n

This project is a set of [n8n](https://n8n.io) workflows plus the documentation and
tests to run and change them. n8n is a fair-code licensed workflow automation
platform. The workflows use only built-in nodes (no community nodes), so they run
on n8n Cloud or a self-hosted instance without modification.

## Sample data is synthetic

"FieldOps Co.", its business units, vendors, SKUs, approvers, and every price and
threshold in `golden/golden_config.json` and the seed data are invented for this
example. They model realistic manufacturing-procurement shapes but do not represent
any real company, supplier, or person.

## What is original here

- The config-over-canvas design: one workflow shape driven by editable Data Tables,
  so onboarding a business unit or moving a threshold is a row edit, not a workflow
  edit.
- The golden set (`golden/`): a deterministic regression suite that replays the
  workflow's own decision code against a config snapshot, so it cannot drift from
  what is deployed, plus a config-integrity gate (invariants + drift diff).

## License

Released under the MIT License. See [LICENSE](LICENSE).
