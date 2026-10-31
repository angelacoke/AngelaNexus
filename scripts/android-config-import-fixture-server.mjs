import https from "node:https";
import fs from "node:fs";

const port = Number(process.env.UI_FIXTURE_PORT ?? 18443);
const certPath = process.env.UI_FIXTURE_CERT;
const keyPath = process.env.UI_FIXTURE_KEY;
if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("UI_FIXTURE_PORT must be a valid TCP port");
if (!certPath || !keyPath) throw new Error("UI_FIXTURE_CERT and UI_FIXTURE_KEY are required");
const fixturePath = process.env.UI_FIXTURE_CONTENT_PATH;
if (!fixturePath) throw new Error("UI_FIXTURE_CONTENT_PATH is required");
const expectedHost = `10.0.2.2:${port}`;
const body = fs.readFileSync(fixturePath, "utf8").trim();
if (!body) throw new Error("UI fixture content file is empty");
let requestCount = 0;
let rejectedRequestCount = 0;
const server = https.createServer({ cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) }, (request, response) => {
  if (request.headers.host !== expectedHost || request.method !== "GET" || request.url !== "/subscription") {
    rejectedRequestCount += 1;
    console.error(`Rejected unexpected fixture request: host=${request.headers.host} ${request.method} ${request.url}`);
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("not found");
    return;
  }
  requestCount += 1;
  console.log(`served fixed subscription fixture (request ${requestCount})`);
  response.writeHead(200, {
    "content-type": "text/plain; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  response.end(body);
});
server.listen(port, "127.0.0.1", () => {
  console.log(`loopback UI fixture ready on 127.0.0.1:${port}; only GET https://${expectedHost}/subscription returns the fixed fixture`);
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => {
    console.log(`fixture server stopped; subscription requests served=${requestCount}; rejected requests=${rejectedRequestCount}`);
    process.exit(rejectedRequestCount === 0 ? 0 : 1);
  }));
}
