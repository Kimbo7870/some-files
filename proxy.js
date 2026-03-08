const http = require("http");

const PROXY_PORT = 11435;
const OLLAMA_HOST = "127.0.0.1";
const OLLAMA_PORT = 11434;
const KEEPALIVE_INTERVAL_MS = 30_000;

const server = http.createServer((req, res) => {
  const isChat = req.url === "/api/chat" && req.method === "POST";
  console.log(`[proxy] → incoming: ${req.method} ${req.url}`);
  const bodyChunks = [];
  req.on("data", (chunk) => bodyChunks.push(chunk));
  req.on("end", () => {
    const body = Buffer.concat(bodyChunks);
    console.log(`[proxy] → forwarding to ollama (${body.length} bytes)`);

    if (isChat) {
      // Immediately send 200 OK with chunked encoding
      // This prevents OpenClaw's "no response" timeout
      res.writeHead(200, {
        "Content-Type": "application/x-ndjson",
        "Transfer-Encoding": "chunked",
      });
      console.log(`[proxy] → sent early 200 OK to OpenClaw`);

      // Start keepalive immediately
      let chunkCount = 0;
      const keepaliveTimer = setInterval(() => {
        if (!res.writableEnded) {
          res.write(" ");
          console.log(`[keepalive] ${new Date().toISOString()} (ollama chunks so far: ${chunkCount})`);
        }
      }, KEEPALIVE_INTERVAL_MS);

      const options = {
        hostname: OLLAMA_HOST, port: OLLAMA_PORT, path: req.url, method: req.method,
        headers: { ...req.headers, host: `${OLLAMA_HOST}:${OLLAMA_PORT}`, "content-length": body.length },
      };

      const proxyReq = http.request(options, (proxyRes) => {
        console.log(`[proxy] ← ollama responded: ${proxyRes.statusCode}`);

        if (proxyRes.statusCode !== 200) {
          clearInterval(keepaliveTimer);
          if (!res.writableEnded) res.end();
          return;
        }

        proxyRes.on("data", (chunk) => {
          if (!res.writableEnded) res.write(chunk);
          chunkCount++;
          if (chunkCount <= 3) console.log(`[proxy] ← chunk #${chunkCount}: ${chunk.toString().slice(0, 80)}`);
        });

        proxyRes.on("end", () => {
          clearInterval(keepaliveTimer);
          if (!res.writableEnded) res.end();
          console.log(`[proxy] ← stream ended (total chunks: ${chunkCount})`);
        });

        proxyRes.on("error", (err) => {
          clearInterval(keepaliveTimer);
          console.error(`[proxy] upstream error: ${err.message}`);
          if (!res.writableEnded) res.end();
        });
      });

      res.on("close", () => {
        clearInterval(keepaliveTimer);
        console.log(`[proxy] client disconnected`);
      });

      proxyReq.on("error", (err) => {
        clearInterval(keepaliveTimer);
        console.error(`[proxy] error: ${err.message}`);
        if (!res.writableEnded) res.end();
      });

      proxyReq.write(body);
      proxyReq.end();

    } else {
      // Non-chat: pass through normally
      const options = {
        hostname: OLLAMA_HOST, port: OLLAMA_PORT, path: req.url, method: req.method,
        headers: { ...req.headers, host: `${OLLAMA_HOST}:${OLLAMA_PORT}`, "content-length": body.length },
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
  console.log(`[proxy] running on http://127.0.0.1:${PROXY_PORT}`);
  console.log(`[proxy] forwarding to Ollama at http://${OLLAMA_HOST}:${OLLAMA_PORT}`);
  console.log(`[proxy] keepalive every ${KEEPALIVE_INTERVAL_MS/1000}s`);
  console.log(`[proxy] mode: immediate 200 OK + keepalive spaces`);
});