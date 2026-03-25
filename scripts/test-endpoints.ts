// Quick endpoint test — run with: npx tsx scripts/test-endpoints.ts
const API_KEY = process.env.ADMIN_API_KEY || '8dee5c485541031cc788fb27b922926dda6dc0ae73638d1107449b704631bb15';
const BASE = 'http://localhost:3001';

const headers = { 'x-api-key': API_KEY, 'Content-Type': 'application/json' };

type TestResult = { name: string; status: number; ok: boolean; preview: string };

async function testEndpoint(name: string, path: string, options: RequestInit = {}): Promise<TestResult> {
  try {
    const url = `${BASE}${path}`;
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(5000), ...options });
    const text = await res.text();
    let preview = '';
    try {
      const json = JSON.parse(text);
      if (Array.isArray(json)) {
        preview = `Array[${json.length}] ${JSON.stringify(json[0] || {}).slice(0, 120)}`;
      } else {
        preview = JSON.stringify(json).slice(0, 200);
      }
    } catch {
      preview = text.slice(0, 200);
    }
    return { name, status: res.status, ok: res.ok, preview };
  } catch (err: any) {
    return { name, status: 0, ok: false, preview: `ERROR: ${err.message}` };
  }
}

async function main() {
  console.log('🧪 FlowGuard Endpoint Tests\n');
  console.log('='.repeat(80));

  const results: TestResult[] = [];

  // ---- Public endpoints ----
  results.push(await testEndpoint('Health', '/health'));

  // ---- Dashboard API (requires API key) ----
  results.push(await testEndpoint('Overview', '/api/overview'));
  results.push(await testEndpoint('Leaks', '/api/leaks'));
  results.push(await testEndpoint('Metrics', '/api/metrics'));
  results.push(await testEndpoint('Ledger', '/api/ledger'));
  results.push(await testEndpoint('Approvals', '/api/approvals'));
  results.push(await testEndpoint('Executions', '/api/executions'));
  results.push(await testEndpoint('Events', '/api/events?limit=5'));
  results.push(await testEndpoint('Integrations', '/api/integrations'));
  results.push(await testEndpoint('Settings', '/api/settings'));

  // ---- Auth rejection test (no key) ----
  const noAuthRes = await fetch(`${BASE}/api/overview`, { signal: AbortSignal.timeout(5000) });
  results.push({
    name: 'Auth Rejected (no key)',
    status: noAuthRes.status,
    ok: noAuthRes.status === 401,
    preview: noAuthRes.status === 401 ? 'Correctly rejected' : 'Should have been 401!',
  });

  // ---- Auth rejection test (wrong key) ----
  const wrongKeyRes = await fetch(`${BASE}/api/overview`, {
    headers: { 'x-api-key': 'wrong_key_123' },
    signal: AbortSignal.timeout(5000),
  });
  results.push({
    name: 'Auth Rejected (wrong key)',
    status: wrongKeyRes.status,
    ok: wrongKeyRes.status === 401,
    preview: wrongKeyRes.status === 401 ? 'Correctly rejected' : 'Should have been 401!',
  });

  // ---- CORS test ----
  const corsRes = await fetch(`${BASE}/api/overview`, {
    headers: { ...headers, Origin: 'http://localhost:5173' },
    signal: AbortSignal.timeout(5000),
  });
  results.push({
    name: 'CORS (localhost:5173)',
    status: corsRes.status,
    ok: corsRes.status === 200,
    preview: `Status 200 with Origin header: ${corsRes.status === 200}`,
  });

  // ---- Print results ----
  console.log('');
  let passed = 0;
  let failed = 0;
  for (const r of results) {
    const icon = r.ok ? '✅' : '❌';
    if (r.ok) passed++;
    else failed++;
    console.log(`${icon} [${r.status}] ${r.name}`);
    console.log(`   ${r.preview}`);
    console.log('');
  }

  console.log('='.repeat(80));
  console.log(`\n📊 Results: ${passed} passed, ${failed} failed, ${results.length} total\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main();
