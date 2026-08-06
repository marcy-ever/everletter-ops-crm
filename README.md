# Everletter Ops CRM

Private operations CRM for Everletter mailing production.

## Current Architecture

- Next.js/React shell in `app/`
- Main browser CRM logic in `public/app.js`
- Shared state API in `app/api/shared-state/route.ts`, backed by self-hosted Postgres via Drizzle (`db/schema.ts`)
- Styling in `app/globals.css`
- Static brand and character assets in `public/assets/`

## Data

Customer data is intentionally not stored in this repository.

The committed seed files contain an empty starter dataset only:

- `public/everletterSeed.json`
- `public/seed-data.js`

Production data is loaded from the hosted database after users import the current spreadsheet through the CRM's Import Sheet screen. Until Squarespace sync is connected, spreadsheet upload is the launch-week ingestion path.

## Local Development

```bash
pnpm install
cp .env.example .env.local   # adjust DATABASE_URL if needed
pnpm docker:up                # starts local Postgres (devops/docker-compose.yml)
pnpm db:migrate
pnpm dev
pnpm build
```

## Notes

- Keep this repo private.
- Do not commit exported spreadsheets, customer lists, `.env` files, deployment tokens, or raw customer data.
- Internal Drive folder IDs are not committed; configure private operational links outside the public source tree before production hardening.
