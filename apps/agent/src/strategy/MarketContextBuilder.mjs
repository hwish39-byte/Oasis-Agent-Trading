import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { nowIso } from "../../../../packages/shared/src/index.mjs";
import { assertMarketContext } from "./schemas.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const defaultSnapshotPath = resolve(__dirname, "../../../../data/snapshots/eth-breakout.json");

export class MarketContextBuilder {
  constructor({ snapshotPath = defaultSnapshotPath, clock = nowIso } = {}) {
    this.snapshotPath = snapshotPath;
    this.clock = clock;
  }

  async build({ asset }) {
    const snapshot = JSON.parse(await readFile(this.snapshotPath, "utf8"));
    const warnings = [];

    if (snapshot.asset !== asset) {
      warnings.push(`snapshot asset ${snapshot.asset} does not match requested asset ${asset}`);
    }

    for (const field of ["spotPriceUsd", "timeframe", "momentum", "volumeConfirmation", "breakoutScore", "confidence", "recommendation"]) {
      if (snapshot[field] === undefined) {
        warnings.push(`snapshot is missing ${field}`);
      }
    }

    return assertMarketContext({
      asset,
      source: "local_snapshot",
      observedAt: this.clock(),
      snapshot,
      regime: inferMarketRegime(snapshot),
      quality: {
        isFresh: true,
        warnings
      }
    });
  }
}

function inferMarketRegime(snapshot) {
  if (snapshot.momentum === "positive" && snapshot.breakoutScore >= 70) {
    return "trend_up_breakout";
  }

  if (snapshot.volumeConfirmation === "weak") {
    return "constructive_but_unconfirmed";
  }

  return "mixed";
}
