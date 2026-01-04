import "dotenv/config";
import fs from "fs";
import path from "path";
import ccxt from "ccxt";

/**
 * ---------- Env ----------
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function numberEnv(name: string): number {
  const value = Number(requireEnv(name));
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid numeric env var: ${name}`);
  }
  return value;
}

function booleanEnv(name: string): boolean {
  const value = requireEnv(name);
  if (value === "true") {
    return true;
  } else if (value === "false") {
    return false;
  } else {
    throw new Error(`Invalid boolean env var: ${name}`);
  }
}

/**
 * ---------- Configuration ----------
 */

const API_KEY = requireEnv("KRAKEN_API_KEY");
const API_SECRET = requireEnv("KRAKEN_API_SECRET");

const HOURLY_BUDGET_USD = numberEnv("HOURLY_BUDGET_USD");

const PAIR = requireEnv("PAIR");
const IS_DRY_RUN = booleanEnv("IS_DRY_RUN");

/**
 * ---------- Logs ----------
 */

function getLogFile() {
  const date = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
  const logsDir = path.resolve(IS_DRY_RUN ? "./logs/dry" : "./logs/real");
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir);
  }
  return path.join(logsDir, `${date}.json`);
}

const currentRunTimestamp = new Date().toISOString();
const LOG_FILE = getLogFile();

function logToFile(message: string, meta: Record<string, unknown> = {}) {
  let logs: Record<string, any[]> = {};

  if (fs.existsSync(LOG_FILE)) {
    try {
      const content = fs.readFileSync(LOG_FILE, "utf-8");
      logs = content ? JSON.parse(content) : {};
    } catch (err) {
      console.error("Failed to read log file, starting fresh:", err);
      logs = {};
    }
  }

  if (!logs[currentRunTimestamp]) {
    logs[currentRunTimestamp] = [];
  }

  logs[currentRunTimestamp].push({
    timestamp: new Date().toISOString(),
    message,
    ...meta,
  });

  fs.writeFileSync(LOG_FILE, JSON.stringify(logs, null, 2), "utf-8");
}

/**
 * ---------- Exchange ----------
 */

const exchange = new ccxt.kraken({
  apiKey: API_KEY,
  secret: API_SECRET,
  enableRateLimit: true,
});

/**
 * ---------- Core Logic ----------
 */

async function runDca() {
  logToFile("Starting DCA run", {
    PAIR,
    HOURLY_BUDGET_USD,
    IS_DRY_RUN,
  });

  await exchange.loadMarkets();

  const market = exchange.markets[PAIR];

  if (!market) {
    throw new Error(`Market not found: ${PAIR}`);
  }

  // 1. Fetch balance
  const balance = await exchange.fetchBalance();
  const usdBalance = balance.USD.free ?? 0;

  logToFile("Fetched balance", { usdBalance });

  if (usdBalance < HOURLY_BUDGET_USD) {
    logToFile("Insufficient USD balance, skipping buy", {
      required: HOURLY_BUDGET_USD,
      available: usdBalance,
    });
    return;
  }

  // 2. Fetch price
  const ticker = await exchange.fetchTicker(PAIR);
  const price = ticker.ask;

  if (!price || price <= 0) {
    throw new Error("Invalid price from ticker");
  }

  // 3. Calculate order size (base currency)
  const desiredAmountRounded = Number(exchange.amountToPrecision(PAIR, HOURLY_BUDGET_USD / price));
  const minimumRequiredAmount: number = market.limits.amount.min ?? 0;
  const cryptoAmount = Math.max(desiredAmountRounded, minimumRequiredAmount);

  logToFile("Calculated order", {
    price,
    cryptoAmount,
    notionalUsd: price * cryptoAmount,
  });

  // // 4. Dry run
  if (IS_DRY_RUN) {
    logToFile("Dry run enabled — order NOT placed");
    return;
  }

  // 5. Place market order
  const order = await exchange.createMarketBuyOrder(PAIR, cryptoAmount);

  logToFile("Order placed successfully", {
    orderId: order.id,
    filled: order.filled,
    cost: order.cost,
    average: order.average,
  });
}

/**
 * ---------- Entrypoint ----------
 */

(async () => {
  try {
    await runDca();
    logToFile("DCA run completed", { success: true });
  } catch (err) {
    logToFile("DCA run failed", {
      err,
    });
    process.exit(1);
  }
})();
