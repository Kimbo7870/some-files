const http = require("http");
const fs = require("fs");

const PROXY_PORT = 11435;
const OLLAMA_HOST = "127.0.0.1";
const OLLAMA_PORT = 11434;
const KEEPALIVE_INTERVAL_MS = 30_000;

// ANSI colors for pretty output
const c = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
  bold: "\x1b[1m",
};

function log(tag, msg, color = c.dim) {
  const time = new Date().toISOString().slice(11, 23);
  console.log(`${c.dim}[${time}]${c.reset} ${color}${tag}${c.reset} ${msg}`);
}

const server = http.createServer((req, res) => {
  const isChat = req.url === "/api/chat" && req.method === "POST";
  log("→ incoming", `${req.method} ${req.url}`, c.cyan);

  const bodyChunks = [];
  req.on("data", (chunk) => bodyChunks.push(chunk));
  req.on("end", () => {
    const body = Buffer.concat(bodyChunks);

    // Log the full request being sent to Ollama
    if (isChat) {
      try {
        const parsed = JSON.parse(body.toString());
        log("→ model", parsed.model, c.yellow);
        log("→ messages", `${parsed.messages?.length} message(s)`, c.yellow);
        if (parsed.messages) {
          parsed.messages.forEach((m, i) => {
            log(`→ msg[${i}]`, `[${m.role}] (${m.content?.length || 0} chars)`, c.yellow);
          });
        }

        // Dump full JSON to Desktop
        fs.writeFileSync(`/Users/aidankim/Desktop/req.json`, JSON.stringify(parsed, null, 2));
        log("→ dump", `saved req.json to Desktop`, c.cyan);

        // Dump readable text to Desktop
        const readableLines = [];
        readableLines.push(`MODEL: ${parsed.model}`);
        readableLines.push(`MESSAGES: ${parsed.messages?.length || 0}`);
        if (parsed.tools?.length) {
          readableLines.push(`TOOLS: ${parsed.tools.map(t => t.function?.name || t.name).join(", ")}`);
        }
        readableLines.push(`${"=".repeat(80)}\n`);
        if (parsed.messages) {
          parsed.messages.forEach((m, i) => {
            readableLines.push(`--- msg[${i}] [${m.role}] (${m.content?.length || 0} chars) ---`);
            readableLines.push(m.content || "");
            readableLines.push("");
          });
        }
        fs.writeFileSync(`/Users/aidankim/Desktop/req.txt`, readableLines.join("\n"));
        log("→ dump", `saved req.txt to Desktop`, c.cyan);

        if (parsed.tools?.length) {
          log("→ tools", `${parsed.tools.length} tools injected`, c.magenta);
          parsed.tools.forEach(t => log("  tool", t.function?.name || t.name, c.magenta));
        }
        if (parsed.options) {
          log("→ options", JSON.stringify(parsed.options), c.yellow);
        }
      } catch (e) {
        log("→ body", `(unparseable, ${body.length} bytes)`, c.yellow);
      }
    }

    log("→ forward", `to ollama (${body.length} bytes)`, c.dim);

    if (isChat) {
      res.writeHead(200, {
        "Content-Type": "application/x-ndjson",
        "Transfer-Encoding": "chunked",
      });
      log("→ 200 OK", "sent early to OpenClaw", c.green);

      let chunkCount = 0;
      let generatedText = "";
      let toolCallBuffer = "";
      let isCollectingToolCall = false;

      const keepaliveTimer = setInterval(() => {
        if (!res.writableEnded) {
          res.write(" ");
          log("♥ keepalive", `chunks so far: ${chunkCount} | tokens: ${generatedText.length}`, c.dim);
        }
      }, KEEPALIVE_INTERVAL_MS);

      const options = {
        hostname: OLLAMA_HOST,
        port: OLLAMA_PORT,
        path: req.url,
        method: req.method,
        headers: {
          ...req.headers,
          host: `${OLLAMA_HOST}:${OLLAMA_PORT}`,
          "content-length": body.length,
        },
      };

      const proxyReq = http.request(options, (proxyRes) => {
        log("← ollama", `responded: ${proxyRes.statusCode}`, c.green);

        if (proxyRes.statusCode !== 200) {
          clearInterval(keepaliveTimer);
          if (!res.writableEnded) res.end();
          return;
        }

        // Print a header for the streaming output
        console.log(`\n${c.bold}${c.green}━━━ OLLAMA GENERATING ━━━${c.reset}`);

        proxyRes.on("data", (chunk) => {
          if (!res.writableEnded) res.write(chunk);
          chunkCount++;

          // Parse each NDJSON line
          const lines = chunk.toString().split("\n").filter(l => l.trim());
          for (const line of lines) {
            try {
              const parsed = JSON.parse(line);

              // Stream token content in real time
              if (parsed.message?.content) {
                process.stdout.write(`${c.green}${parsed.message.content}${c.reset}`);
                generatedText += parsed.message.content;
              }

              // Detect tool calls
              if (parsed.message?.tool_calls) {
                isCollectingToolCall = true;
                console.log(`\n${c.magenta}${c.bold}[TOOL CALL DETECTED]${c.reset}`);
                parsed.message.tool_calls.forEach(tc => {
                  console.log(`${c.magenta}  → tool: ${tc.function?.name}${c.reset}`);
                  console.log(`${c.magenta}  → args: ${JSON.stringify(tc.function?.arguments)}${c.reset}`);
                });
              }

              // Log when done
              if (parsed.done) {
                console.log(`\n${c.bold}${c.green}━━━ DONE ━━━${c.reset}`);
                log("← stats", `chunks: ${chunkCount} | tokens generated: ${parsed.eval_count || "?"} | prompt tokens: ${parsed.prompt_eval_count || "?"}`, c.green);
                log("← duration", `${((parsed.total_duration || 0) / 1e9).toFixed(2)}s total | ${((parsed.eval_duration || 0) / 1e9).toFixed(2)}s eval`, c.green);
              }

            } catch (e) {
              // Not valid JSON, skip
            }
          }
        });

        proxyRes.on("end", () => {
          clearInterval(keepaliveTimer);
          if (!res.writableEnded) res.end();
          log("← stream", `ended (total chunks: ${chunkCount})`, c.cyan);
        });

        proxyRes.on("error", (err) => {
          clearInterval(keepaliveTimer);
          log("← error", err.message, c.red);
          if (!res.writableEnded) res.end();
        });
      });

      res.on("close", () => {
        clearInterval(keepaliveTimer);
        log("✕ client", "disconnected", c.red);
      });

      proxyReq.on("error", (err) => {
        clearInterval(keepaliveTimer);
        log("✕ proxy", err.message, c.red);
        if (!res.writableEnded) res.end();
      });

      proxyReq.write(body);
      proxyReq.end();

    } else {
      // Non-chat passthrough
      const options = {
        hostname: OLLAMA_HOST,
        port: OLLAMA_PORT,
        path: req.url,
        method: req.method,
        headers: {
          ...req.headers,
          host: `${OLLAMA_HOST}:${OLLAMA_PORT}`,
          "content-length": body.length,
        },
      };
      const proxyReq = http.request(options, (proxyRes) => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res);
      });
      proxyReq.on("error", (err) => {
        if (!res.headersSent) res.writeHead(502);
        if (!res.writableEnded) res.end(`Proxy error: ${err.message}`);
      });
      proxyReq.write(body);
      proxyReq.end();
    }
  });
});

server.listen(PROXY_PORT, "127.0.0.1", () => {
  console.log(`${c.bold}${c.cyan}[proxy] running on http://127.0.0.1:${PROXY_PORT}${c.reset}`);
  console.log(`${c.dim}[proxy] forwarding to Ollama at http://${OLLAMA_HOST}:${OLLAMA_PORT}${c.reset}`);
  console.log(`${c.dim}[proxy] keepalive every ${KEEPALIVE_INTERVAL_MS / 1000}s${c.reset}`);
});