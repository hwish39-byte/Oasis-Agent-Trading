import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { nowIso } from "../../../../packages/shared/src/index.mjs";
import { assertMarketContext } from "./schemas.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const legacySnapshotPath = resolve(__dirname, "../../../../data/snapshots/eth-breakout.json");

const BINANCE_INTERVALS = Object.freeze({
  "15m": "15m",
  "30m": "30m",
  "1h": "1h",
  "4h": "4h",
  "1d": "1d",
  "1w": "1w"
});

const STABLE_QUOTES = ["USDT", "USDC", "USD"];

export class MarketContextBuilder {
  constructor({
    marketDataProvider = createDefaultMarketDataProvider(),
    clock = nowIso
  } = {}) {
    this.marketDataProvider = marketDataProvider;
    this.clock = clock;
  }

  async build({ asset, intent, strategyDraft, timeframe } = {}) {
    const resolvedAsset = normalizeAsset(asset ?? intent?.asset ?? strategyDraft?.asset ?? "ETH");
    const resolvedTimeframe = normalizeTimeframe(timeframe ?? intent?.timeframe ?? strategyDraft?.timeframe ?? "4h");
    const liveSignal = await this.marketDataProvider.getSignal({
      asset: resolvedAsset,
      timeframe: resolvedTimeframe,
      strategyType: intent?.strategyType ?? strategyDraft?.strategyType
    });

    return assertMarketContext({
      asset: resolvedAsset,
      source: liveSignal.source,
      observedAt: this.clock(),
      snapshot: liveSignal,
      regime: inferMarketRegime(liveSignal),
      quality: {
        isFresh: liveSignal.isFresh !== false,
        warnings: liveSignal.warnings ?? []
      }
    });
  }
}

export function createDefaultMarketDataProvider() {
  if (process.env.OASIS_MARKET_DATA_MODE === "fixture") {
    return new FixedSnapshotMarketDataProvider();
  }

  return new CompositeMarketDataProvider({
    providers: [
      new BinanceMarketDataProvider(),
      new CoinGeckoMarketDataProvider()
    ]
  });
}

export class CompositeMarketDataProvider {
  constructor({ providers, fallbackProvider = new FixedSnapshotMarketDataProvider() }) {
    this.providers = providers;
    this.fallbackProvider = fallbackProvider;
  }

  async getSignal(params) {
    const errors = [];

    for (const provider of this.providers) {
      try {
        return await provider.getSignal(params);
      } catch (error) {
        errors.push(`${provider.constructor.name}: ${error.message}`);
      }
    }

    const fallbackSignal = await this.fallbackProvider.getSignal(params);
    return {
      ...fallbackSignal,
      source: "local_snapshot_live_fallback",
      isFresh: false,
      warnings: [
        ...(fallbackSignal.warnings ?? []),
        `live market data fallback used: ${errors.join(" | ")}`
      ]
    };
  }
}

export class BinanceMarketDataProvider {
  constructor({
    baseUrl = "https://api.binance.com",
    quoteAsset = "USDT",
    fetchImpl = fetch,
    klineLimit = 80
  } = {}) {
    this.baseUrl = baseUrl;
    this.quoteAsset = quoteAsset;
    this.fetch = fetchImpl;
    this.klineLimit = klineLimit;
  }

  async getSignal({ asset, timeframe = "4h", strategyType = "breakout" } = {}) {
    const resolvedAsset = normalizeAsset(asset);
    const interval = BINANCE_INTERVALS[normalizeTimeframe(timeframe)] ?? "4h";
    const symbol = toBinanceSymbol(resolvedAsset, this.quoteAsset);
    const [ticker, klines] = await Promise.all([
      this.fetchJson(`/api/v3/ticker/24hr?symbol=${symbol}`),
      this.fetchJson(`/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${this.klineLimit}`)
    ]);

    const candles = klines.map(parseKline).filter(Boolean);
    if (candles.length < 20) {
      throw new Error(`Live market provider returned too few candles for ${symbol} ${interval}`);
    }

    return buildSignalFromCandles({
      asset: resolvedAsset,
      timeframe: normalizeTimeframe(timeframe),
      strategyType,
      symbol,
      ticker,
      candles,
      source: "binance_public_api"
    });
  }

  async fetchJson(pathname) {
    const response = await this.fetch(`${this.baseUrl}${pathname}`);
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(`Binance market data failed with ${response.status}: ${JSON.stringify(payload)}`);
    }

    return payload;
  }
}

export class CoinGeckoMarketDataProvider {
  constructor({
    baseUrl = "https://api.coingecko.com/api/v3",
    fetchImpl = fetch
  } = {}) {
    this.baseUrl = baseUrl;
    this.fetch = fetchImpl;
  }

  async getSignal({ asset, timeframe = "4h", strategyType = "breakout" } = {}) {
    const resolvedAsset = normalizeAsset(asset);
    const coinId = toCoinGeckoId(resolvedAsset);
    const resolvedTimeframe = normalizeTimeframe(timeframe);
    const days = resolvedTimeframe === "15m" || resolvedTimeframe === "30m" || resolvedTimeframe === "1h" ? 2 : 30;
    const marketChart = await this.fetchJson(`/coins/${coinId}/market_chart?vs_currency=usd&days=${days}`);
    const candles = buildCandlesFromCoinGeckoPrices(marketChart.prices, marketChart.total_volumes);

    if (candles.length < 20) {
      throw new Error(`CoinGecko returned too few market points for ${resolvedAsset}`);
    }

    return buildSignalFromCandles({
      asset: resolvedAsset,
      timeframe: resolvedTimeframe,
      strategyType,
      symbol: `${resolvedAsset}USD`,
      ticker: {
        priceChangePercent: estimatePercentChange(candles)
      },
      candles,
      source: "coingecko_public_api"
    });
  }

  async fetchJson(pathname) {
    const response = await this.fetch(`${this.baseUrl}${pathname}`);
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(`CoinGecko market data failed with ${response.status}: ${JSON.stringify(payload)}`);
    }

    return payload;
  }
}

export class FixedSnapshotMarketContextBuilder extends MarketContextBuilder {
  constructor({ snapshotPath = legacySnapshotPath, clock = nowIso } = {}) {
    super({ marketDataProvider: null, clock });
    this.snapshotPath = snapshotPath;
  }

  async build({ asset, intent, strategyDraft, timeframe } = {}) {
    const snapshot = JSON.parse(await readFile(this.snapshotPath, "utf8"));
    const resolvedAsset = normalizeAsset(asset ?? intent?.asset ?? strategyDraft?.asset ?? snapshot.asset);
    const resolvedTimeframe = normalizeTimeframe(timeframe ?? intent?.timeframe ?? strategyDraft?.timeframe ?? snapshot.timeframe);
    const warnings = [];

    if (snapshot.asset !== resolvedAsset) {
      warnings.push(`snapshot asset ${snapshot.asset} does not match requested asset ${resolvedAsset}`);
    }

    if (snapshot.timeframe !== resolvedTimeframe) {
      warnings.push(`snapshot timeframe ${snapshot.timeframe} does not match requested timeframe ${resolvedTimeframe}`);
    }

    return assertMarketContext({
      asset: resolvedAsset,
      source: "local_snapshot_test_fixture",
      observedAt: this.clock(),
      snapshot: {
        ...snapshot,
        asset: resolvedAsset,
        timeframe: resolvedTimeframe,
        source: "local_snapshot_test_fixture",
        warnings
      },
      regime: inferMarketRegime(snapshot),
      quality: {
        isFresh: true,
        warnings
      }
    });
  }
}

export class FixedSnapshotMarketDataProvider {
  constructor({ snapshotPath = legacySnapshotPath } = {}) {
    this.snapshotPath = snapshotPath;
  }

  async getSignal({ asset, timeframe = "4h", strategyType = "breakout" } = {}) {
    const snapshot = JSON.parse(await readFile(this.snapshotPath, "utf8"));
    const resolvedAsset = normalizeAsset(asset ?? snapshot.asset);
    const resolvedTimeframe = normalizeTimeframe(timeframe ?? snapshot.timeframe);

    return {
      ...snapshot,
      asset: resolvedAsset,
      timeframe: resolvedTimeframe,
      strategyType,
      source: "local_snapshot_test_fixture",
      isFresh: true,
      warnings: snapshot.asset === resolvedAsset ? [] : [
        `fixture snapshot asset ${snapshot.asset} does not match requested asset ${resolvedAsset}`
      ]
    };
  }
}

export function buildSignalFromCandles({
  asset,
  timeframe,
  strategyType = "breakout",
  symbol,
  ticker,
  candles,
  source = "computed_market_data"
}) {
  const closes = candles.map((candle) => candle.close);
  const volumes = candles.map((candle) => candle.volume);
  const last = candles.at(-1);
  const previous = candles.at(-2);
  const recent = candles.slice(-20);
  const recentHigh = Math.max(...recent.slice(0, -1).map((candle) => candle.high));
  const recentLow = Math.min(...recent.slice(0, -1).map((candle) => candle.low));
  const smaFast = average(closes.slice(-10));
  const smaSlow = average(closes.slice(-30));
  const recentVolume = average(volumes.slice(-5));
  const baselineVolume = average(volumes.slice(-30, -5));
  const priceChangePercent = Number(ticker.priceChangePercent ?? (((last.close - candles.at(-25)?.close) / candles.at(-25)?.close) * 100));
  const breakoutDistance = recentHigh > 0 ? ((last.close - recentHigh) / recentHigh) * 100 : 0;
  const rangePosition = recentHigh === recentLow ? 0.5 : (last.close - recentLow) / (recentHigh - recentLow);
  const trendStrength = clamp(((smaFast - smaSlow) / smaSlow) * 100, -8, 8);
  const volumeRatio = baselineVolume > 0 ? recentVolume / baselineVolume : 1;
  const momentum = inferMomentum({ last, previous, smaFast, smaSlow, priceChangePercent });
  const volumeConfirmation = volumeRatio >= 1.25 ? "strong" : volumeRatio <= 0.85 ? "weak" : "mixed";
  const breakoutScore = scoreBreakout({ breakoutDistance, rangePosition, trendStrength, volumeRatio });
  const confidence = scoreConfidence({ breakoutScore, volumeConfirmation, momentum, trendStrength });
  const recommendation = recommend({ confidence, momentum, strategyType });

  return {
    asset,
    symbol,
    timeframe,
    source,
    spotPriceUsd: Number(last.close.toFixed(4)),
    priceChangePercent24h: Number(priceChangePercent.toFixed(2)),
    lastCandleChangePercent: Number((((last.close - previous.close) / previous.close) * 100).toFixed(2)),
    momentum,
    volumeConfirmation,
    volumeRatio: Number(volumeRatio.toFixed(2)),
    breakoutScore,
    confidence,
    recommendation,
    strategyType,
    technicals: {
      smaFast: Number(smaFast.toFixed(4)),
      smaSlow: Number(smaSlow.toFixed(4)),
      recentHigh: Number(recentHigh.toFixed(4)),
      recentLow: Number(recentLow.toFixed(4)),
      rangePosition: Number(rangePosition.toFixed(2))
    },
    summary: summarizeSignal({
      asset,
      timeframe,
      recommendation,
      momentum,
      breakoutScore,
      volumeConfirmation,
      spotPriceUsd: last.close
    }),
    isFresh: true,
    warnings: []
  };
}

function parseKline(kline) {
  if (!Array.isArray(kline) || kline.length < 6) return null;
  return {
    openTime: kline[0],
    open: Number(kline[1]),
    high: Number(kline[2]),
    low: Number(kline[3]),
    close: Number(kline[4]),
    volume: Number(kline[5])
  };
}

function buildCandlesFromCoinGeckoPrices(prices = [], volumes = []) {
  const volumeByTime = new Map(volumes.map(([time, volume]) => [time, Number(volume)]));
  return prices
    .map(([time, price], index) => {
      const close = Number(price);
      const previousClose = Number(prices[index - 1]?.[1] ?? close);
      const high = Math.max(close, previousClose);
      const low = Math.min(close, previousClose);

      return {
        openTime: time,
        open: previousClose,
        high,
        low,
        close,
        volume: volumeByTime.get(time) ?? 0
      };
    })
    .filter((candle) => Number.isFinite(candle.close));
}

function estimatePercentChange(candles) {
  const last = candles.at(-1)?.close;
  const prior = candles.at(-25)?.close ?? candles[0]?.close;
  if (!last || !prior) return "0";
  return String(((last - prior) / prior) * 100);
}

function inferMomentum({ last, previous, smaFast, smaSlow, priceChangePercent }) {
  const lastMove = ((last.close - previous.close) / previous.close) * 100;
  const trendPositive = smaFast > smaSlow && priceChangePercent > 0;
  const trendNegative = smaFast < smaSlow && priceChangePercent < 0;

  if (trendPositive && lastMove >= -1.5) return "positive";
  if (trendNegative && lastMove <= 1.5) return "negative";
  return "neutral";
}

function scoreBreakout({ breakoutDistance, rangePosition, trendStrength, volumeRatio }) {
  const distanceScore = clamp(50 + breakoutDistance * 14, 0, 100);
  const rangeScore = clamp(rangePosition * 100, 0, 100);
  const trendScore = clamp(50 + trendStrength * 6, 0, 100);
  const volumeScore = clamp(45 + (volumeRatio - 1) * 35, 0, 100);
  return clamp(Math.round(distanceScore * 0.25 + rangeScore * 0.3 + trendScore * 0.25 + volumeScore * 0.2), 0, 100);
}

function scoreConfidence({ breakoutScore, volumeConfirmation, momentum, trendStrength }) {
  const volumeBoost = volumeConfirmation === "strong" ? 0.08 : volumeConfirmation === "weak" ? -0.08 : 0;
  const momentumBoost = momentum === "positive" ? 0.06 : momentum === "negative" ? -0.06 : 0;
  const trendBoost = clamp(trendStrength / 100, -0.04, 0.04);
  return Number(clamp(breakoutScore / 100 + volumeBoost + momentumBoost + trendBoost, 0.05, 0.95).toFixed(2));
}

function recommend({ confidence, momentum, strategyType }) {
  if (strategyType === "mean_reversion") {
    if (confidence >= 0.68 && momentum === "negative") return "buy";
    return confidence >= 0.55 ? "hold" : "avoid";
  }

  if (confidence >= 0.72 && momentum === "positive") return "buy";
  if (confidence <= 0.35 || momentum === "negative") return "avoid";
  return "hold";
}

function summarizeSignal({ asset, timeframe, recommendation, momentum, breakoutScore, volumeConfirmation, spotPriceUsd }) {
  return `${asset} ${timeframe} live signal is ${recommendation}; price ${spotPriceUsd.toFixed(2)}, momentum ${momentum}, breakout score ${breakoutScore}, volume confirmation ${volumeConfirmation}.`;
}

function inferMarketRegime(signal) {
  if (signal.momentum === "positive" && signal.breakoutScore >= 70) {
    return "trend_up_breakout";
  }

  if (signal.momentum === "negative" && signal.breakoutScore <= 40) {
    return "risk_off_or_breakdown";
  }

  if (signal.volumeConfirmation === "weak") {
    return "constructive_but_unconfirmed";
  }

  return "mixed";
}

function normalizeAsset(asset = "ETH") {
  return String(asset).trim().toUpperCase().replace(/[^A-Z0-9]/g, "") || "ETH";
}

function normalizeTimeframe(timeframe = "4h") {
  const value = String(timeframe).trim().toLowerCase();
  return BINANCE_INTERVALS[value] ? value : "4h";
}

function toBinanceSymbol(asset, quoteAsset) {
  const normalizedAsset = normalizeAsset(asset);
  const normalizedQuote = normalizeAsset(quoteAsset);
  if (STABLE_QUOTES.some((quote) => normalizedAsset.endsWith(quote))) return normalizedAsset;
  return `${normalizedAsset}${normalizedQuote}`;
}

function toCoinGeckoId(asset) {
  const ids = {
    BTC: "bitcoin",
    ETH: "ethereum",
    SOL: "solana",
    HBAR: "hedera-hashgraph",
    LINK: "chainlink",
    AVAX: "avalanche-2",
    BNB: "binancecoin",
    XRP: "ripple"
  };

  const id = ids[normalizeAsset(asset)];
  if (!id) throw new Error(`No CoinGecko id configured for ${asset}`);
  return id;
}

function average(values) {
  const valid = values.filter((value) => Number.isFinite(value));
  if (valid.length === 0) return 0;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
