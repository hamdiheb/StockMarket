# StockMarket API

Express server that proxies live market data to the front end, keeping API keys off the browser.

## Setup

```bash
cp .env.example .env   # then add your Alpaca keys
npm install
npm run dev            # http://localhost:4000, restarts on file changes
```

Get keys at https://app.alpaca.markets (a free paper-trading account works). The free plan uses the `iex` feed.

## Structure

```
server.js       app setup: dotenv, cors, routes, error handling
routes/         URL → controller mapping
controllers/    request validation and response shaping
services/       external API clients (Alpaca, Twelve Data, Finnhub)
middlewares/    error handler, 404, request logger
database/       reserved for persistence (not used yet)
```

## Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | Liveness check |
| GET | `/api/livedata/stocks?symbols=AAPL,MSFT` | Latest price, day OHLC, volume, previous close and change. Without `symbols` it returns the front end's default list. Cached 5s. |
| GET | `/api/livedata/stocks/:symbol/bars?range=1D` | Chart candles `{ t, o, h, l, c, v }` for `1D`, `1W`, `1M`, `1Y`, `5Y` |
| GET | `/api/livedata/forex?pairs=EUR/USD,GBP/USD` | Twelve Data rolling-24h snapshot per pair (price, open, high, low, change, 48-point `spark`). Default: 6 pairs. Cached 15 min. |
| GET | `/api/livedata/forex/:pair/bars?range=1D` | Forex candles (`:pair` as `EURUSD` or `EUR-USD`), `v` is always 0 |
| GET | `/api/livedata/crypto?symbols=BTC/USD,ETH/USD` | Alpaca crypto snapshot, same shape as stocks (`volume` in coins, day = UTC day). Without `symbols` it returns 9 default pairs. Cached 5s. |
| GET | `/api/livedata/crypto/:pair/bars?range=1D` | Crypto candles (`:pair` as `BTC-USD`); `1D` is the last 24 hours |
| GET | `/api/analysis/:type/:symbol` | AI trade signal (`type` = `stock` \| `forex` \| `crypto`, pairs as `EUR-USD` / `BTC-USD`). Cached 1 min; the model is asked at most once per 5-minute bar, and only when a pre-check finds a setup could pass. See below. |

## AI trade signals

`services/analysis.js` computes indicators (EMA 20/50/200, RSI, MACD, ATR, Bollinger, volume, support/resistance)
on four timeframes (1D 5-min, 1W 1-hour, 1M 4-hour, 1Y daily) and sends that summary — not raw candles — to an LLM:
Groq when `GROQ_API_KEY` is set, otherwise local Ollama. No RAG: the input is small, structured and fresh.

The model's answer is never trusted as-is. A BUY/SELL is `actionable` only if **every** check passes; otherwise the
response is `HOLD` with `standAsideReasons`:

- stop-loss / take-profit on the correct side of the entry, entry within 2 ATR of the current price
- model confidence ≥ `MIN_CONFIDENCE` (default 80)
- server-side setup score ≥ 80 (trend agreement across timeframes 40, RSI not exhausted 20, risk/reward ≥ 2 20, volume 20)
- RSI not overbought (BUY) / oversold (SELL), 1D and 1W trends not opposed
- market stable: no volatility spike (ATR > 1.5× its average), not choppy (≤ 6 EMA20 crosses in 20 bars)
- market open / data fresh

Entry, stop-loss and take-profit are only returned when `actionable` is true. Not financial advice.

Twelve Data's free plan allows 8 requests/min and 800/day (1 per pair). The server queues requests to
stay under the per-minute limit and caches heavily; a page load costs 6 credits at most every 15 minutes.
Live currency prices stream from Finnhub (OANDA) through the same WebSocket — subscribe with `"EUR/USD"`.
Crypto streams from Alpaca's crypto endpoint (a separate connection from stocks) — subscribe with `"BTC/USD"`;
the server tells crypto from currency pairs using Alpaca's crypto asset list. Trades on Alpaca's crypto venue
are minutes apart, so crypto prices also move on quotes (bid/ask midpoint, `size` 0).
EUR/TND isn't on Finnhub, so it only updates with the 15-minute snapshot.

## Real-time stream

WebSocket at `ws://localhost:4000/api/livedata/stream`. The server keeps **one** connection to Alpaca
(the free plan allows only one per account) and shares it between all browsers. Only origins in
`CORS_ORIGIN` may connect.

```jsonc
// browser → server
{ "action": "subscribe", "symbols": ["AAPL", "MSFT"] }
{ "action": "unsubscribe", "symbols": ["MSFT"] }

// server → browser
{ "type": "status", "state": "live", "message": "", "feed": "iex" }   // idle | connecting | live | reconnecting | error
{ "type": "subscribed", "symbols": ["AAPL"] }
{ "type": "trades", "data": [{ "symbol": "AAPL", "price": 343.1, "size": 100, "volume": 300, "t": 1792059118031 }] }
{ "type": "bar", "symbol": "AAPL", "bar": { "t": 1792059060000, "o": 343, "h": 343.2, "l": 342.9, "c": 343.1, "v": 1200 } }
{ "type": "error", "message": "Invalid symbol: $$" }
```

Trades are batched every 250 ms (latest price per symbol, `volume` = shares traded since the last batch).
Bars are 1-minute candles. If you run two servers with the same keys, the second gets
`connection limit reached` — stop the other one.

Errors are returned as `{ "error": "message" }`: 400 for bad input, 503 when keys are missing, 502/504 when Alpaca fails, 429 when its rate limit is hit.
