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
services/       external API clients (Alpaca)
middlewares/    error handler, 404, request logger
database/       reserved for persistence (not used yet)
```

## Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | Liveness check |
| GET | `/api/livedata/stocks?symbols=AAPL,MSFT` | Latest price, day OHLC, volume, previous close and change. Without `symbols` it returns the front end's default list. Cached 5s. |
| GET | `/api/livedata/stocks/:symbol/bars?range=1D` | Chart candles `{ t, o, h, l, c, v }` for `1D`, `1W`, `1M`, `1Y`, `5Y` |

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
