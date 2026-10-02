import { createCoreRuntimeHttpServer } from "../src/platform/core-runtime-http-server.js";

const host = process.env.ANGELANEXUS_CORE_HOST || "127.0.0.1";
const port = Number.parseInt(process.env.ANGELANEXUS_CORE_PORT || "18181", 10);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("ANGELANEXUS_CORE_PORT must be a valid TCP port");
}

const server = createCoreRuntimeHttpServer();
server.listen(port, host, () => {
  process.stdout.write("AngelaNexus Core runtime listening on http://" + host + ":" + port + "\n");
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
