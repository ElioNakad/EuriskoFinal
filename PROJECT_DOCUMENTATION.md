# Eurisko Backend - Dev Notes


## Quick Picture

The app does these main things:

- lets members register with OTP email verification
- lets members log in with JWT
- lets CMS users log in too, with roles like `super-admin`, `administrator`, `analyst`, and `support-agent`
- lets users fund their wallet with Stripe Checkout
- listens to Stripe webhooks and updates wallet balances
- lets users request withdrawals
- lets CMS users approve/reject withdrawals and manually adjust wallets
- stores stocks and stock price history
- lets users buy/sell stocks through WebSockets
- calculates portfolio summaries
- lets users create stock price alerts
- publishes stock price changes through RabbitMQ so alerts can react
- uses Redis for OTP/temp data and some cache

## Tech Used

- **NestJS 11**: main backend framework
- **TypeScript**: language
- **MongoDB + Mongoose**: database and schemas
- **MongoDB transactions**: used for wallet deposits, buy orders, sell orders, wallet adjustments, etc.
- **Redis / ioredis**: OTP state and cached data
- **RabbitMQ / amqplib**: stock price update event bus
- **Socket.IO**: WebSocket order flow
- **JWT**: auth tokens
- **bcrypt**: password hashing
- **class-validator / class-transformer**: DTO validation
- **Stripe**: wallet deposit checkout and webhook verification
- **Nodemailer with Gmail**: OTP, payment, withdrawal, CMS password, and stock alert emails
- **Jest**: tests
- **Docker Compose**: local app + MongoDB + Redis + RabbitMQ stack

## How The App Starts

Entry point:

- `src/main.ts`

What happens there:

- creates the Nest app
- enables `rawBody: true`, which is needed for Stripe webhook signature verification
- adds `HttpExceptionFilter` globally
- adds `LoggingInterceptor` globally
- adds a global `ValidationPipe`
- listens on `process.env.PORT` or `3000`

Root module:

- `src/app.module.ts`

What it wires together:

- loads env vars with `ConfigModule`
- validates env vars with `src/config/env.validation.ts`
- connects Mongoose using `MONGO_URI`
- registers the main modules:
  - `AuthModule`
  - `UsersModule`
  - `StocksModule`
  - `WalletsModule`
  - `OrdersModule`
  - `RabbitMqModule`
  - `StockAlertsModule`
  - `CmsModule`
  - `AnalystModule`
- adds `RequestIdMiddleware` to every route

Global validation behavior:

- unknown fields are removed
- unknown fields are rejected
- query/body values are transformed into proper DTO types

## Folder Layout

```text
src/
  main.ts
  app.module.ts
  app.controller.ts
  app.service.ts
  auth/
  users/
  cms/
  wallets/
  stocks/
  orders/
  stock-alerts/
  analyst/
  redis/
  rabbitmq/
  mail/
  common/
  config/
  types/
test/
Dockerfile
docker-compose.yml
package.json
```

The code is mostly organized by business module. So if you need wallet behavior, start in `src/wallets`. If you need CMS/admin behavior, start in `src/cms`, and so on.

## Common App Behavior

### Request IDs

Files:

- `src/common/middleware/request-id.middleware.ts`

Every HTTP request gets an `x-request-id`. If the client sends one, the app keeps it. If not, the app generates one.

### Error Responses

Files:

- `src/common/filters/http-exception.filter.ts`
- `src/common/filters/ws-exception.filter.ts`

HTTP errors get shaped like this:

```json
{
  "success": false,
  "statusCode": 400,
  "timestamp": "2026-05-15T...",
  "path": "/some/path",
  "method": "POST",
  "requestId": "uuid",
  "message": "what went wrong",
  "error": "Bad Request"
}
```

WebSocket validation errors emit an event like `order_rejected`.

### Logging

Files:

- `src/common/interceptors/logging.interceptor.ts`

Logs method, URL, status code, duration, request ID, and user-ish info when available.

### Pagination

Files:

- `src/common/dto/pagination-query.dto.ts`

Common query params:

- `page`, default `1`
- `limit`, default `20`, max `100`

## Auth Module

Folder:

- `src/auth`

Main files:

- `auth.controller.ts`: exposes auth endpoints
- `auth.service.ts`: signup/login logic
- `auth.module.ts`: wires JWT, users, Redis, mail, wallets, CMS
- `dto/*.ts`: request body validation
- `guards/jwt-auth.guard.ts`: HTTP JWT guard
- `guards/ws-jwt-auth.guard.ts`: WebSocket JWT guard
- `types/authenticated-socket.type.ts`: socket user type

### Auth Endpoints

Base path: `/auth`

| Method | Endpoint | Auth | What it does |
|---|---|---|---|
| `POST` | `/auth/register` | public | Starts member signup, validates age, stores signup + OTP in Redis, emails OTP |
| `POST` | `/auth/verify-otp` | public | Checks OTP and moves signup data from `signup:{email}` to `verified:{email}` |
| `POST` | `/auth/set-password` | public | Creates permanent Mongo user after OTP verification |
| `POST` | `/auth/login` | public | Logs in either a member or CMS account and returns JWT |

### Signup Flow

1. User calls `POST /auth/register`.
2. App checks age is at least 18.
3. App checks email is not already used by a member or CMS account.
4. App creates a 6 digit OTP.
5. Signup data goes to Redis key `signup:{email}` for 10 minutes.
6. OTP is emailed.
7. User calls `POST /auth/verify-otp`.
8. If valid, data moves to Redis key `verified:{email}` for 10 minutes.
9. User calls `POST /auth/set-password`.
10. Password is hashed with bcrypt.
11. A `User` document is created.
12. Temporary Redis data is deleted.

Note: `auth.service.ts` currently logs OTPs with `console.log('OTP:', otp)`. Useful locally, bad idea in production.

### Login Flow

`POST /auth/login` first checks regular members, then CMS accounts.

JWT payload includes:

- `sub`: account id
- `email`
- `role`
- `accountType`: `member` or `cms`

Member login also returns `requiresWalletFunding`, which is based on whether the user already has a wallet.

### Guards

HTTP:

- `JwtAuthGuard` expects `Authorization: Bearer <token>`.
- If the token is for a member, it also checks the user is active.
- It attaches `request.user = { userId, email, role, accountType }`.

WebSocket:

- `WsJwtAuthGuard` accepts token from `handshake.auth.token` or `Authorization` header.
- Bad socket auth disconnects the client or emits an error event.

## Users Module

Folder:

- `src/users`

Main files:

- `users.service.ts`: user create/find/admin profile/status logic
- `users.module.ts`: registers schemas and exports service
- `schemas/user.schema.ts`: member user collection
- `schemas/member-account-status-log.schema.ts`: suspension/reinstatement logs

No controller here. Other modules call `UsersService`.

### User Data

`User` fields:

- `fullName`
- `email`
- `nationalId`
- `dateOfBirth`
- `password`
- `role`, defaults to `member`
- `isActive`, defaults to `true`
- `lastTradingActivityAt`

Indexes:

- `email`
- `nationalId`

### What UsersService Does

- creates users and blocks duplicate email/national ID
- finds users by email or ID
- returns CMS-facing member profile without password
- returns member registration metrics
- suspends/reinstates member accounts
- writes status logs when a CMS admin changes member status

## CMS Module

Folder:

- `src/cms`

Main files:

- `cms.controller.ts`: CMS/admin REST endpoints
- `cms.service.ts`: CMS account creation and bootstrap seed
- `cms.module.ts`: registers CMS schemas and shares service
- `dto/*.ts`: CMS request validation
- `guards/*.ts`: role guards
- `schemas/cms-account.schema.ts`: CMS accounts
- `schemas/audit-trail.schema.ts`: audit trail records

### CMS Roles

Roles are:

- `super-admin`
- `administrator`
- `analyst`
- `support-agent`

The app seeds one super admin on module init:

- email: `omar@gmail.com`
- password: `Pass1234`
- role: `super-admin`

That is convenient for local dev, but obviously should be changed for real deployment.

### CMS Guards

- `CmsSuperAdminGuard`: only `super-admin`
- `CmsAdminGuard`: `administrator` or `super-admin`
- `CmsAnalystGuard`: `analyst`, `administrator`, or `super-admin`
- `CmsSupportAgentGuard`: `support-agent`, `administrator`, or `super-admin`
- `CmsWithdrawalReviewGuard`: `support-agent`, `administrator`, or `super-admin`

All of these expect the JWT to already be validated by `JwtAuthGuard`.

### CMS Endpoints

Base path: `/cms/accounts`

| Method | Endpoint | Roles | What it does |
|---|---|---|---|
| `POST` | `/cms/accounts` | super admin | Creates a CMS user and emails a temporary password |
| `GET` | `/cms/accounts/members/metrics` | admin/super admin | Member registration stats |
| `GET` | `/cms/accounts/members/:memberId` | support/admin/super admin | Member profile for CMS |
| `GET` | `/cms/accounts/members/:memberId/transactions/history` | support/admin/super admin | Member transaction history |
| `POST` | `/cms/accounts/members/:memberId/suspend` | admin/super admin | Suspends a member account with reason |
| `POST` | `/cms/accounts/members/:memberId/reinstate` | admin/super admin | Reinstates a member account with reason |
| `POST` | `/cms/accounts/members/:memberId/wallet/adjust` | admin/super admin | Manual wallet credit/debit with audit trail |
| `GET` | `/cms/accounts/withdrawal-requests` | support/admin/super admin | Paginated withdrawal requests |
| `GET` | `/cms/accounts/withdrawal-requests/pending-review` | support/admin/super admin | Pending withdrawal requests |
| `PATCH` | `/cms/accounts/withdrawal-requests/:requestId/status` | withdrawal review roles | Approves or rejects a withdrawal |

## Wallets Module

Folder:

- `src/wallets`

Main files:

- `wallets.controller.ts`: wallet REST endpoints
- `wallets.service.ts`: Stripe, deposits, withdrawals, transaction history, CMS wallet ops
- `wallets.module.ts`: registers wallet schemas and exports service
- `dto/*.ts`: request/query validation
- `schemas/wallet.schema.ts`
- `schemas/wallet-transaction.schema.ts`
- `schemas/withdrawal-request.schema.ts`

### Wallet Endpoints

Base path: `/wallet`

| Method | Endpoint | Auth | What it does |
|---|---|---|---|
| `POST` | `/wallet/deposit-session` | member JWT | Creates Stripe Checkout session |
| `POST` | `/wallet/withdrawal-request` | member JWT | Creates a withdrawal request |
| `GET` | `/wallet/transactions/history` | member JWT | Combined deposit/withdrawal/buy/sell history |
| `POST` | `/wallet/webhook` | public Stripe | Stripe webhook for completed checkout sessions |

### Deposit Flow

1. User calls `POST /wallet/deposit-session` with `{ "amount": 100 }`.
2. `WalletsService` creates a Stripe Checkout session.
3. Stripe redirects user to checkout.
4. Stripe calls `POST /wallet/webhook`.
5. App verifies `stripe-signature` using `STRIPE_WEBHOOK_SECRET`.
6. If event is `checkout.session.completed`, app reads `userId` and `amount` from metadata.
7. In a Mongo transaction:
   - create wallet if missing
   - increment wallet balance
   - store `WalletTransaction` of type `deposit`
8. Sends payment success email.

Stripe session id is stored as `reference_id` with a unique sparse index, so duplicate webhook deliveries do not double-credit the wallet.

### Withdrawal Flow

1. User calls `POST /wallet/withdrawal-request`.
2. App checks wallet exists.
3. App checks there was at least one deposit.
4. App checks wallet balance is enough.
5. App checks there is no other pending withdrawal.
6. Creates a `WithdrawalRequest` with status `pending`.

The code has `withdrawalDelayMs = 0`. A comment shows this was probably meant to be 48 hours.

CMS approval/rejection is handled through CMS endpoints. Approval creates a completed wallet withdrawal transaction and decreases wallet balance. Rejection just updates the request status.

### Wallet Data

`Wallet`:

- `userId`
- `balance`
- `lastDepositAt`

`WalletTransaction`:

- `wallet_id`
- `transaction_type`: `deposit`, `withdrawal`, `manual_credit`, `manual_debit`
- `amount`
- `status`: currently only `completed`
- `reference_id`

`WithdrawalRequest`:

- `wallet_id`
- `amount`
- `status`: `pending`, `seen`, `approved`, `rejected`

### Transaction History

`GET /wallet/transactions/history` and the CMS member history endpoint merge:

- wallet transactions
- pending/rejected withdrawal requests
- buy orders
- sell orders

Query params:

- `page`
- `limit`
- `type`: `deposit`, `withdrawal`, `buy`, `sell`
- `from`
- `to`

## Stocks Module

Folder:

- `src/stocks`

Main files:

- `stocks.controller.ts`: stock REST endpoints
- `stocks.service.ts`: stock create/list/search/update/delist, cache, price events
- `stocks.module.ts`: registers stock schemas
- `dto/*.ts`: create/update validation
- `schemas/stock.schema.ts`: stock data + history hooks
- `schemas/stock-history.schema.ts`: stock update snapshots

### Stock Endpoints

Base path: `/stocks`

| Method | Endpoint | Auth | What it does |
|---|---|---|---|
| `POST` | `/stocks` | CMS analyst/admin/super admin | Creates a stock |
| `GET` | `/stocks` | any JWT | Lists stocks with pagination |
| `GET` | `/stocks/:name` | any JWT | Finds stock by ticker, despite param name being `name` |
| `PATCH` | `/stocks/:ticker` | CMS analyst/admin/super admin | Updates stock by ticker |
| `PATCH` | `/stocks/:ticker/delist` | CMS analyst/admin/super admin | Sets `isListed` to false |

### Stock Data

`Stock` fields:

- `ticker`
- `companyName`
- `sector`
- `currentPrice`
- `availableShares`
- `initialShares`
- `description`
- `isListed`

### Cache

Redis keys:

- `stocks:catalogue:page:{page}:limit:{limit}`
- `stocks:price:{TICKER}`

Catalogue cache is deleted when stocks are created/updated.

### Stock History

The stock schema has Mongoose hooks that write old versions to `stock_history` before updates.

`StockHistory` fields:

- `stockId`
- `before`
- `changedAt`
- `operation`

### Stock Price Events

When `currentPrice` changes through `PATCH /stocks/:ticker`, the app publishes a RabbitMQ event:

```json
{
  "ticker": "AAPL",
  "previousPrice": 100,
  "currentPrice": 110,
  "changedAt": "2026-05-15T..."
}
```

Stock alerts consume this.

## Orders Module

Folder:

- `src/orders`

Main files:

- `orders.controller.ts`: REST portfolio endpoint
- `orders.gateway.ts`: Socket.IO buy/sell/portfolio events
- `orders.service.ts`: actual buy/sell/portfolio business logic
- `orders.module.ts`: registers order schemas and gateway
- `dto/*.ts`: socket payload validation
- `schemas/buy-order.schema.ts`
- `schemas/sell-order.schema.ts`

### REST Endpoint

Base path: `/orders`

| Method | Endpoint | Auth | What it does |
|---|---|---|---|
| `GET` | `/orders/portfolio/summary` | member JWT | Returns cached/fresh portfolio summary |

### WebSocket Auth

Socket clients pass JWT like this:

```js
io("http://localhost:3000", {
  auth: {
    token: "Bearer <jwt>"
  }
});
```

Or via the handshake `Authorization` header.

### WebSocket Events

| Client emits | Payload | Success event | Failure event |
|---|---|---|---|
| `market_buy_order` | `{ stockId, numberOfShares }` | `order_filled` | `order_rejected` |
| `market_sell_order` | `{ buyOrderId, numberOfShares? }` | `order_closed`, `portfolio_value_updated` | `order_rejected` |
| `portfolio_summary` | `{}` | `portfolio_summary` | `portfolio_summary_error` |

`market_sell_order` also accepts `orderId` as an alias for `buyOrderId`.

### Buy Flow

Buying runs in a Mongo transaction:

1. check user id and stock id
2. make sure account is active
3. find listed stock
4. calculate total cost
5. decrement stock `availableShares`
6. decrement wallet balance
7. create a filled `BuyOrder`
8. evict portfolio summary cache
9. emit `order_filled`

### Sell Flow

Selling also runs in a Mongo transaction:

1. check user id and buy order id
2. make sure account is active
3. find user's open buy order
4. calculate shares to sell
5. load stock current price
6. calculate cost basis, proceeds, profit/loss
7. reduce buy order `availableShares`
8. set `closedAt` if fully closed
9. increment stock `availableShares`
10. increment wallet balance by proceeds
11. create a filled `SellOrder`
12. evict and rebuild portfolio summary
13. emit `order_closed` and `portfolio_value_updated`

### Portfolio Cache

Redis key:

- `portfolio-summary:{userId}`

TTL comes from `PORTFOLIO_SUMMARY_CACHE_TTL_SECONDS`, default `60`.

## Stock Alerts Module

Folder:

- `src/stock-alerts`

Main files:

- `stock-alerts.controller.ts`: alert REST endpoints
- `stock-alerts.service.ts`: alert CRUD + RabbitMQ consumer
- `stock-alerts.module.ts`: registers schema and service
- `dto/create-stock-alert.dto.ts`
- `schemas/stock-alert.schema.ts`

### Alert Endpoints

Base path: `/stock-alerts`

All require member JWT.

| Method | Endpoint | What it does |
|---|---|---|
| `POST` | `/stock-alerts` | Creates an alert |
| `GET` | `/stock-alerts` | Lists current user's alerts |
| `DELETE` | `/stock-alerts/:id` | Cancels one active alert |

Create body:

```json
{
  "ticker": "AAPL",
  "direction": "above",
  "thresholdPrice": 200,
  "pushEnabled": false
}
```

### Alert Data

`StockAlert` fields:

- `memberId`
- `ticker`
- `direction`: `above` or `below`
- `thresholdPrice`
- `status`: `active`, `triggered`, `cancelled`
- `emailEnabled`
- `pushEnabled`
- `triggeredAt`
- `triggeredPrice`

### How Alerts Trigger

`StockAlertsService` subscribes to RabbitMQ on startup.

RabbitMQ channel:

- exchange: `stock.price`
- routing key: `stock.price.updated`
- queue: `stock-alerts.price-updated`

For above alerts:

```text
previousPrice < thresholdPrice <= currentPrice
```

For below alerts:

```text
previousPrice > thresholdPrice >= currentPrice
```

When an alert triggers:

- status becomes `triggered`
- `triggeredAt` and `triggeredPrice` are saved
- email is sent
- push notification is only logged right now

## Analyst Module

Folder:

- `src/analyst`

Main files:

- `analyst.controller.ts`: analytics REST endpoints
- `analyst.service.ts`: aggregation queries
- `analyst.module.ts`: registers needed models
- `dto/*.ts`: query validation

Base path: `/analytics`

All endpoints require JWT plus `CmsAnalystGuard`, meaning role must be `analyst`, `administrator`, or `super-admin`.

| Method | Endpoint | What it does |
|---|---|---|
| `GET` | `/analytics/volume` | Trading volume for one stock over date range |
| `GET` | `/analytics/stocks/top` | Top traded stocks |
| `GET` | `/analytics/aum` | Assets under management |
| `GET` | `/analytics/members/active` | Most active members |
| `GET` | `/analytics/sectors` | Sector allocation |

Important query params:

- `/analytics/volume`: `stock_id`, `granularity` as `day` or `month`, `from`, `to`
- `/analytics/stocks/top`: `page`, `limit`
- `/analytics/members/active`: `days`, `limit`

The service mostly uses Mongo aggregation pipelines across buy orders, sell orders, stocks, users, and wallets.

## Redis Module

Folder:

- `src/redis`

Main files:

- `redis.service.ts`
- `redis.module.ts`

What it does:

- wraps `ioredis`
- stores JSON with TTL
- reads JSON back
- deletes a key
- deletes by pattern using `scanStream`
- quits Redis on module destroy

Used for:

- signup OTP data
- verified signup data
- stock catalogue cache
- stock price cache
- portfolio summary cache

## RabbitMQ Module

Folder:

- `src/rabbitmq`

Main files:

- `rabbitmq.service.ts`
- `rabbitmq.module.ts`
- `rabbitmq.constants.ts`

What it does:

- connects to RabbitMQ on app bootstrap
- publishes JSON messages to topic exchanges
- consumes queues with prefetch
- `ack`s successful messages
- `nack`s failed messages without requeue

Current constants:

- exchange: `stock.price`
- routing key: `stock.price.updated`
- queue: `stock-alerts.price-updated`

If RabbitMQ is unavailable, the service logs a warning instead of crashing immediately.

## Mail Module

Folder:

- `src/mail`

Main files:

- `mail.service.ts`
- `mail.module.ts`

Uses Nodemailer with Gmail:

- `EMAIL`
- `EMAIL_PASS`

Sends:

- OTP email
- payment success email
- withdrawal approved email
- withdrawal rejected email
- stock alert triggered email
- CMS temporary password email

## App Controller

Files:

- `src/app.controller.ts`
- `src/app.service.ts`

Only has:

| Method | Endpoint | What it does |
|---|---|---|
| `GET` | `/` | returns the app service hello string |

## Environment Variables

Validated by:

- `src/config/env.validation.ts`

Required:

```text
MONGO_URI
JWT_SECRET
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
```

Optional/defaulted:

```text
PORT=3000
REDIS_HOST=localhost
REDIS_PORT=6379
RABBITMQ_URL=amqp://localhost:5672
RABBITMQ_PREFETCH=20
STOCK_CATALOGUE_CACHE_TTL_SECONDS=300
STOCK_PRICE_CACHE_TTL_SECONDS=60
PORTFOLIO_SUMMARY_CACHE_TTL_SECONDS=60
EMAIL=
EMAIL_PASS=
```

Docker Compose also supports these override variables:

```text
APP_CONTAINER_NAME
APP_HOST_PORT
MONGO_CONTAINER_NAME
MONGO_HOST_PORT
REDIS_CONTAINER_NAME
REDIS_HOST_PORT
RABBITMQ_CONTAINER_NAME
RABBITMQ_HOST_PORT
RABBITMQ_MANAGEMENT_HOST_PORT
```

Important: `.env.example` currently does not list RabbitMQ variables, but `docker-compose.yml` uses them.

## Docker

Files:

- `Dockerfile`
- `docker-compose.yml`
- `.dockerignore`

### Dockerfile

The Dockerfile:

1. starts from `node:20`
2. sets `/app` as workdir
3. copies `package*.json`
4. runs `npm ci`
5. copies the rest of the repo
6. exposes port `3000`
7. defaults to `npm run start:dev`

### Docker Compose Services

`docker-compose.yml` starts four services.

#### app

This is the NestJS app.

- builds from the local Dockerfile
- maps `${APP_HOST_PORT:-3000}` to `${PORT:-3000}`
- depends on MongoDB, Redis, and RabbitMQ
- injects env vars into the container
- mounts the project into `/app`
- keeps `/app/node_modules` as a container volume
- runs `npm run start:dev`

Because the source folder is mounted, local code changes are visible inside the container.

#### mongodb

MongoDB service.

- image: `mongo:latest`
- runs as single node replica set `rs0`
- maps host `${MONGO_HOST_PORT:-27019}` to container `27017`
- persists data in `mongo_data`
- healthcheck also initializes the replica set if needed

The replica set matters because Mongo transactions need it.

#### redis

Redis service.

- image: `redis:latest`
- maps host `${REDIS_HOST_PORT:-6379}` to container `6379`
- persists data in `redis_data`

#### rabbitmq

RabbitMQ service.

- image: `rabbitmq:3-management`
- maps AMQP `${RABBITMQ_HOST_PORT:-5672}` to `5672`
- maps management UI `${RABBITMQ_MANAGEMENT_HOST_PORT:-15672}` to `15672`
- healthcheck uses `rabbitmq-diagnostics ping`

RabbitMQ management UI:

```text
http://localhost:15672
```

Default RabbitMQ Docker credentials are usually:

```text
guest / guest
```

### Running Docker

```bash
docker compose up --build
```

API:

```text
http://localhost:3000
```

Stop:

```bash
docker compose down
```

Stop and delete volumes:

```bash
docker compose down -v
```

## Useful Commands

Install:

```bash
npm install
```

Run dev:

```bash
npm run start:dev
```

Build:

```bash
npm run build
```

Run tests:

```bash
npm test
```

Run e2e:

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

## Data Collections

Main Mongo collections/models:

- `users`: member accounts
- `member_account_status_logs`: CMS suspension/reinstatement history
- `cms_accounts`: CMS/admin accounts
- `audit_trail`: CMS audit entries, currently wallet manual adjustments
- `wallets`: one wallet per user
- `wallet_transactions`: completed wallet movements
- `withdrawals_requests`: withdrawal requests
- `stocks`: stock catalogue
- `stock_history`: snapshots before stock updates
- `buy_orders`: filled market buys / open positions
- `sell_orders`: filled market sells
- `stockalerts` or similar Mongoose default collection: stock alerts

## Main Flows To Understand

### New Member

```text
register -> verify OTP -> set password -> login -> deposit money -> trade
```

### Deposit

```text
deposit-session -> Stripe Checkout -> Stripe webhook -> wallet balance increases
```

### Buy Stock

```text
socket market_buy_order -> Mongo transaction -> wallet down, stock shares down, buy order created
```

### Sell Stock

```text
socket market_sell_order -> Mongo transaction -> wallet up, stock shares up, sell order created
```

### Stock Price Alert

```text
CMS updates stock price -> RabbitMQ event -> alert service checks thresholds -> email if crossed
```

### Withdrawal

```text
member requests withdrawal -> CMS reviews -> approved decreases wallet and records transaction
```

## Things A Dev Should Watch Out For

- Stripe webhook needs raw body. Do not remove `rawBody: true` in `main.ts`.
- MongoDB transactions require the Docker MongoDB replica set.
- OTPs are logged in `AuthService`; remove/gate this before production.
- The seeded CMS super admin is hardcoded. Change this before production.
- Withdrawal delay is currently `0`, even though a 48-hour delay is hinted in a comment.
- Stripe success/cancel URLs are hardcoded to `http://localhost:3001/...`.
- WebSocket CORS is currently `origin: '*'`.
- RabbitMQ failures are logged as warnings, so alert/event behavior can silently not work if RabbitMQ is down.
- `.env.example` is missing RabbitMQ env vars used by Docker Compose.
- `GET /stocks/:name` actually searches by ticker. The route param name is misleading.

## Test Coverage

Test files exist for:

- app controller
- auth controller/service
- users service
- stocks controller/service
- wallets controller/service
- orders service
- redis service
- CMS guards

There is also an e2e setup under `test/`.

Run:

```bash
npm test
```

## Where To Start When Changing Things

- Changing login/signup: start in `src/auth/auth.service.ts`
- Changing member data: start in `src/users/users.service.ts`
- Changing admin/CMS permissions: start in `src/cms/guards`
- Changing CMS endpoints: start in `src/cms/cms.controller.ts`
- Changing deposits/withdrawals: start in `src/wallets/wallets.service.ts`
- Changing stocks: start in `src/stocks/stocks.service.ts`
- Changing buy/sell behavior: start in `src/orders/orders.service.ts`
- Changing WebSocket events: start in `src/orders/orders.gateway.ts`
- Changing alerts: start in `src/stock-alerts/stock-alerts.service.ts`
- Changing analytics: start in `src/analyst/analyst.service.ts`
- Changing Docker/local infra: start in `docker-compose.yml`
