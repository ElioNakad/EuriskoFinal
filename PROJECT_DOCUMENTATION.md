# Eurisko Final Project Documentation

## 1. Big Picture

Eurisko Final is a NestJS backend for a stock-trading style application. It handles member registration, OTP verification, JWT login, wallet deposits through Stripe, withdrawals, stock management, market buy/sell orders, portfolio summaries, transaction history, and stock price alerts.

At a high level, the system combines:

- A REST API for authentication, wallet actions, stock lookup/management, alerts, and portfolio summaries.
- A Socket.IO gateway for real-time market buy and sell order actions.
- MongoDB for permanent business data.
- Redis for temporary state and short-lived cache.
- RabbitMQ for stock price update events.
- Nodemailer for OTP, payment success, and stock alert emails.
- Stripe Checkout and webhooks for wallet funding.

The app is packaged as a Docker Compose stack with services for the NestJS API, MongoDB replica set, Redis, and RabbitMQ.

## 2. Runtime Architecture

The application starts in `src/main.ts`. It creates the Nest app with raw request bodies enabled, installs a global validation pipe, then listens on `PORT` or `3000`.

Raw request body support is important because Stripe webhook verification requires the exact raw payload.

The root module is `src/app.module.ts`. It loads environment variables globally, connects Mongoose to `MONGO_URI`, then imports the application modules:

- `AuthModule`
- `UsersModule`
- `StocksModule`
- `WalletsModule`
- `OrdersModule`
- `RabbitMqModule`
- `StockAlertsModule`

The main request validation behavior is:

- Unknown DTO fields are stripped with `whitelist: true`.
- Unknown DTO fields are rejected with `forbidNonWhitelisted: true`.
- Query/body values are transformed into DTO target types with `transform: true`.

## 3. External Services

### MongoDB

MongoDB stores durable application data:

- Users
- Wallets
- Wallet transactions
- Withdrawal requests
- Stocks
- Stock history snapshots
- Buy orders
- Sell orders
- Stock alerts

The Docker setup runs MongoDB as a single-node replica set so Mongoose transactions can work.

### Redis

Redis is used for temporary and cached data:

- Pending signup data: `signup:{email}`
- OTP-verified signup data: `verified:{email}`
- Cached portfolio summaries: `portfolio-summary:{userId}`

The `RedisService` serializes values as JSON and stores them with explicit TTL values.

### RabbitMQ

RabbitMQ carries stock price update events.

The current event channel is:

- Exchange: `stock.price`
- Routing key: `stock.price.updated`
- Queue: `stock-alerts.price-updated`

When a stock price changes, `StocksService` publishes an event. `StockAlertsService` consumes the event and triggers any crossed alerts.

### Stripe

Stripe Checkout is used to create wallet deposit sessions. Stripe webhooks confirm successful payments and update wallet balances.

Required Stripe configuration:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`

### Email

Nodemailer is configured with Gmail credentials.

Email is used for:

- OTP codes during registration
- Wallet payment success confirmations
- Triggered stock alert notifications

Required email configuration:

- `EMAIL`
- `EMAIL_PASS`

## 4. Project Layout

```text
src/
  app.module.ts
  main.ts
  auth/
  users/
  stocks/
  wallets/
  orders/
  stock-alerts/
  redis/
  rabbitmq/
  mail/
  common/
  types/
test/
docker-compose.yml
Dockerfile
package.json
```

The code is organized by business capability. Each major domain module owns its controller, service, DTOs, schemas, and tests where present.

## 5. Authentication And Users

Authentication is implemented in `src/auth`.

### Signup Flow

Signup is intentionally staged:

1. `POST /auth/register`
2. User data and generated OTP are stored in Redis under `signup:{email}` for 10 minutes.
3. OTP is sent by email.
4. `POST /auth/verify-otp`
5. Verified signup data is moved to Redis under `verified:{email}` for 10 minutes.
6. `POST /auth/set-password`
7. Password is hashed with bcrypt.
8. A permanent user is created in MongoDB.
9. Temporary Redis verification data is deleted.

Users must be at least 18 years old. Duplicate email and national ID values are rejected.

### Login Flow

`POST /auth/login` checks the user's email and bcrypt password. On success, it returns:

- A JWT access token.
- Basic user data.
- `requiresWalletFunding`, based on whether the user already has a wallet.

JWT payloads include:

- `sub`: user ID
- `email`: user email

Tokens are configured to expire in 7 days.

### User Model

Stored in `src/users/schemas/user.schema.ts`.

Fields:

- `fullName`
- `email`
- `nationalId`
- `dateOfBirth`
- `password`
- `role`, default `member`
- `isActive`, default `true`

Indexes exist for `email` and `nationalId`.

## 6. Guards And WebSocket Authentication

HTTP endpoints use `JwtAuthGuard`. It expects:

```text
Authorization: Bearer <token>
```

The guard verifies the JWT and attaches:

```ts
request.user = {
  userId: payload.sub,
  email: payload.email,
};
```

WebSocket events use `WsJwtAuthGuard`. It accepts the token from either:

- `client.handshake.auth.token`
- `client.handshake.headers.authorization`

Unauthenticated socket clients are disconnected during initial connection, and unauthorized event calls emit either `order_rejected` or `portfolio_summary_error`.

## 7. Wallets And Payments

Wallet logic is implemented in `src/wallets`.

### Wallet Model

Fields:

- `userId`: unique reference to `User`
- `balance`: numeric balance, default `0`
- `lastDepositAt`: date of last successful deposit

Each user can have one wallet.

### Deposit Flow

1. Authenticated user calls `POST /wallet/deposit-session`.
2. Backend creates a Stripe Checkout session.
3. Stripe redirects the user to payment.
4. Stripe sends `checkout.session.completed` to `POST /wallet/webhook`.
5. Backend verifies the webhook signature.
6. Inside a Mongo transaction:
   - Creates or updates the wallet.
   - Increments wallet balance.
   - Stores a completed wallet transaction.
7. Sends payment success email.

Wallet deposit transactions store Stripe session IDs in `reference_id`. This field is unique and sparse, making repeated webhook delivery idempotent.

### Withdrawal Flow

Authenticated users call `POST /wallet/withdrawal-request`.

The service checks:

- Amount is greater than zero.
- Wallet exists.
- Wallet has a previous deposit.
- Withdrawal delay has passed.
- Wallet has enough balance.
- No other pending withdrawal exists.

The current `withdrawalDelayMs` is set to `0`, although the code comments show the intended 48-hour delay.

Withdrawal requests are stored separately from completed wallet transactions. Pending withdrawals are prevented with a partial unique index on `wallet_id` and `status: pending`.

### Transaction History

`GET /wallet/transactions/history` merges several sources into one reverse-chronological feed:

- Wallet deposits
- Wallet withdrawals
- Pending/rejected withdrawal requests
- Buy orders
- Sell orders

Optional filters:

- `type`: `deposit`, `withdrawal`, `buy`, or `sell`
- `from`: ISO date
- `to`: ISO date

## 8. Stocks

Stock logic is implemented in `src/stocks`.

### Stock Model

Fields:

- `ticker`
- `companyName`
- `sector`
- `currentPrice`
- `availableShares`
- `initialShares`
- `description`
- `isListed`

`ticker` is unique.

### Stock History

Stock updates are snapshotted into the `stock_history` collection before mutations.

History records contain:

- `stockId`
- `before`: previous stock document snapshot
- `changedAt`
- `operation`

Mongoose pre-hooks capture history for:

- `save`
- `findOneAndUpdate`
- `replaceOne`
- `updateOne`
- `updateMany`

### Stock Price Events

When `currentPrice` changes through `updateByTicker`, `StocksService` publishes a RabbitMQ event:

```json
{
  "ticker": "AAPL",
  "previousPrice": 100,
  "currentPrice": 110,
  "changedAt": "2026-05-10T..."
}
```

Stock alerts consume this event.

## 9. Orders And Portfolio

Order logic is implemented in `src/orders`.

Orders are placed over WebSockets. Portfolio summaries can be requested through both REST and WebSockets.

### Buy Orders

Socket event:

```text
market_buy_order
```

Payload:

```json
{
  "stockId": "mongo-stock-id",
  "numberOfShares": 5
}
```

The buy flow runs inside a MongoDB transaction:

1. Validate user ID and stock ID.
2. Find a listed stock.
3. Calculate total cost from current stock price.
4. Atomically decrement stock `availableShares`.
5. Atomically decrement wallet `balance`.
6. Create a filled buy order.
7. Evict cached portfolio summary.
8. Emit `order_filled`.

If anything fails, the transaction is rolled back and the client receives `order_rejected`.

### Sell Orders

Socket event:

```text
market_sell_order
```

Payload:

```json
{
  "buyOrderId": "mongo-buy-order-id",
  "numberOfShares": 2
}
```

`orderId` is also accepted as an alias for `buyOrderId`.

The sell flow runs inside a MongoDB transaction:

1. Validate user ID and buy order ID.
2. Find the user's open buy order.
3. Determine shares to sell.
4. Find the listed stock.
5. Calculate proceeds, cost basis, and profit/loss.
6. Reduce buy order `availableShares`.
7. If fully closed, set `closedAt`.
8. Increment stock `availableShares`.
9. Increment wallet balance by proceeds.
10. Create a filled sell order.
11. Evict cached portfolio summary.
12. Rebuild and emit portfolio summary.

Success emits:

- `order_closed`
- `portfolio_value_updated`

Failure emits:

- `order_rejected`

### Portfolio Summary

REST endpoint:

```text
GET /orders/portfolio/summary
```

Socket event:

```text
portfolio_summary
```

The summary groups open buy orders by stock and returns:

- Shares held
- Average cost per share
- Total cost
- Current price
- Market value
- Unrealized gain/loss
- Portfolio totals

Summaries are cached in Redis for 60 seconds and evicted after buy or sell orders.

## 10. Stock Alerts

Stock alerts are implemented in `src/stock-alerts`.

Users can create alerts for a ticker crossing above or below a threshold. Alerts are triggered from RabbitMQ stock price update events.

### Alert Model

Fields:

- `memberId`
- `ticker`
- `direction`: `above` or `below`
- `thresholdPrice`
- `status`: `active`, `triggered`, or `cancelled`
- `emailEnabled`
- `pushEnabled`
- `triggeredAt`
- `triggeredPrice`

### Trigger Logic

For `above` alerts:

```text
previousPrice < thresholdPrice <= currentPrice
```

For `below` alerts:

```text
previousPrice > thresholdPrice >= currentPrice
```

When triggered, an alert is marked `triggered`, timestamped, and emailed to the user. Push notifications are currently represented by a log message.

## 11. REST API Reference

### Auth

#### `POST /auth/register`

Body:

```json
{
  "fullName": "Jane Doe",
  "email": "jane@example.com",
  "nationalId": "123456789",
  "dateOfBirth": "1995-01-01"
}
```

Response:

```json
{
  "message": "OTP sent successfully"
}
```

#### `POST /auth/verify-otp`

Body:

```json
{
  "email": "jane@example.com",
  "otp": "123456"
}
```

#### `POST /auth/set-password`

Body:

```json
{
  "email": "jane@example.com",
  "password": "strongpass123"
}
```

#### `POST /auth/login`

Body:

```json
{
  "email": "jane@example.com",
  "password": "strongpass123"
}
```

Response includes `accessToken`, `requiresWalletFunding`, and user details.

### Stocks

#### `POST /stocks`

Creates a stock. This route is currently not guarded.

Body:

```json
{
  "ticker": "AAPL",
  "companyName": "Apple Inc.",
  "sector": "Technology",
  "currentPrice": 180,
  "availableShares": 1000,
  "description": "Consumer technology company",
  "isListed": true
}
```

#### `GET /stocks`

Requires JWT. Returns all stocks.

#### `GET /stocks/:name`

Requires JWT. Despite the parameter name, lookup is performed against `ticker` case-insensitively. Returns stock details plus `stockHistory`.

#### `PATCH /stocks/:ticker`

Updates a stock by ticker. This route is currently not guarded. If the current price changes, a RabbitMQ price update event is published.

### Wallet

#### `POST /wallet/deposit-session`

Requires JWT.

Body:

```json
{
  "amount": 100
}
```

Returns:

```json
{
  "url": "https://checkout.stripe.com/..."
}
```

#### `POST /wallet/webhook`

Public Stripe webhook endpoint. Requires a valid `stripe-signature` header and raw Stripe payload.

#### `POST /wallet/withdrawal-request`

Requires JWT.

Body:

```json
{
  "amount": 50
}
```

#### `GET /wallet/transactions/history`

Requires JWT.

Optional query examples:

```text
/wallet/transactions/history
/wallet/transactions/history?type=buy
/wallet/transactions/history?from=2026-01-01&to=2026-05-10
```

### Orders

#### `GET /orders/portfolio/summary`

Requires JWT. Returns cached or freshly computed portfolio summary.

### Stock Alerts

All stock alert routes require JWT.

#### `POST /stock-alerts`

Body:

```json
{
  "ticker": "AAPL",
  "direction": "above",
  "thresholdPrice": 200,
  "pushEnabled": false
}
```

#### `GET /stock-alerts`

Returns the authenticated user's alerts.

#### `DELETE /stock-alerts/:id`

Cancels an active alert owned by the authenticated user.

## 12. WebSocket API Reference

The WebSocket gateway allows CORS from all origins.

Authenticate by passing a JWT in:

```js
io("http://localhost:3000", {
  auth: {
    token: "Bearer <jwt>"
  }
});
```

or through the `Authorization` handshake header.

### `market_buy_order`

Client emits:

```json
{
  "stockId": "mongo-stock-id",
  "numberOfShares": 5
}
```

Server success event:

```text
order_filled
```

Server failure event:

```text
order_rejected
```

### `market_sell_order`

Client emits:

```json
{
  "buyOrderId": "mongo-buy-order-id",
  "numberOfShares": 2
}
```

Server success events:

```text
order_closed
portfolio_value_updated
```

Server failure event:

```text
order_rejected
```

### `portfolio_summary`

Client emits:

```json
{}
```

Server success event:

```text
portfolio_summary
```

Server failure event:

```text
portfolio_summary_error
```

## 13. Data Model Summary

### User

Permanent account identity and login credentials.

### Wallet

One wallet per user, with current balance and last deposit timestamp.

### WalletTransaction

Completed deposit and withdrawal records. Deposits currently come from Stripe webhooks.

### WithdrawalRequest

Tracks withdrawal requests and their approval lifecycle.

### Stock

Tradable stock instrument with price and available share inventory.

### StockHistory

Audit-like snapshots of stocks before update operations.

### BuyOrder

Filled market buy order. Remaining open position is represented by `availableShares`.

### SellOrder

Filled market sell order tied back to the original buy order.

### StockAlert

User threshold alert for stock price movement.

## 14. Environment Variables

Core variables:

```text
PORT=3000
MONGO_URI=mongodb://mongodb:27017/eurisko_db?replicaSet=rs0
REDIS_HOST=redis
REDIS_PORT=6379
JWT_SECRET=change-me
EMAIL=
EMAIL_PASS=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
RABBITMQ_URL=amqp://rabbitmq:5672
RABBITMQ_PREFETCH=20
```

Docker Compose also supports container and host port overrides:

```text
APP_CONTAINER_NAME=
APP_HOST_PORT=
MONGO_CONTAINER_NAME=
MONGO_HOST_PORT=
REDIS_CONTAINER_NAME=
REDIS_HOST_PORT=
RABBITMQ_CONTAINER_NAME=
RABBITMQ_HOST_PORT=
RABBITMQ_MANAGEMENT_HOST_PORT=
```

Note: `.env.example` currently lists the main app, Mongo, Redis, email, JWT, and Stripe variables, but does not list the RabbitMQ override variables that are used by `docker-compose.yml`.

## 15. Running The Project

Install dependencies:

```bash
npm install
```

Run locally:

```bash
npm run start:dev
```

Run the full Docker stack:

```bash
docker compose up --build
```

The API defaults to:

```text
http://localhost:3000
```

RabbitMQ management UI defaults to:

```text
http://localhost:15672
```

Build:

```bash
npm run build
```

Run tests:

```bash
npm test
```

Run e2e tests:

```bash
npm run test:e2e
```

Lint:

```bash
npm run lint
```

Format:

```bash
npm run format
```

## 16. Docker Stack

`docker-compose.yml` defines:

- `app`: NestJS API in watch mode.
- `mongodb`: MongoDB with replica set `rs0`.
- `redis`: Redis with persisted volume.
- `rabbitmq`: RabbitMQ with management plugin.

The app waits for MongoDB and RabbitMQ health checks and for Redis startup.

The app container mounts the repository into `/app` and keeps container `node_modules` isolated through `/app/node_modules`.

## 17. Testing

The project uses Jest with `ts-jest`.

Current test files include unit specs for:

- App controller
- Auth controller/service
- Stocks controller/service
- Wallets controller/service
- Orders service
- Redis service
- Users service

There is also an e2e test setup under `test/`.

## 18. Important Implementation Details

### Mongo Transactions

Wallet deposits, buy orders, and sell orders use Mongo transactions. This is why the Docker MongoDB service runs as a replica set.

### Idempotent Stripe Webhooks

Stripe checkout session IDs are saved as unique `reference_id` values on wallet transactions. Duplicate key errors are treated as already processed events.

### Portfolio Cache

Portfolio summaries are cached in Redis for 60 seconds. Buy and sell orders explicitly evict the cache.

### Stock History

Stock history captures the previous version of stock records before update operations. This supports audit/history views for a stock.

### Alert Crossing Semantics

Alerts trigger only when the threshold is crossed between previous and current price. If the stock is already above or below the threshold before alert creation, it will not trigger until a future crossing event.

## 19. Security And Operational Notes

- JWT secrets must be set in production.
- Stripe webhook verification depends on `rawBody: true`.
- Email credentials should never be committed.
- Some stock management endpoints are currently unguarded:
  - `POST /stocks`
  - `PATCH /stocks/:ticker`
- CORS for WebSockets is currently open to all origins.
- OTPs are logged with `console.log('OTP:', otp)`, which should be removed or gated outside local development.
- Withdrawal delay is currently disabled by `withdrawalDelayMs = 0`.

## 20. Suggested Next Improvements

- Add role-based guards for stock creation and stock updates.
- Remove OTP logging in non-development environments.
- Add API documentation through Swagger/OpenAPI decorators.
- Add pagination to transaction history, stocks, alerts, and stock history.
- Add explicit withdrawal approval/rejection admin endpoints.
- Add RabbitMQ variables to `.env.example`.
- Move Stripe success and cancel URLs into environment variables.
- Add integration tests around Stripe webhook idempotency and market order transactions.
- Replace push notification logging with a real push notification queue/provider.
