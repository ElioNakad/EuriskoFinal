# Authentication Flow Architecture

## Overview

The platform uses a hybrid Redis + MongoDB authentication flow for member registration and OTP verification.

The goal of this architecture is to:

- Prevent unverified users from polluting the database
- Automatically expire OTPs and temporary signups
- Keep permanent data and temporary authentication data separated
- Provide a scalable authentication foundation for future features such as password reset, 2FA, and login OTPs

---

# Technologies Used

- NestJS
- MongoDB
- Redis
- Docker Compose
- Mongoose
- ioredis
- class-validator
- bcrypt

---

# Authentication Architecture

## MongoDB Responsibilities

MongoDB stores only permanent verified users.

Example:

- User accounts
- Wallets
- Orders
- Stocks
- Transactions

Users are inserted into MongoDB only after successful OTP verification and password setup.

---

## Redis Responsibilities

Redis stores temporary authentication data.

Example:

- Pending signups
- OTP codes
- Verification states

Redis keys automatically expire after a configured TTL.

---

# Registration Flow

## Step 1 — Register

Endpoint:

```http
POST /auth/register