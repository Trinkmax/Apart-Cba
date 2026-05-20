import { config } from "./config";
import { logger } from "./logger";
import { buildServer } from "./server";
import { sessionManager } from "./session-manager";

async function main() {
  const app = buildServer();
  const server = app.listen(config.port, () => {
    logger.info({ port: config.port }, "wa-gateway listening");
  });

  // Resume sessions that were online before this boot (durable creds in DB).
  await sessionManager.recoverAll();

  // Railway sends SIGTERM on redeploy — close sockets cleanly WITHOUT wiping
  // auth state, so the next boot resumes silently (no re-scan).
  const stop = (sig: string) => {
    logger.info({ sig }, "shutting down");
    sessionManager.shutdownAll();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 8000).unref();
  };
  process.on("SIGTERM", () => stop("SIGTERM"));
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("unhandledRejection", (reason) =>
    logger.error({ reason: String(reason) }, "unhandledRejection"),
  );
}

void main();
