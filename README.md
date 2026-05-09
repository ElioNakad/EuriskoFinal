# Eurisko Final

NestJS backend using MongoDB, Redis, Mongoose, JWT authentication, email OTPs, and Stripe wallet payments.

## Run With Docker

The app is set up so a fresh clone can run with Docker only.

Requirements:

- Docker
- Docker Compose, either `docker compose` or `docker-compose`

Start the full stack:

```bash
docker compose up --build
```

If your machine uses the legacy Compose binary:

```bash
docker-compose up --build
```

The API runs on:

```text
http://localhost:3000
```

Docker starts three services:

- `app`: NestJS API
- `mongodb`: MongoDB replica set used by Mongoose transactions
- `redis`: Redis for temporary auth and OTP data

The compose file includes safe local defaults, so `.env` is not required just to boot the app. Features that send email or call Stripe need real credentials.

## Environment Variables

For real integrations, copy the example file and fill in the values:

```bash
cp .env.example .env
```

Variables:

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
```

Do not commit `.env`; it is ignored by git and excluded from Docker builds.

## Useful Commands

Run tests locally:

```bash
npm test
```

Build locally:

```bash
npm run build
```

Stop Docker services:

```bash
docker compose down
```

Reset Docker data volumes:

```bash
docker compose down -v
```

## Architecture Notes

The authentication flow uses Redis for temporary registration and OTP state, then stores verified users permanently in MongoDB.

MongoDB stores permanent data such as:

- User accounts
- Wallets
- Orders
- Stocks
- Transactions

Redis stores temporary data such as:

- Pending signups
- OTP codes
- Verification states

Redis keys expire automatically according to the configured TTLs in the application.
