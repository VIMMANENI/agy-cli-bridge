import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const TEST_PORT = 4399;
const TEST_TOKEN = "secret-test-token";
const BASE = `http://127.0.0.1:${TEST_PORT}`;

async function waitForServer(url, headers = {}) {
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(url, { headers });
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Server did not start in time");
}

async function runTests() {
  const child = spawn(process.execPath, ["cli.js"], {
    env: { ...process.env, PORT: String(TEST_PORT), BRIDGE_TOKEN: TEST_TOKEN },
    stdio: ["pipe", "pipe", "pipe"],
  });

  try {
    const authHeaders = { Authorization: `Bearer ${TEST_TOKEN}` };
    await waitForServer(`${BASE}/health`, authHeaders);

    // 1. Auth enforcement
    const unauth = await fetch(`${BASE}/health`);
    assert.equal(unauth.status, 401, "Unauthenticated /health should return 401 when BRIDGE_TOKEN is set");
    console.log("PASS 1: Auth enforcement (401 without token)");

    // 2. Health check
    const healthRes = await fetch(`${BASE}/health`, { headers: authHeaders });
    assert.equal(healthRes.status, 200);
    const health = await healthRes.json();
    assert.equal(health.ok, true);
    assert.equal(health.authRequired, true);
    console.log("PASS 2: GET /health", health);

    // 3. Root HTML UI
    const htmlRes = await fetch(`${BASE}/`);
    assert.equal(htmlRes.status, 200);
    const html = await htmlRes.text();
    assert.ok(html.includes("Antigravity CLI Bridge"), "index.html should render title");
    console.log("PASS 3: GET / serves index.html");

    // 4. CORS preflight
    const corsRes = await fetch(`${BASE}/prompt`, { method: "OPTIONS" });
    assert.equal(corsRes.status, 204);
    assert.equal(corsRes.headers.get("access-control-allow-origin"), "*");
    console.log("PASS 4: OPTIONS /prompt CORS preflight");

    // 5. Valid POST /prompt
    const promptRes = await fetch(`${BASE}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ prompt: "Automated test prompt" }),
    });
    assert.equal(promptRes.status, 200);
    const promptData = await promptRes.json();
    assert.equal(promptData.ok, true);
    assert.ok(promptData.reply.includes("Automated test prompt"));
    console.log("PASS 5: POST /prompt valid round-trip");

    // 6. Missing prompt -> 400
    const emptyRes = await fetch(`${BASE}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ prompt: "   " }),
    });
    assert.equal(emptyRes.status, 400);
    console.log("PASS 6: POST /prompt empty prompt returns 400");

    // 7. Malformed JSON -> 400
    const badJsonRes = await fetch(`${BASE}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: "{not-valid-json",
    });
    assert.equal(badJsonRes.status, 400);
    console.log("PASS 7: POST /prompt malformed JSON returns 400");

    // 8. 404 unknown route
    const notFound = await fetch(`${BASE}/does-not-exist`, { headers: authHeaders });
    assert.equal(notFound.status, 404);
    console.log("PASS 8: GET /does-not-exist returns 404");

    // 9. SSE live stream + CLI stdin -> Web broadcast
    const sseController = new AbortController();
    const sseRes = await fetch(`${BASE}/events?token=${TEST_TOKEN}`, {
      signal: sseController.signal,
    });
    assert.equal(sseRes.status, 200);
    const reader = sseRes.body.getReader();
    const decoder = new TextDecoder();

    let sseBuffer = "";
    const firstChunk = await reader.read();
    sseBuffer += decoder.decode(firstChunk.value, { stream: true });
    assert.ok(sseBuffer.includes("event: connected"), "SSE should emit connected event");

    // Type a message into the CLI stdin and verify it broadcasts over SSE
    child.stdin.write("hello from cli stdin\n");
    let gotBroadcast = false;
    for (let i = 0; i < 10 && !gotBroadcast; i++) {
      const { value, done } = await reader.read();
      if (done) break;
      sseBuffer += decoder.decode(value, { stream: true });
      if (sseBuffer.includes("event: cli-message") && sseBuffer.includes("hello from cli stdin")) {
        gotBroadcast = true;
      }
    }
    sseController.abort();
    assert.equal(gotBroadcast, true, "SSE should receive cli-message broadcast from CLI stdin");
    console.log("PASS 9: GET /events SSE + live CLI stdin -> Web broadcast");

    console.log("\nALL 9 TESTS PASSED!");
  } finally {
    child.kill();
  }
}

runTests().catch((err) => {
  console.error("TEST FAILED:", err);
  process.exit(1);
});
