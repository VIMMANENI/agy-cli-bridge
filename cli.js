#!/usr/bin/env node
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline";
import { spawn, spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4310);

// Check whether the official `agy` CLI is available on PATH
function hasAgyCli() {
  const check = spawnSync(process.platform === "win32" ? "where" : "which", ["agy"], {
    stdio: "ignore",
  });
  return check.status === 0;
}

const agyAvailable = hasAgyCli();
const sseClients = new Set();

function broadcast(event, payload) {
  const data = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of sseClients) {
    res.write(data);
  }
}

function runAgyPrompt(prompt) {
  return new Promise((resolve, reject) => {
    const child = spawn("agy", ["-p", prompt, "--output-format", "text"], {
      shell: process.platform === "win32",
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      broadcast("chunk", { text });
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr.trim() || `agy exited with code ${code}`));
    });
  });
}

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  setCors(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // 0. Minimal test web UI
  if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
    const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
    return;
  }

  // 1. Health check
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        ok: true,
        agyInstalled: agyAvailable,
        mode: agyAvailable ? "agy" : "mock-echo",
        clients: sseClients.size,
      })
    );
    return;
  }

  // 2. Live SSE stream (CLI -> Web App)
  if (req.method === "GET" && req.url === "/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(`event: connected\ndata: ${JSON.stringify({ agyInstalled: agyAvailable })}\n\n`);
    sseClients.add(res);
    console.log(`\n[web] client connected (total: ${sseClients.size})`);
    rl.prompt(true);

    req.on("close", () => {
      sseClients.delete(res);
      console.log(`\n[web] client disconnected (total: ${sseClients.size})`);
      rl.prompt(true);
    });
    return;
  }

  // 3. Receive prompt from Web App -> run via CLI -> return response
  if (req.method === "POST" && req.url === "/prompt") {
    try {
      const { prompt } = await readJson(req);
      if (!prompt || typeof prompt !== "string") {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "Missing 'prompt' string" }));
        return;
      }

      console.log(`\n[web -> cli] ${prompt}`);
      broadcast("prompt", { prompt });

      let reply;
      if (agyAvailable) {
        reply = await runAgyPrompt(prompt);
      } else {
        reply = `[cli-bridge echo] Received: "${prompt}" (install official 'agy' CLI to run real Antigravity prompts)`;
      }

      console.log(`[cli -> web] ${reply}`);
      broadcast("reply", { prompt, reply });
      rl.prompt(true);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          mode: agyAvailable ? "agy" : "mock-echo",
          reply,
        })
      );
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: false, error: "Not found" }));
});

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: "agy-cli> ",
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Antigravity CLI Bridge listening on http://127.0.0.1:${PORT}`);
  console.log(`Official 'agy' CLI detected: ${agyAvailable ? "YES (live mode)" : "NO (mock-echo mode)"}`);
  console.log(`Endpoints: GET /health | GET /events (SSE) | POST /prompt`);
  console.log(`Type a message to push to connected web clients, 'status', or 'exit'.\n`);
  rl.prompt();
});

rl.on("line", (line) => {
  const input = line.trim();
  if (!input) {
    rl.prompt();
    return;
  }
  if (input === "exit" || input === "quit") {
    server.close();
    rl.close();
    process.exit(0);
  }
  if (input === "status") {
    console.log(`Mode: ${agyAvailable ? "agy" : "mock-echo"} | Web clients: ${sseClients.size}`);
  } else {
    broadcast("cli-message", { message: input, timestamp: new Date().toISOString() });
    console.log(`[cli -> web broadcast] sent to ${sseClients.size} client(s)`);
  }
  rl.prompt();
});
