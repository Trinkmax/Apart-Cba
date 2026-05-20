import pino from "pino";
import { config } from "./config";

export const logger = pino({
  level: config.logLevel,
  base: { svc: "wa-gateway" },
  timestamp: pino.stdTimeFunctions.isoTime,
});

/** Baileys is extremely chatty at debug; give it its own silent-ish child. */
export const baileysLogger = logger.child({ mod: "baileys" }, { level: "warn" });
