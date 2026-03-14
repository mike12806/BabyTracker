# Baby Tracker

A baby tracking application inspired by [Baby Buddy](https://github.com/babybuddy/babybuddy), built for Cloudflare's edge platform.

## Features

- **Multi-child support** — track multiple children, each linked to one or more users
- **Comprehensive tracking** — feedings, diaper changes, sleep, tummy time, pumping, growth, temperature, notes, and timers
- **Photo uploads** — child profile photos stored securely in Cloudflare R2
- **Secure by default** — authentication via Cloudflare Access (no custom login UI needed)
- **Edge-native** — runs entirely on Cloudflare (Pages, Workers, D1, R2, etc.)

## Architecture

| Component | Technology | Deployment |
|-----------|-----------|------------|
| Client | React + Vite + MUI | Cloudflare Pages |
| Server | Hono (TypeScript) | Cloudflare Workers |
| Database | D1 (SQLite) | Cloudflare D1 |
| Object Storage | R2 | Cloudflare R2 |
| Auth | Cloudflare Access | JWT validation |

## Getting Started

### Prerequisites

- Node.js 18+
- npm
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) (`npm install -g wrangler`)

### Install

```sh
npm install
```

### Local Development

```sh
# Start the API server (with local D1 + R2)
npm run dev:server

# Start the client dev server (in another terminal)
npm run dev:client
```

### Seed Data

Populate a local D1 database with sample data:

```sh
npm run db:seed
```

### Run Tests

```sh
# All tests
npm test

# Server only
npm run test:server

# Client only
npm run test:client
```

### Build

```sh
npm run build:client
npm run build:server
```

## Deployment

### 1. Create Cloudflare resources

```sh
# D1 database
npx wrangler d1 create baby-tracker-db

# R2 bucket for photos
npx wrangler r2 bucket create baby-tracker-photos
```

### 2. Configure

Update `server/wrangler.toml` with your D1 database ID, Cloudflare Access team domain, and audience tag.

### 3. Run migrations

```sh
npx wrangler d1 migrations apply baby-tracker-db
```

### 4. Deploy

```sh
# Deploy the Worker API
npm run build:server
npx wrangler deploy -c server/wrangler.toml

# Deploy the client
npm run build:client
npx wrangler pages deploy client/dist
```

### 5. Secure with Cloudflare Access

Add both the Pages site and Worker API to a Cloudflare Access application to protect them with your identity provider.

## Project Structure

```
├── client/              # React + Vite SPA
│   ├── src/
│   │   ├── api/         # API client
│   │   ├── components/  # Layout, shared components
│   │   ├── hooks/       # Auth & children context
│   │   ├── pages/       # Route pages
│   │   └── types/       # TypeScript models
│   └── test/
├── server/              # Hono Cloudflare Worker
│   ├── src/
│   │   ├── middleware/   # Auth (CF Access JWT)
│   │   ├── routes/       # REST API routes
│   │   └── types/        # Env bindings
│   ├── migrations/       # D1 SQL migrations
│   ├── seed/             # Sample data
│   └── test/
└── package.json          # npm workspaces root
```

## License

[MIT](LICENSE)
