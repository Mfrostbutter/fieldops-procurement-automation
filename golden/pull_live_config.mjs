// Export the live config tables into the golden_config.json shape, so
// check_config.mjs can diff reality against the approved snapshot.
//
// Portable: discovers the tables by NAME (no hard-coded ids), auth via env.
//
// Env:
//   N8N_URL       base url, e.g. http://localhost:5678   (default)
//   N8N_EMAIL     owner login email
//   N8N_PASSWORD  owner login password
//
// Usage:
//   N8N_URL=... N8N_EMAIL=... N8N_PASSWORD=... node golden/pull_live_config.mjs > live.json
//   node golden/check_config.mjs live.json

const BASE = (process.env.N8N_URL || 'http://localhost:5678').replace(/\/$/, '');
const EMAIL = process.env.N8N_EMAIL;
const PASSWORD = process.env.N8N_PASSWORD;
const TABLES = ['business_units', 'doa_rules', 'vendor_catalog'];
const STRIP = new Set(['id', 'createdAt', 'updatedAt']);

if (!EMAIL || !PASSWORD) {
  console.error('Set N8N_EMAIL and N8N_PASSWORD (and optionally N8N_URL).');
  process.exit(2);
}

const H = { 'content-type': 'application/json', 'browser-id': 'config-pull' };

async function login() {
  const res = await fetch(`${BASE}/rest/login`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ emailOrLdapLoginId: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`login failed: ${res.status}`);
  const cookie = res.headers.get('set-cookie');
  if (!cookie) throw new Error('no auth cookie returned');
  return cookie.split(';')[0]; // n8n-auth=...
}

async function get(cookie, path) {
  const res = await fetch(`${BASE}${path}`, { headers: { ...H, cookie } });
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
  return res.json();
}

const strip = (r) => Object.fromEntries(Object.entries(r).filter(([k]) => !STRIP.has(k)));

async function main() {
  const cookie = await login();
  const project = (await get(cookie, '/rest/projects')).data.find((p) => p.type === 'personal');
  if (!project) throw new Error('no personal project found');
  const tables = (await get(cookie, `/rest/projects/${project.id}/data-tables`)).data.data;
  const cfg = {};
  for (const name of TABLES) {
    const t = tables.find((x) => x.name === name);
    if (!t) throw new Error(`data table "${name}" not found on this instance`);
    const rows = (await get(cookie, `/rest/projects/${project.id}/data-tables/${t.id}/rows?take=1000`)).data.data;
    cfg[name] = rows.map(strip);
  }
  process.stdout.write(JSON.stringify(cfg, null, 1) + '\n');
}

main().catch((e) => { console.error(e.message); process.exit(1); });
