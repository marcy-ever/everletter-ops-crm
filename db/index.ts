import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

let pool: Pool | undefined;

export function getDb() {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local and point it at your local Postgres (see docker-compose.yml).",
    );
  }

  pool ??= new Pool({ connectionString: process.env.DATABASE_URL });

  return drizzle(pool, { schema });
}
