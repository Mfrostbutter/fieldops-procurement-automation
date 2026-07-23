# Procurement Approval Workflow, Node Reference and Operator Runbook

FieldOps Co. procurement pilot. This is the maintainer's companion to the n8n
workflow: every node, what it does, and what you would change to make it yours.
It pairs with the [architecture whiteboard](https://www.figma.com/board/workflow-board)
(the six-zone flow) and the design notes in `ARCHITECTURE.md`.

## How to use this document

This runbook is meant to be clicked, not just read. Wherever you see a small
<code class="pill">blue pill</code>, it is a link, and every link opens in a new tab so you never lose
your place:

- The blue pill after a node's name (the one labeled with its node type, like
  <code class="pill">code</code> or <code class="pill">if</code>) opens that node's official n8n documentation.
- The blue pill on a table name, under **Config tables** below, opens the live
  Data Table inside n8n, where the real rows live.
- A table name mentioned in the running text links to that table's definition
  here in the runbook.

Feeding this to an LLM? A plain-text copy of the whole documentation set is at
[llms-full.txt](llms-full.txt), with a short index at [llms.txt](llms.txt).

## First Principle: Config over Canvas

The volatile parts of this workflow, the thresholds, the approvers, the vendor
prices, the lead-time tolerances, live in **editable Data Tables**, not in the
node graph. One workflow serves every business unit; the business units differ
by rows, not by nodes. When this runbook says "what to change," the answer is
almost always a table row, not a code node. That is deliberate: your platform
team should own the policy without touching the automation.

Two things are derived, never asserted:

- **The amount** is computed from the vendor catalogs. A requester never types a
  price. Approving a typed-in figure is a green execution that means nothing.
- **The route** is computed from the policy table. A missing or ambiguous rule
  **default-denies to a human**; it never silently auto-approves.

## Execution flow

```
                 +-- Web form ---------+
  INTAKE         |                     v
                 +-- Email --> Parse --> Normalize Request
                                             |
  POLICY                        DoA Rule Lookup --> Load BU Policy
                                             |
  PRICE          Vendor Catalog Lookup --> Best Price + Maverick --> Catalog Match?
                                             |                    |         |
                                             |             (no match)   Notify #requests
                                             v                    v
  ROUTE          Threshold Eval + Self-Check --> Route Decision
                                             |         |
                                    (auto) Auto-Approved|  (single / dual / default-deny)
  APPROVE                                    |     Build Approval Card --> Post #approvals
                                             |          --> Wait --> Apply Decision
                                             v                    |
  RECORD                              Build Outcome <-------------+
                                       |        |
                                Post #orders   Build Event Row --> Write Event Row (pr_events)
```

---

## Config tables (change these, not the canvas)

Four Data Tables carry everything a platform team tunes. IDs are the live pilot
values.

### [`doa_rules`](https://your-n8n.example/projects/YOUR_PROJECT_ID/datatables/67HHfBJm7BXwEp8s), the policy master

One row per business unit, category, and spend band. This single table decides
routing, approvers, cost center, lead-time tolerance, escalation, and the
auto-approve floor. A business unit with **no rows here default-denies by
design** (BU-04 demonstrates this in the pilot: a registered unit with no policy rows, so every request from it routes to a human).

| Column | Meaning | Change it to |
|---|---|---|
| `business_unit` | BU code the band applies to | scope a band to a BU |
| `category` | spend category (pilot: `MRO`) | scope a band to a category |
| `threshold_min` / `threshold_max` | band lower (inclusive) and upper (exclusive) in EUR | move where a band starts or ends |
| `approval_mode` | `single` or `dual` | require two approvers on a band |
| `auto_approve_under` | auto-approve floor in EUR; `0` disables | let small spend skip a human |
| `approver_primary` | who the card routes to | change the approver |
| `approver_fallback` | who a timeout escalates to | change the escalation target |
| `cost_center` | default cost center for the BU | correct the GL coding |
| `max_lead_time_days` | slowest delivery this BU tolerates | tighten or relax sourcing speed |
| `escalation_hours` | hours before a no-decision escalates | change the SLA clock |

Seeded pilot rows:

| business_unit | category | min | max | mode | auto_under | primary | fallback | cost_center | max_lead | esc_h |
|---|---|---|---|---|---|---|---|---|---|---|
| BU-01 | MRO | 0 | 5000 | single | 1000 | cost.owner | plant.controller | CC-4400 | 30 | 24 |
| BU-01 | MRO | 5000 | 25000 | single | 0 | production.manager | plant.controller | CC-4400 | 30 | 24 |
| BU-01 | MRO | 25000 | 100000 | dual | 0 | plant.manager | bu.controller | CC-4400 | 30 | 48 |
| BU-03 | MRO | 0 | 5000 | single | 750 | hub.supervisor | ops.controller | CC-6100 | 20 | 12 |
| BU-03 | MRO | 5000 | 25000 | single | 0 | hub.manager | ops.controller | CC-6100 | 20 | 12 |
| BU-03 | MRO | 25000 | 100000 | dual | 0 | regional.director | bu.controller | CC-6100 | 20 | 24 |

(Approver values shown short; live rows carry full `@fieldops.example` addresses. **BU-04 has no rows and default-denies.**)

### [`business_units`](https://your-n8n.example/projects/YOUR_PROJECT_ID/datatables/oC6Oj6bBq4SWtdGG), the BU registry

| Column | Meaning |
|---|---|
| `code` | BU code (`BU-01`) |
| `name` | display name (`Rheinfeld Plant`) |
| `active` | in service |

The thin registry of valid business units and their names. Policy does **not**
live here; it lives in [`doa_rules`](https://your-runbook.example/#doa_rules-the-policy-master). Pilot rows: BU-01 Rheinfeld Plant, BU-02
Ostwerk Assembly, BU-03 Nordhafen Logistics, BU-04 Westhafen Distribution.

### [`vendor_catalog`](https://your-n8n.example/projects/YOUR_PROJECT_ID/datatables/w8I8nRcAngNcFXqr), the approved supplier list

One row per SKU per vendor. Pricing reads this; the requester never does.

| Column | Meaning |
|---|---|
| `sku` / `description` / `category` | the item |
| `vendor_id` / `vendor_name` | the supplier (`VEND-A` is the incumbent) |
| `unit_price` / `currency` / `uom` | the contracted or spot price |
| `contract_flag` | `contract` or `spot` |
| `lead_time_days` | delivery time; drives lead-time-aware selection |
| `asl_flag` | on the approved supplier list |

Sample (same SKU, three vendors, different price and lead time):

| sku | vendor | unit_price | contract | lead_time_days |
|---|---|---|---|---|
| MRO-1001 | Rheinwerk (VEND-A) | 18.50 | contract | 3 |
| MRO-1001 | Nordmann (VEND-B) | 14.20 | contract | 5 |
| MRO-1001 | Kessler (VEND-C) | 16.90 | spot | 2 |
| MRO-1014 | Rheinwerk (VEND-A) | 3180.00 | contract | 35 |

That last row is the lead-time case: a BU that tolerates only 20 days cannot take
the single 35-day source, so the request breaches tolerance and default-denies to
a human instead of ordering something that arrives too late.

### [`pr_events`](https://your-n8n.example/projects/YOUR_PROJECT_ID/datatables/WAfXQqVAdlo8Bruh), the audit log

| Column | Meaning |
|---|---|
| `request_id` | the requisition |
| `event` | the terminal state it reached |
| `detail` | JSON snapshot (route, amount, vendor, saving, flags) |
| `actor` | who caused it |
| `ts` | when the row was written |
| `submitted_at` | intake timestamp (`created_at` from Normalize Request) |
| `decided_at` | decision timestamp (human decision, or record time for auto-decided states) |
| `cycle_seconds` | elapsed submission-to-decision, in seconds (0 for instant auto-approvals) |
| `revision_of` | chain root: the original request id when this is a revision, else null |
| `revision_count` | which attempt this is (0 for a first submission) |

One row per request at its terminal state, plus the `REVISION_REQUESTED` and
`REJECTED_FINAL` events the [revision loop](#zone-revision-loop) writes. This is
the instrument the 90-day review and rule-drift detection read from. Because
`submitted_at`, `decided_at` and `cycle_seconds` are stored on the row, median
and p90 cycle time and stall rate (share of requests over a threshold) are a
query against this table, not a reconstruction. Because `revision_of` links every
pass to its chain root, rework rate and end-to-end case cycle time are queries
too. In production you would also branch this to a database or warehouse.

---

## Email request template

The email channel is deterministic: the template **is** the contract. A field
outside the schema is ignored; a missing required field bounces back with a form
link. Keep the block at the top of the message; anything below a signature or a
quoted reply is cut before parsing.

**Copy-paste template**

```
Business Unit: BU-01
SKU: MRO-1001
Item Description: Deep groove ball bearing 6204-2RS
Quantity: 10
Category: MRO
Cost Center: CC-4400
Preferred Vendor:
Justification: Line 3 conveyor bearing, scheduled PM
```

**Filled example**

```
Subject: Procurement Request: MRO-1002 x24

Business Unit: BU-03
SKU: MRO-1002
Item Description: Nitrile gloves, box of 100
Quantity: 24
Category: MRO
Cost Center: CC-6100
Preferred Vendor: VEND-C
Justification: PPE restock, Nordhafen line
```

**Field reference**

| Label (canonical) | Required | Schema field | Allowed values | Notes |
|---|---|---|---|---|
| Business Unit | yes | `business_unit` | BU-01, BU-02, BU-03, BU-04 | must have [`doa_rules`](https://your-runbook.example/#doa_rules-the-policy-master) rows or it default-denies |
| SKU | yes | `sku` | any [`vendor_catalog`](https://your-runbook.example/#vendor_catalog-the-approved-supplier-list) SKU | unknown SKU routes to sourcing |
| Quantity | yes | `quantity` | positive number | `two boxes` or `0` bounces, never defaults |
| Item Description | no | `item_description` | free text | display only |
| Category | no (defaults MRO) | `category` | MRO | pilot scope |
| Cost Center | no | `cost_center` | e.g. CC-4400 | falls back to the BU default |
| Preferred Vendor | no | `preferred_vendor` | VEND-A/B/C | if not the best source, flagged as maverick, not honored |
| Justification | no | `justification` | free text | carried to the audit row |

The sender address becomes `requester_email` automatically. Accepted label
synonyms (so real mail parses): `BU`, `Part Number` / `Material` / `Item Number`
for SKU, `Qty`, `Cost Centre` / `CC`, `Vendor` / `Supplier`, `Reason` / `Notes`.
Add more in the `ALIASES` map of the `Parse Request Email` node.



## Node reference

Nodes in execution order, grouped by zone.

---

## Zone: INTAKE

**Two entry points, one pipeline.**

IN: a form submission or an email.
OUT: one normalized request object with a `request_id`.
READS: [`business_units`](https://your-runbook.example/#business_units-the-bu-registry) (form dropdown).
ON FAILURE: an invalid quantity THROWS. It does not default to 1. A defaulted value is a silent wrong order that reaches a PO.

### 1. Procurement Request Form  [`formTrigger`](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.formtrigger/)

Company web form. Raises a requisition. Fields map one-to-one to the normalized schema.

**What to change:** Add a business unit or category as a dropdown option here, then add the matching [`doa_rules`](https://your-runbook.example/#doa_rules-the-policy-master) rows (cookbook below). The form is the only place the BU list is typed; everything downstream reads the value.

```json
{
  "formTitle": "FieldOps Procurement Request"
}
```

### 2. Procurement Mailbox (IMAP)  [`emailReadImap`](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.emailimap)

Polls a procurement mailbox. Disabled, pending an IMAP credential. Both channels converge on `Normalize Request`, so downstream nodes see one shape regardless of channel.

**What to change:** Attach an IMAP credential and activate the node. The parser already emits the normalized schema. See the email template section for the shape it expects.

### 3. Parse Request Email  [`code`](https://docs.n8n.io/build/code-in-n8n/using-the-code-node)

Deterministic regex parse of a templated request email into the normalized schema. No LLM. Strips quoted reply history so a forwarded thread cannot carry stale values. Accepts common label variants. Does not infer missing fields.

**What to change:** Label aliases live in the `ALIASES` map. Add a synonym your requesters type (for example another word for `cost_center`) as a new array entry. Canonical labels are in the email template section.

```js
// Deterministic regex parse of a templated procurement email. No LLM.

const m = $input.first().json;

const subject = String(m.subject || '');
const from = String(m.from || m.fromEmail || '');
let body = String(m.text || m.textPlain || m.snippet || '');

// Cut quoted reply history so a forwarded thread can't yield stale values.
const cut = body.search(/^\s*(>|On .+wrote:|-----Original Message-----|_{5,}|From:\s)/m);
if (cut > 0) body = body.slice(0, cut);

// Accept "Key: value" lines, case-insensitive, with common label variants.
const ALIASES = {
  business_unit: ['business unit', 'business_unit', 'bu'],
  sku:           ['sku', 'part number', 'part no', 'material', 'item number'],
  item_description: ['description', 'item', 'item description'],
  quantity:      ['quantity', 'qty'],
  category:      ['category'],
  cost_center:   ['cost center', 'cost centre', 'cost_center', 'cc'],
  preferred_vendor: ['preferred vendor', 'vendor', 'supplier'],
  justification: ['justification', 'reason', 'notes'],
  requester_email: ['requester email', 'requester', 'requested by'],
};

const found = {};
for (const raw of body.split(/\r?\n/)) {
  const mm = raw.match(/^\s*\*?\s*([A-Za-z _\/-]{2,30}?)\s*\*?\s*[:\-]\s*(.+?)\s*$/);
  if (!mm) continue;
  const label = mm[1].trim().toLowerCase();
  const value = mm[2].trim();
  for (const [field, names] of Object.entries(ALIASES)) {
    if (names.includes(label) && !(field in found)) { found[field] = value; break; }
  }
}

// Sender is the requester unless the template overrides.
const senderMatch = from.match(/[\w.+-]+@[\w.-]+\.\w+/);
if (!found.requester_email && senderMatch) found.requester_email = senderMatch[0];

// Parseable only if the fields the pipeline can't invent are present.
const REQUIRED = ['business_unit', 'sku', 'quantity'];
const missing = REQUIRED.filter(f => !found[f] || String(found[f]).trim() === '');
// "two boxes" strips to "" and Number("") is 0: require non-empty and > 0.
const qtyRaw = String(found.quantity || '').replace(/[^\d.]/g, '');
const qtyNum = qtyRaw === '' ? NaN : Number(qtyRaw);
const qtyValid = Number.isFinite(qtyNum) && qtyNum > 0;
if (!missing.includes('quantity') && !qtyValid) missing.push('quantity');

return [{ json: {
  ...found,
  quantity: qtyValid ? qtyNum : null,
  category: found.category || 'MRO',
  intake_channel: 'email',
  parse_ok: missing.length === 0,
  parse_missing: missing,
  source_subject: subject,
  source_from: from,
}}];
```

### 4. Parse OK?  [`if`](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.if/)

Gate. A clean parse goes to `Normalize Request`; a non-conforming one goes to `Bounce Back`. Parseable means the fields the pipeline cannot invent (`business_unit`, `sku`, `quantity`) are present and valid.

**What to change:** Nothing here. Reads `parse_ok`; change the required-field policy in `Parse Request Email`.

### 5. Bounce Back (form link)  [`set`](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.set/)

Replies to a non-conforming email with a form link instead of inferring the missing fields.

**What to change:** Point `form_url` at your form endpoint and wire this to your mail-send node. Currently a stub that carries the bounce reason.

### 6. Normalize Request  [`code`](https://docs.n8n.io/build/code-in-n8n/using-the-code-node)

Every intake channel becomes one requisition object here, so downstream sees one shape. Mints a deterministic `request_id` (content + minute) for dedup. THROWS on an invalid quantity instead of defaulting it.

**What to change:** Nothing for a normal engagement. The defaults (`category` MRO, `cost_center` CC-4400, `business_unit` BU-01) cover a form that omits an optional field; change them only if your form guarantees those fields.

```js
// Normalize every intake channel to one purchase-requisition shape.
const f = $input.first().json;
const now = new Date().toISOString();

const norm = (v) => (v === undefined || v === null ? '' : String(v).trim());

// request_id: deterministic on content + minute, so a same-minute resubmit collides for dedup.
const seed = [norm(f.business_unit), norm(f.sku), norm(f.quantity),
              norm(f.requester_email), now.slice(0, 16)].join('|');
let h = 0;
for (let i = 0; i < seed.length; i++) { h = (h * 31 + seed.charCodeAt(i)) >>> 0; }
const request_id = 'PR-' + now.slice(0, 10).replace(/-/g, '') + '-' + h.toString(36).toUpperCase().padStart(7, '0');

return [{ json: {
  request_id,
  intake_channel: norm(f.intake_channel) || 'form',
  business_unit: norm(f.business_unit) || 'BU-01',
  sku: norm(f.sku).toUpperCase(),
  item_description: norm(f.item_description),
  quantity: (() => {
    // Throw on bad quantity; defaulting to 1 is a silent wrong order.
    const q = Number(f.quantity);
    if (!Number.isFinite(q) || q <= 0) {
      throw new Error('Invalid quantity: ' + JSON.stringify(f.quantity) +
                      ' (request ' + request_id + '). Refusing to default.');
    }
    return q;
  })(),
  category: norm(f.category) || 'MRO',
  cost_center: norm(f.cost_center) || 'CC-4400',
  preferred_vendor: norm(f.preferred_vendor),
  justification: norm(f.justification),
  requester_email: norm(f.requester_email),
  created_at: now,
  state: 'RECEIVED',
}}];
```


---

## Zone: POLICY

IN: normalized request.
OUT: request plus its policy (thresholds, approvers, lead-time tolerance), collapsed to one item.
READS: [`doa_rules`](https://your-runbook.example/#doa_rules-the-policy-master) (the policy master).
LOGIC: load the BU's rule rows, collapse to one item, extract `max_lead_time_days`. Take the strictest tolerance if bands disagree.

### 7. DoA Rule Lookup  [`dataTable`](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.datatable/)

Reads every [`doa_rules`](https://your-runbook.example/#doa_rules-the-policy-master) row for this request's business unit and category. `doa_rules` holds thresholds, approval mode, approvers, cost center, lead-time tolerance, escalation window, and the auto-approve floor.

**What to change:** This is a table read. Change routing behavior in `doa_rules` (cookbook below), not here. The node only supplies the filter.

### 8. Load BU Policy  [`code`](https://docs.n8n.io/build/code-in-n8n/using-the-code-node)

Collapses the business unit's several [`doa_rules`](https://your-runbook.example/#doa_rules-the-policy-master) rows into one item carrying the request plus its policy, and extracts `max_lead_time_days`. One item prevents a fan-out: a Data Table read runs once per input item, so three band rows would produce three duplicate copies of every vendor at the catalog lookup.

**What to change:** Nothing. If a BU's bands disagree on lead-time tolerance, it takes the strictest.

```js
// Collapse the BU's rule rows to ONE item (req + policy) so pricing doesn't fan out.
const req = $('Normalize Request').first().json;
const rules = $input.all().map(i => i.json).filter(r => r && r.business_unit);

// max_lead_time_days is per BU+category; take the strictest if rows disagree.
const leads = rules.map(r => Number(r.max_lead_time_days)).filter(n => Number.isFinite(n) && n > 0);
const maxLead = leads.length ? Math.min(...leads) : null;

return [{ json: { ...req,
  policy_rule_count: rules.length,
  max_lead_time_days: maxLead,
  has_policy: rules.length > 0,
}}];
```


---

## Zone: PRICE

IN: normalized request plus BU policy (`max_lead_time_days`).
OUT: chosen vendor, unit price, derived amount, savings vs incumbent, flags.
READS: [`vendor_catalog`](https://your-runbook.example/#vendor_catalog-the-approved-supplier-list) (approved vendors for the SKU).
LOGIC: drop vendors over `max_lead_time_days`, sort the rest by unit price, pick the cheapest. The amount is derived from the catalog, never typed by the requester.
ON FAILURE: no catalog match routes to sourcing, never auto-approve. No vendor in tolerance forces a human.

### 9. Vendor Catalog Lookup  [`dataTable`](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.datatable/)

Reads every [`vendor_catalog`](https://your-runbook.example/#vendor_catalog-the-approved-supplier-list) row for the requested SKU and category, one row per vendor that lists the item.

**What to change:** A table read. Add or reprice a vendor line in `vendor_catalog`.

### 10. Best Price + Maverick Flag  [`code`](https://docs.n8n.io/build/code-in-n8n/using-the-code-node)

Derives the amount from the catalog, not the requester. Drops vendors over the BU's `max_lead_time_days`, sorts by unit price, picks the cheapest. Computes savings vs the incumbent contract (`VEND-A`). Flags an off-contract (maverick) request. If a cheaper vendor was dropped for being too slow, records the extra cost. If no vendor meets the tolerance, flags a breach and forces a human.

**What to change:** Nothing normally. The incumbent is `VEND-A`; change that one constant if your incumbent is a different vendor id.

```js
// Derive amount from vendor catalogs; pick cheapest source within the BU lead-time tolerance.
const req = $('Normalize Request').first().json;
const qty = Number(req.quantity) || 1;

// BU lead-time tolerance, loaded before pricing.
const policy = $('Load BU Policy').first().json;
const maxLead = Number(policy.max_lead_time_days);
const hasTolerance = Number.isFinite(maxLead) && maxLead > 0;

const rows = $input.all().map(i => i.json).filter(r => r && r.sku && r.vendor_id);

if (rows.length === 0) {
  // No catalog match: route to sourcing, never auto-approve.
  return [{ json: { ...req, catalog_match: false, match_count: 0,
    derived_amount: null, state: 'NEEDS_SOURCING' }}];
}

const priced = rows
  .map(r => ({ ...r, unit_price: Number(r.unit_price), lead_time_days: Number(r.lead_time_days) }))
  .filter(r => Number.isFinite(r.unit_price))
  .sort((a, b) => a.unit_price - b.unit_price);

// Keep only vendors that can deliver within tolerance.
const eligible = hasTolerance
  ? priced.filter(r => Number.isFinite(r.lead_time_days) && r.lead_time_days <= maxLead)
  : priced;

// None in tolerance: take the fastest, flag a breach, force a human.
const breach = hasTolerance && eligible.length === 0;
const pool = breach
  ? [...priced].sort((a, b) => a.lead_time_days - b.lead_time_days)
  : eligible;

const best = pool[0];
const excluded = priced
  .filter(r => !pool.includes(r))
  .map(r => ({ vendor: r.vendor_name, price: r.unit_price, lead_time_days: r.lead_time_days }));

// VEND-A is the incumbent; delta vs it is the contract-leakage number.
const incumbent = priced.find(r => r.vendor_id === 'VEND-A') || null;
const derived_amount = Number((best.unit_price * qty).toFixed(2));
const incumbent_amount = incumbent ? Number((incumbent.unit_price * qty).toFixed(2)) : null;
const savings = incumbent_amount !== null
  ? Number((incumbent_amount - derived_amount).toFixed(2)) : 0;

// Lead-time premium: cost of not taking the cheapest source.
const cheapest = priced[0];
const lead_time_premium = (best.vendor_id !== cheapest.vendor_id)
  ? Number(((best.unit_price - cheapest.unit_price) * qty).toFixed(2)) : 0;

const maverick_flag = Boolean(req.preferred_vendor) && req.preferred_vendor !== best.vendor_id;

return [{ json: { ...req,
  catalog_match: true,
  match_count: priced.length,
  best_vendor_id: best.vendor_id,
  best_vendor_name: best.vendor_name,
  best_unit_price: best.unit_price,
  contract_flag: best.contract_flag,
  lead_time_days: best.lead_time_days,
  max_lead_time_days: hasTolerance ? maxLead : null,
  lead_time_breach: breach,
  lead_time_premium,
  excluded_on_lead_time: excluded,
  currency: best.currency || 'EUR',
  derived_amount,
  incumbent_amount,
  savings_vs_incumbent: savings,
  maverick_flag,
  alternatives: priced.map(p => ({
    vendor: p.vendor_name, price: p.unit_price,
    contract: p.contract_flag, lead_time_days: p.lead_time_days,
  })),
  state: 'PRICED',
}}];
```

### 11. Catalog Match?  [`if`](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.if/)

Gate. Priced against at least one vendor: proceed to routing and post `#requests`. Nothing matched: route to sourcing.

**What to change:** Nothing. Reads `catalog_match` set by the pricing node.

### 12. Needs Sourcing (RFQ)  [`set`](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.set/)

Terminal state for an item no approved vendor lists. Marks `NEEDS_SOURCING` and posts the outcome instead of auto-approving an un-priced request. Detection ships in the pilot; the three-quote sourcing event is roadmap.

**What to change:** Wire this to your RFQ or sourcing process when it exists. Today it records the state and notifies.

### 13. Notify #requests  [`code`](https://docs.n8n.io/build/code-in-n8n/using-the-code-node)

Builds the Slack Block Kit message for a raised-and-priced requisition. `#requests` is a separate channel and audience from `#approvals`.

**What to change:** Edit the message layout here. The destination channel is the webhook env var on the next node.

```js
// Post to #requests: requisition received and priced. Separate channel/audience from #approvals.
const j = $input.first().json;
const money = (n) => (n === null || n === undefined) ? 'n/a'
  : (j.currency || 'EUR') + ' ' + Number(n).toLocaleString('de-DE', {minimumFractionDigits: 2, maximumFractionDigits: 2});
return [{ json: { ...j, slack_payload: {
  text: 'New requisition ' + j.request_id,
  blocks: [
    {type: 'section', text: {type: 'mrkdwn',
      text: '*New requisition* `' + j.request_id + '`\n' + j.sku +
            (j.item_description ? ' - ' + j.item_description : '') + '  ×' + j.quantity}},
    {type: 'context', elements: [{type: 'mrkdwn',
      text: j.business_unit + '  |  ' + money(j.derived_amount) + ' via ' + (j.best_vendor_name || 'n/a') +
            '  |  raised by ' + (j.requester_email || 'unknown') + ' (' + (j.intake_channel || 'form') + ')'}]},
  ]}}}];
```

### 14. Post to #requests  [`httpRequest`](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.httprequest/)

Posts the `#requests` message. A parallel branch (a side effect), never inline in the pipeline, so a Slack response is never mistaken for the request object downstream.

**What to change:** The channel is whatever `REQUESTS_SLACK_WEBHOOK` points at. Rotate the channel by rotating the secret, not by editing the workflow.

```json
"url": "={{ $env.REQUESTS_SLACK_WEBHOOK }}"
```


---

## Zone: ROUTE

IN: priced request.
OUT: a route (`auto_approve`, `single_approver`, `dual_approver`, `default_deny`) plus approver.
READS: [`doa_rules`](https://your-runbook.example/#doa_rules-the-policy-master) bands.
LOGIC: match the derived amount to exactly one band, then apply the band's approval mode.
ON FAILURE: no rule row, a lead-time breach, an amount outside every band, or overlapping bands all default-deny to a human. It never auto-approves on a gap.

### 15. Threshold Eval + Self-Check  [`code`](https://docs.n8n.io/build/code-in-n8n/using-the-code-node)

Deterministic evaluation against the [`doa_rules`](https://your-runbook.example/#doa_rules-the-policy-master) bands, plus a self-check that grades its own output. Default-denies on any gap: no rule row, a lead-time breach, an amount outside every band, or overlapping bands.

**What to change:** Behavior is entirely `doa_rules` data. Move a threshold, change an approver, or switch a band to dual approval in the table. The self-check (exactly one band must match) is a guardrail; leave it in place.

```js
// Route on DoA bands; self-check grades its own output. Deterministic, no LLM.
const req = $input.first().json;
const amount = Number(req.derived_amount);

const rules = $('DoA Rule Lookup').all().map(i => i.json).filter(r => r && r.business_unit && r.category);
const base = { ...req, evaluated_at: new Date().toISOString() };

// Default-deny: no rule row for this BU/category.
if (rules.length === 0) {
  return [{ json: { ...base, route: 'default_deny',
    route_reason: 'no_rule_row_for_bu_category', approver: null,
    self_check: 'pass', state: 'AWAITING_APPROVAL' }}];
}

// Default-deny: no vendor within lead-time tolerance.
if (req.lead_time_breach) {
  const r0 = rules[0];
  return [{ json: { ...base, route: 'default_deny',
    route_reason: 'lead_time_breach', approver: r0.approver_primary || null,
    approver_fallback: r0.approver_fallback, escalation_hours: Number(r0.escalation_hours),
    self_check: 'pass', state: 'AWAITING_APPROVAL' }}];
}

const bands = rules.filter(r =>
  amount >= Number(r.threshold_min) && amount < Number(r.threshold_max));

// Default-deny: amount outside every band.
if (bands.length === 0) {
  return [{ json: { ...base, route: 'default_deny',
    route_reason: 'amount_outside_all_bands', approver: null,
    self_check: 'pass', state: 'AWAITING_APPROVAL' }}];
}

// Self-check: exactly one band must match; overlapping bands are a config error.
const self_check = bands.length === 1 ? 'pass' : 'FAIL_overlapping_bands';
if (self_check !== 'pass') {
  return [{ json: { ...base, route: 'default_deny',
    route_reason: 'overlapping_rule_bands', matched_bands: bands.length,
    approver: null, self_check, state: 'AWAITING_APPROVAL' }}];
}

const band = bands[0];
const autoUnder = Number(band.auto_approve_under) || 0;

// approval_mode is config, not code.
let route;
if (autoUnder > 0 && amount < autoUnder) route = 'auto_approve';
else if (String(band.approval_mode).toLowerCase() === 'dual') route = 'dual_approver';
else route = 'single_approver';

return [{ json: { ...base,
  route, route_reason: 'matched_band',
  band_min: Number(band.threshold_min), band_max: Number(band.threshold_max),
  approval_mode: band.approval_mode,
  approver: route === 'auto_approve' ? null : band.approver_primary,
  approver_fallback: band.approver_fallback,
  escalation_hours: Number(band.escalation_hours),
  auto_approve_under: autoUnder,
  self_check,
  state: route === 'auto_approve' ? 'APPROVED' : 'AWAITING_APPROVAL',
}}];
```

### 16. Route Decision  [`switch`](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.switch/)

Switch on the computed route. `auto_approve` goes to the auto-approved state; `single_approver`, `dual_approver`, and `default_deny` converge on the one approval gate. Same shape, different data.

**What to change:** Nothing. The route is decided by the eval node from table data; this only fans the four outcomes out.

### 17. Auto-Approved  [`set`](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.set/)

Terminal state for a request under the BU's auto-approve floor. Records `APPROVED` and posts the outcome, no human.

**What to change:** The floor is `auto_approve_under` in [`doa_rules`](https://your-runbook.example/#doa_rules-the-policy-master). Set it to 0 to disable auto-approval for a band.


---

## Zone: APPROVE

IN: a request that needs a human decision.
OUT: approved, rejected, or escalated.
LOGIC: post one approval card, pause the execution, resume on a signed decision link. Approve and Reject are the same execution's resume URL with a different `decision` value, so the button works from Slack or email.
ON FAILURE: no decision before `escalation_hours` escalates to the fallback approver. The paused execution is the state; no external store.

### 18. Build Approval Card  [`code`](https://docs.n8n.io/build/code-in-n8n/using-the-code-node)

Builds the Slack approval card with the context needed to decide (best vendor, savings, lead time, contract vs spot, priced alternatives, flags) and both decision links. Approve and Reject are the same execution's resume URL with a different `decision` value, so the same button works from Slack or email.

**What to change:** Edit the card layout here. n8n generates the signed resume URL; do not hand-build it. The query is joined with `&` because the resume URL already carries `?signature=`.

```js
// Build the Slack approval card and both decision links (same resume URL, different decision).
const j = $input.first().json;
const resume = $execution.resumeUrl;

const money = (n) => (n === null || n === undefined)
  ? 'n/a'
  : (j.currency || 'EUR') + ' ' + Number(n).toLocaleString('de-DE', {minimumFractionDigits: 2, maximumFractionDigits: 2});

// resumeUrl already carries ?signature=; join with & or the resume 401s.
const join = (u, kv) => u + (u.includes('?') ? '&' : '?') + kv;
const approveUrl = join(resume, 'decision=approve');
const rejectUrl  = join(resume, 'decision=reject');

const alts = Array.isArray(j.alternatives) ? j.alternatives : [];
const altLines = alts.slice(0, 4)
  .map(a => '• ' + a.vendor + '  ' + money(a.price) + '  _' + a.contract + '_')
  .join('\n') || '_no alternatives_';

const flags = [];
if (j.maverick_flag) flags.push(':warning: *Off-contract request* - requester named ' + (j.preferred_vendor || 'another vendor') + ', not the best contracted source');
if (j.route === 'default_deny') flags.push(':no_entry: *Default-deny* - ' + (j.route_reason || 'no matching rule') + '. This did NOT auto-approve.');
if (j.route === 'dual_approver') flags.push(':busts_in_silhouette: *Dual approval* - this is gate 1 of 2');

const blocks = [
  {type: 'header', text: {type: 'plain_text', text: 'Purchase requisition ' + j.request_id}},
  {type: 'section', fields: [
    {type: 'mrkdwn', text: '*Business unit*\n' + j.business_unit},
    {type: 'mrkdwn', text: '*Cost center*\n' + (j.cost_center || 'n/a')},
    {type: 'mrkdwn', text: '*Item*\n' + j.sku + (j.item_description ? ' - ' + j.item_description : '')},
    {type: 'mrkdwn', text: '*Quantity*\n' + j.quantity},
    {type: 'mrkdwn', text: '*Amount (derived)*\n' + money(j.derived_amount)},
    {type: 'mrkdwn', text: '*Best source*\n' + (j.best_vendor_name || 'n/a')},
  ]},
  {type: 'section', text: {type: 'mrkdwn',
    text: '*Savings vs incumbent:* ' + money(j.savings_vs_incumbent) +
          '\n*Lead time:* ' + (j.lead_time_days ?? 'n/a') + ' days   *Pricing:* ' + (j.contract_flag || 'n/a')}},
  {type: 'section', text: {type: 'mrkdwn', text: '*Priced against*\n' + altLines}},
];
if (flags.length) blocks.push({type: 'section', text: {type: 'mrkdwn', text: flags.join('\n')}});
blocks.push({type: 'context', elements: [{type: 'mrkdwn',
  text: 'Requested by ' + (j.requester_email || 'unknown') + ' via ' + (j.intake_channel || 'form') +
        '  |  routes to ' + (j.approver || 'a human') + '  |  escalates in ' + (j.escalation_hours ?? 24) + 'h'}]});
blocks.push({type: 'actions', elements: [
  {type: 'button', style: 'primary', text: {type: 'plain_text', text: 'Approve'}, url: approveUrl},
  {type: 'button', style: 'danger',  text: {type: 'plain_text', text: 'Reject'},  url: rejectUrl},
]});

return [{ json: { ...j,
  slack_payload: {
    text: 'Approval needed: ' + j.request_id + ' ' + money(j.derived_amount),
    blocks,
  },
  approve_url: approveUrl,
  reject_url: rejectUrl,
  awaiting_since: new Date().toISOString(),
}}];
```

### 19. Post to #approvals  [`httpRequest`](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.httprequest/)

Posts the approval card to the reviewer channel and hands off to the Wait node.

**What to change:** Channel is `APPROVALS_SLACK_WEBHOOK`. This is the only channel that should carry work needing a human.

```json
"url": "={{ $env.APPROVALS_SLACK_WEBHOOK }}"
```

### 20. Wait for Decision  [`wait`](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.wait/)

Pauses the execution until a decision link is clicked (webhook resume) or the timeout elapses. The paused execution is the state; no external store needed.

**What to change:** The timeout is `escalation_hours` from [`doa_rules`](https://your-runbook.example/#doa_rules-the-policy-master). A resume with no decision is the escalation signal.

### 21. Apply Decision  [`code`](https://docs.n8n.io/build/code-in-n8n/using-the-code-node)

Resolves the outcome from the resumed webhook query: approve, reject, or (on timeout, no decision) escalate to the fallback approver. A dual-approval approve records gate 1 of 2.

**What to change:** Nothing. The fallback approver is `approver_fallback` in [`doa_rules`](https://your-runbook.example/#doa_rules-the-policy-master), so escalation targets are config, not code.

```js
// Resume from Slack button, email link, or Wait timeout. Timeout = no decision = escalate.
const prior = $('Build Approval Card').first().json;

// Webhook resume exposes the caller's query; timeout has none.
const first = $input.first().json || {};
const q = first.query || (first.body && first.body.query) || {};
const decision = String(q.decision || '').toLowerCase();

const base = { ...prior, decided_at: new Date().toISOString() };

if (decision === 'approve') {
  return [{ json: { ...base, decision: 'approved', decided_by: prior.approver || 'approver',
                    state: prior.route === 'dual_approver' ? 'GATE1_APPROVED' : 'APPROVED' }}];
}
if (decision === 'reject') {
  return [{ json: { ...base, decision: 'rejected', decided_by: prior.approver || 'approver',
                    state: 'REJECTED' }}];
}

// No decision: wait elapsed, escalate to configured fallback.
return [{ json: { ...base, decision: 'timed_out', decided_by: null,
                  escalated_to: prior.approver_fallback || null,
                  state: 'ESCALATED' }}];
```


---

## Zone: RECORD

IN: any terminal state (approved, rejected, escalated, needs-sourcing).
OUT: one Slack outcome post plus one [`pr_events`](https://your-runbook.example/#pr_events-the-audit-log) audit row.
WRITES: `pr_events`.
LOGIC: post the outcome for every terminal state, then append one audit row with cycle-time and revision-lineage fields. No PO number; the ERP owns that sequence.

### 22. Build Outcome  [`code`](https://docs.n8n.io/build/code-in-n8n/using-the-code-node)

Builds the `#orders` post for every terminal state: approved, rejected, escalated, and no-catalog-match. Posting only approvals is not an audit trail. Computes time-to-decision. Does not mint a PO number.

**What to change:** Edit the outcome message here. The no-PO stance is intentional: the ERP owns that sequence, and ERP write-back is the roadmap next step. Do not invent a PO number in this workflow.

```js
// Build the #orders post for every terminal state (approved/rejected/escalated/needs-sourcing).
const j = $input.first().json;

const money = (n) => (n === null || n === undefined) ? 'n/a'
  : (j.currency || 'EUR') + ' ' + Number(n).toLocaleString('de-DE',
      {minimumFractionDigits: 2, maximumFractionDigits: 2});

// Time-to-decision: capture now, while both timestamps exist.
let elapsed = null;
if (j.awaiting_since && j.decided_at) {
  const ms = new Date(j.decided_at) - new Date(j.awaiting_since);
  if (Number.isFinite(ms) && ms >= 0) {
    const mins = Math.round(ms / 60000);
    elapsed = mins < 60 ? mins + ' min'
            : (mins < 1440 ? (mins / 60).toFixed(1) + ' h' : (mins / 1440).toFixed(1) + ' days');
  }
}

const state = String(j.state || '').toUpperCase();
const MAP = {
  APPROVED:        [':white_check_mark:', 'Approved'],
  GATE1_APPROVED:  [':white_check_mark:', 'Approved at gate 1 of 2'],
  REJECTED:        [':x:', 'Rejected'],
  ESCALATED:       [':alarm_clock:', 'Escalated, no decision in time'],
  NEEDS_SOURCING:  [':mag:', 'No catalog match, sourcing required'],
};
const [icon, label] = MAP[state] || [':grey_question:', state || 'Unknown'];

const lines = [];
lines.push(icon + ' *' + label + '* - `' + j.request_id + '`');
lines.push('*' + (j.sku || 'n/a') + '*' + (j.item_description ? ' - ' + j.item_description : '') +
           '  ×' + (j.quantity ?? 'n/a'));

if (state === 'NEEDS_SOURCING') {
  lines.push('_No approved vendor lists this item. Routed for RFQ / three quotes rather than auto-approved._');
} else {
  lines.push(money(j.derived_amount) + ' via *' + (j.best_vendor_name || 'n/a') + '*' +
             (j.savings_vs_incumbent ? '  (' + money(j.savings_vs_incumbent) + ' under the incumbent contract price)' : ''));
}
if (j.maverick_flag) {
  lines.push(':warning: Off-contract request corrected at intake - requester named ' +
             (j.preferred_vendor || 'another vendor') + '.');
}
if (state === 'ESCALATED') {
  lines.push(':arrow_right: Escalated to *' + (j.escalated_to || 'fallback approver') +
             '* after ' + (j.escalation_hours ?? 24) + 'h with no decision.');
}
if (j.route === 'default_deny') {
  lines.push(':no_entry: Reached a human by *default-deny* (' + (j.route_reason || 'no matching rule') +
             '). It did not auto-approve.');
}

const ctx = [];
ctx.push(j.business_unit + (j.cost_center ? ' / ' + j.cost_center : ''));
ctx.push('raised by ' + (j.requester_email || 'unknown') + ' via ' + (j.intake_channel || 'form'));
if (j.decided_by) ctx.push('decided by ' + j.decided_by);
if (elapsed) ctx.push('time to decision ' + elapsed);

// No PO number invented; the ERP owns that sequence (write-back is roadmap).
const poLine = (state === 'APPROVED' || state === 'GATE1_APPROVED')
  ? '_Ready for PO creation. ERP write-back is roadmap, so the purchase order number still comes from your ERP. Internal reference `' + j.request_id + '`._'
  : null;

const blocks = [
  {type: 'section', text: {type: 'mrkdwn', text: lines.join('\n')}},
];
if (poLine) blocks.push({type: 'section', text: {type: 'mrkdwn', text: poLine}});
blocks.push({type: 'context', elements: [{type: 'mrkdwn', text: ctx.join('  |  ')}]});

return [{ json: { ...j,
  time_to_decision: elapsed,
  slack_payload: { text: label + ': ' + j.request_id, blocks },
}}];
```

### 23. Post to #orders  [`httpRequest`](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.httprequest/)

Posts the outcome to the orders channel. Third channel, third audience: decided requests.

**What to change:** Channel is `ORDERS_SLACK_WEBHOOK`.

```json
"url": "={{ $env.ORDERS_SLACK_WEBHOOK }}"
```

### 24. Build Event Row  [`code`](https://docs.n8n.io/build/code-in-n8n/using-the-code-node)

Flattens the request into one audit row: request id, event (state), a JSON detail blob (carries the rejection reason), actor, the write timestamp, the cycle-time fields (`submitted_at`, `decided_at`, `cycle_seconds`), and the revision lineage (`revision_of`, `revision_count`).

**What to change:** Add a field to the `detail` blob if you want it queryable at the 90-day review. Keep one row per request. The timestamp and lineage fields make cycle time and rework rate direct queries; leave them in place.

```js
// RECORD: one row per request at its terminal state (audit + cycle-time instrument).
const j = $input.first().json;
const now = new Date().toISOString();
const submitted_at = j.created_at || null;
// Human-gated paths carry decided_at; auto-decided/terminal states decide at record time.
const decided_at = j.decided_at || now;
const cycle_seconds = submitted_at
  ? Math.max(0, Math.round((new Date(decided_at) - new Date(submitted_at)) / 1000))
  : null;
return [{ json: {
  request_id: j.request_id || 'UNKNOWN',
  event: j.state || 'UNKNOWN',
  detail: JSON.stringify({
    route: j.route || null,
    route_reason: j.route_reason || null,
    self_check: j.self_check || null,
    derived_amount: j.derived_amount ?? null,
    currency: j.currency || 'EUR',
    best_vendor: j.best_vendor_name || null,
    savings_vs_incumbent: j.savings_vs_incumbent ?? null,
    maverick_flag: j.maverick_flag ?? null,
    catalog_match: j.catalog_match ?? null,
    approver: j.approver || null,
    reject_reason: j.reject_reason || null,
  }),
  actor: j.requester_email || 'system',
  ts: now,
  submitted_at,
  decided_at,
  cycle_seconds,
  revision_of: j.revision_of || null,
  revision_count: j.revision_count ?? 0,
}}];
```

### 25. Write Event Row  [`dataTable`](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.datatable/)

Appends the row to [`pr_events`](https://your-runbook.example/#pr_events-the-audit-log). This table is the measurement instrument the 90-day review queries, and the input to rule-drift detection.

**What to change:** Point at your `pr_events` table id. In production, branch here to a database or warehouse for reporting.

## Zone: REVISION LOOP

**What happens after a rejection.** A rejection starts a reject, revise, re-approve loop, not a terminal state. It lives in its own workflow, `FieldOps - Revision Loop`, so the production flow stays single-purpose (score a request, drive it to a decision) and rework has its own trigger, actors, and metric.

**Shape: terminate and re-enter, not park and resume.** The production flow terminates a rejection cleanly (writes its own `REJECTED` row) and fires this loop. The revised request returns as a new production run, re-priced and re-routed from scratch, carrying `revision_of` and `revision_count`. Nothing sits in a long-lived waiting execution: an n8n Wait node parked for a human edit can hang indefinitely, and the audit model stays one terminal row per request, linked into a chain.

**Why re-enter the engine.** A revision is not a re-stamp of the original decision. A changed quantity or vendor changes the derived amount and can change the route: a revision under the auto-approve ceiling now auto-approves; one crossing into dual approval escalates. Re-entering the same engine is the config-over-canvas payoff, and the golden set proves it (`bu01-rework-revised-down-auto`).

### R1. Reject Reason Webhook  [`webhook`](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/) (GET)

The Reject button on the approval card points here, not at the resume URL directly. It renders a small form for a mandatory rejection reason. The reason is what the requester revises against, so it is captured at the moment of rejection.

**What to change:** Nothing usually. The path (`fde-reject-form`) must match the URL the approval card builds.

### R2. Build Reason Form  [`code`](https://docs.n8n.io/build/code-in-n8n/using-the-code-node)

Renders the reason form as HTML. The form action is the paused request's own resume URL, submitted by GET because the Wait node resumes on GET (the same method as the Slack/email approve link). A GET submit rewrites the query string, so the signature and `decision=reject` ride as hidden inputs alongside the typed reason.

**What to change:** Styling only. Do not switch the form to POST; the Wait node will not match it.

### R3. Return Form  [`respondToWebhook`](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.respondtowebhook/)

Returns the rendered HTML to the approver's browser.

### R4. Revision Notify Webhook  [`webhook`](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/) (POST)

The production flow calls this fire-and-forget after it writes the `REJECTED` row. The body carries the request, the reason, the cost owner, and the current `revision_count`. It responds immediately, so the production run is never blocked on it.

### R5. Prepare Revision  [`code`](https://docs.n8n.io/build/code-in-n8n/using-the-code-node)

Bounds the loop and builds the return path. Computes the next attempt number, checks the cap (3 revisions), fixes the chain root (`revision_of` = the original request id), and builds a pre-filled intake link carrying the item, the requester, and the lineage as query parameters, so the requester reopens the request already populated.

**What to change:** `MAX` (the revision cap). The link is built by hand because `URLSearchParams` is not available in the Code sandbox.

### R6. Revision Cap Hit?  [`if`](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.if/)

Splits the two outcomes: under the cap, ask for a revision; at the cap, close it.

### R7. Under the cap: notify + record

`Build Revision Row` -> `Write Revision Row` writes a `REVISION_REQUESTED` row to [`pr_events`](https://your-runbook.example/#pr_events-the-audit-log) (the reason, the attempt number, the link). In parallel, `Email Revision Request` sends the requester the reason plus the pre-filled link, and `Post Revision to Slack` posts to `#orders`. The revised submission is a fresh production run.

### R8. At the cap: close as REJECTED_FINAL

`Build Final Row` -> `Write Final Row` writes a `REJECTED_FINAL` row. `Email Final Rejection` tells the requester and the cost owner it is closed with no further revisions, and `Post Final to Slack` posts the same. No pre-filled link.

**The metric this unlocks:** every pass links to the chain root, so rework rate is `count(revision_of IS NOT NULL) / count(distinct chain)`, and end-to-end cycle time spans the first submission to the final decision, both queries against [`pr_events`](https://your-runbook.example/#pr_events-the-audit-log). The client-carried `revision_count` is the pilot's cap; a server-side recount of the chain is the hardening step.


---

## Change cookbook

Common changes, and the one place each is made. None of these touch a code node.

| You want to | Change | Where |
|---|---|---|
| Add business unit BU-05 | add a dropdown option, add [`doa_rules`](https://your-runbook.example/#doa_rules-the-policy-master) rows (one per band), add a [`business_units`](https://your-runbook.example/#business_units-the-bu-registry) row | form + 2 tables |
| Move an approval threshold | edit `threshold_min` / `threshold_max` on the band row | `doa_rules` |
| Change who approves | edit `approver_primary` / `approver_fallback` | `doa_rules` |
| Require two approvers on a band | set `approval_mode` = `dual` | `doa_rules` |
| Let small spend auto-approve | raise `auto_approve_under` (0 disables) | `doa_rules` |
| Tighten or relax delivery speed | edit `max_lead_time_days` | `doa_rules` |
| Change the escalation clock | edit `escalation_hours` | `doa_rules` |
| Add or reprice a vendor | add / edit the SKU-vendor row | [`vendor_catalog`](https://your-runbook.example/#vendor_catalog-the-approved-supplier-list) |
| Add a new item | add `vendor_catalog` rows, one per vendor | `vendor_catalog` |
| Move a Slack channel | rotate the `*_SLACK_WEBHOOK` secret | secret store |

## Onboard a business unit

You should not need to open a single node to do this.

1. Add the business unit to the **business_units** table (`code`, `name`, `active`).
2. Add its rows to **doa_rules**, one per threshold band:
   `business_unit, category, threshold_min, threshold_max, approver_primary, approver_fallback, approval_mode, escalation_hours, auto_approve_under, max_lead_time_days, cost_center`
3. Run the golden set. If it passes, that unit is live.

Bands must not overlap: the evaluator asserts exactly one band claims an amount and
default-denies if more than one does. A unit with no rows is safe; every request
from it default-denies to a human until somebody writes its policy. That is
deliberate.

## Evaluations: the golden set (regression tests)

The workflow has no LLM, so its correctness is a **test suite**, not a model
evaluation. The golden set (`golden/`) is 19 known requests with known-correct
outcomes. It pulls the four decision nodes' **actual source** from the workflow
export and replays them against a snapshot of the config tables, so it runs the
deployed logic and cannot drift from it.

Run it:

```
node golden/run_golden.mjs
```

```
19 passed, 0 failed, 19 total
```

It covers every route and every default-deny reason: auto-approve floors, single
and dual bands, lead-time-aware vendor selection (the same SKU picks a different
vendor per business unit, sometimes at a premium), default-deny on a missing rule
row, a lead-time breach, and an out-of-band amount, sourcing on no catalog match,
the maverick flag, and the quantity guard that throws on `0` or `"two boxes"`
rather than silently ordering one. Detail in `golden/README.md`.

This is the concrete answer to "how do you know green means correct": after any
change to the workflow or the tables, re-run the set.

### What a case looks like

Each entry in `golden_cases.json` is an `input` (the request as the form or email
would submit it) and an `expect` (the fields the decision must produce):

```
{
  "name": "bu01-auto-approve-maverick",
  "input":  { "business_unit": "BU-01", "sku": "MRO-1001", "quantity": 10,
             "category": "MRO", "preferred_vendor": "VEND-A" },
  "expect": { "route": "auto_approve", "state": "APPROVED", "self_check": "pass",
             "best_vendor_id": "VEND-B", "derived_amount": 142, "maverick_flag": true }
}
```

`expect` lists only the fields that matter for that case; the runner diffs each one
against what the logic returns. An input-guard case asserts a throw instead of a
route: `"expect": { "error": true }` (quantity `0` or `"two boxes"` must refuse,
not default to 1).

### Configure the evaluations

**Add or change a case.** Edit `golden_cases.json`: add an `input` with the known
request and an `expect` with the known-correct outcome, then re-run
`node golden/run_golden.mjs`. Green confirms the logic already produces that
outcome; a red run prints a per-field diff, and you decide whether the case or the
logic is wrong.

**Refresh the config snapshot.** `golden_config.json` is a point-in-time copy of
[`doa_rules`](https://your-runbook.example/#doa_rules-the-policy-master), [`vendor_catalog`](https://your-runbook.example/#vendor_catalog-the-approved-supplier-list), and [`business_units`](https://your-runbook.example/#business_units-the-bu-registry). When those tables change,
re-dump them into it, regenerate the expected values from the current logic, and
**review the diff by hand** before committing:

```
node golden/run_golden.mjs --generate > golden_cases.new
mv golden_cases.new golden_cases.json
```

Regenerating locks whatever the code currently produces, so a human has to confirm
the new expectations are actually right. That review is what keeps the suite honest
rather than tautological.

### The same evaluation, inside n8n (test before you deploy)

The golden set also runs **in n8n**, so your team can test a change without
leaving the platform. Two workflows, a dev/prod split:

- **A DEV copy** of this workflow. You edit and test here.
- **A Regression Test Runner**: a form where you pick a business unit (or ALL)
  and click run. It sends the golden cases through the DEV workflow's **real
  decision logic**, shows pass or fail on the completion page, and posts the
  findings to a **#regression** Slack channel so the team sees every run.

The loop: edit DEV, open the Regression Test form, pick the business unit, green
means every request still routes to the right place for the right amount, then
promote DEV to production. Run it per business unit so an owner can check just
their own rules.

**How the runner is built.** Form (business-unit dropdown) -> a **Golden Set**
Code node that holds the cases and filters them to the chosen BU -> **Execute
Workflow** (once per case) against DEV -> **Assert** (the per-field diff) ->
**Summary** -> a **#regression** post and the form result page.

**Configure the runner.**

- **Add a business unit:** add the option to the form's dropdown, and add its
  cases to the **Golden Set** Code node (same case shape as `golden_cases.json`).
- **Change a case:** edit it in the **Golden Set** Code node. That node is the
  in-n8n copy of `golden_cases.json`; keep the two in step.
- **The #regression channel** comes from `REGRESSION_SLACK_WEBHOOK` in the
  container env, the same secret pattern as the other channels (see below).

The DEV workflow carries an **inert test hook**: when a case arrives with
`_mode` set to `test`, it returns the decision and short-circuits before Slack,
the approval wait, and the event write, so a test run has no side effects and
leaves nothing to clean up. In normal use the hook never fires.

## Failure modes

The failure mode this workflow is built to refuse: a run can be green and still be
wrong. Four places that is defended:

1. A missing rule row default-denies instead of passing.
2. A low-confidence email parse bounces instead of routing.
3. The threshold evaluator grades its own output (`self_check`).
4. An unmeetable lead time is flagged, not quietly ignored.

The weekly query that matters: requests that entered and never terminated. n8n will
show you green executions; green is not the same as done. The golden set is the
artifact that keeps this true after a config change, so run it after every rule edit.

Cycle time and stall rate read straight off [`pr_events`](https://your-runbook.example/#pr_events-the-audit-log): `cycle_seconds` per row gives
median and p90 elapsed time, and the stall rate is the share of rows over your SLA. No
separate instrumentation, and the before/after comparison uses the same definition on
both sides.

## Troubleshooting

**Everything from one business unit is denying.** It has no rows in [`doa_rules`](https://your-runbook.example/#doa_rules-the-policy-master), or
its bands overlap. Check `route_reason` on the event row.

**A request took an unexpected vendor.** Check `max_lead_time_days` for that unit:
the cheapest source may not meet its tolerance. `lead_time_premium` shows what the
tolerance cost.

**An approval link says invalid token.** Resume URLs are single-use and die once
actioned. Expected behaviour, not a fault.

**Nothing arrived in Slack.** The webhook URLs come from the container env; check
they are present before suspecting the workflow.

**It is 2am and it is broken.** Find the `request_id` in [`pr_events`](https://your-runbook.example/#pr_events-the-audit-log), read the last
transition, and the failure is in the next step. Nothing is lost, because state is a
row, not a variable in a running process.

## Secrets

The four Slack destinations are referenced as environment variables, never
written into the workflow. An export of this workflow leaks nothing.

| Variable | Channel |
|---|---|
| `REQUESTS_SLACK_WEBHOOK` | #requests, raised and priced |
| `APPROVALS_SLACK_WEBHOOK` | #approvals, needs a human |
| `ORDERS_SLACK_WEBHOOK` | #orders, decided |
| `REGRESSION_SLACK_WEBHOOK` | #regression, evaluation results (DEV runner) |

They are injected into the container from the secret store at runtime. Rotating a
channel is a secret change and a restart, not a workflow edit.

**Demo vs enterprise (design note).** This pilot injects the Slack webhook URLs
from an external secret store as environment variables, a pilot-scoped choice
rather than the enterprise pattern. The native path is n8n **External Secrets**
(`$secrets.*` from Vault, Infisical, or AWS Secrets Manager), an Enterprise feature
that would keep the reference inside n8n while the secret manager stays the source
of truth. Either way the secret never enters the workflow export.

## Email notifications

Alongside the Slack posts, an email layer notifies people over their own inbox. Five
`emailSend` nodes hang as parallel side-branches off the notify steps, so a failed send
never affects routing:

| Node | Fires when | Goes to |
|---|---|---|
| Email Notification Request | a request is received and priced | the requester |
| Email Notification Awaiting Approval | a request needs a human | the approver (carries the approve / reject links) |
| Email Notification Auto Approval | a request auto-approves under the ceiling | the requester and the cost owner (both need to know it auto-approved) |
| Email Notification Order Approved | a request is approved | the requester |
| Bounce Back Email Form | an email could not be parsed | the sender (with the form link) |

Each body reads the request from the workflow's own nodes (`Normalize Request`, `Best
Price + Maverick Flag`, `Build Approval Card`, `Build Outcome`), not from the Slack
response, and each node is set to **continue on error** so the flow completes even if
mail is down.

**To turn it on:** point the SMTP credential (`FieldOps SMTP (placeholder - set your mail
server)`) at your mail server. That is the only change; the nodes and templates are
already wired. Until then the nodes attempt to send against a placeholder host and
continue, and Slack is the live channel.

## What is deliberately not built (roadmap)

- **ERP write-back and the PO number.** The ERP owns that sequence; a PO number
  that exists only here is a reconciliation problem. The workflow stops at "ready
  for PO."
- **The RFQ / three-quote sourcing event.** Detection of an un-listed item ships
  in the pilot; the sourcing process itself is spec'd, not built.
- **A real Slack app with signed interactivity.** The pilot uses signed,
  single-use resume links (the same model as a password-reset link) because a
  Slack button cannot carry an Access cookie. A first-class Slack app is the
  hardening step.
- **Dedup enforcement.** `request_id` is deterministic and ready; a single
  [`pr_events`](https://your-runbook.example/#pr_events-the-audit-log) lookup before routing closes it.
