import app from "./app";
import { logger } from "./lib/logger";
import { initContinuousTrader } from "./lib/continuousTrader";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);
if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }
  logger.info({ port }, "Server listening");
  // Debug: log whether MEXC keys are present (not values)
  logger.info({
    mexcKeyLen: (process.env["MEXC_API_KEY"] ?? "").length,
    mexcSecretLen: (process.env["MEXC_API_SECRET"] ?? "").length,
    mexcKeyPrefix: (process.env["MEXC_API_KEY"] ?? "").substring(0, 4),
  }, "MEXC credential check at startup");
  initContinuousTrader().catch(e => logger.error(e, "CT init failed"));
});
