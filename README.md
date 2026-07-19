# Everletter Ops CRM

Private operations CRM for Everletter mailing production.

## Current Architecture

- Vinext/Vite/React shell in `app/`
- Main browser CRM logic in `public/app.js`
- Shared state API in `app/api/shared-state/route.ts`
- Cloudflare D1 schema in `db/schema.ts`
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
pnpm exec vinext dev
pnpm exec vinext build
```

## Notes

- Keep this repo private.
- Do not commit exported spreadsheets, customer lists, `.env` files, deployment tokens, or raw customer data.
- Internal Drive folder IDs are not committed; configure private operational links outside the public source tree before production hardening.
