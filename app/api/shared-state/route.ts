import { env } from "cloudflare:workers";

type StateKind = "mailingStatus" | "componentStatus" | "reviewedException" | "crmDataset";

const allowedKinds = new Set<StateKind>([
  "mailingStatus",
  "componentStatus",
  "reviewedException",
  "crmDataset",
]);

async function ensureSchema() {
  if (!env.DB) throw new Error("Shared CRM database is not available yet.");

  await env.DB.batch([
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS crm_state (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        item_key TEXT NOT NULL,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
    ),
    env.DB.prepare(
      "CREATE UNIQUE INDEX IF NOT EXISTS crm_state_kind_item_key_idx ON crm_state (kind, item_key)",
    ),
  ]);
}

function toStatePayload(rows: Array<{ kind: StateKind; item_key: string; value: string }>) {
  const statusOverrides: Record<string, string> = {};
  const componentOverrides: Record<string, string> = {};
  const reviewed: string[] = [];
  let dataset: unknown = null;

  for (const row of rows) {
    if (row.kind === "mailingStatus") statusOverrides[row.item_key] = row.value;
    if (row.kind === "componentStatus") componentOverrides[row.item_key] = row.value;
    if (row.kind === "reviewedException" && row.value === "1") reviewed.push(row.item_key);
    if (row.kind === "crmDataset" && row.item_key === "current") {
      try {
        dataset = JSON.parse(row.value);
      } catch {
        dataset = null;
      }
    }
  }

  return { statusOverrides, componentOverrides, reviewed, dataset };
}

export async function GET() {
  try {
    await ensureSchema();
    const result = await env.DB.prepare(
      "SELECT kind, item_key, value FROM crm_state ORDER BY updated_at DESC",
    ).all<{ kind: StateKind; item_key: string; value: string }>();

    return Response.json(toStatePayload(result.results ?? []));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load shared CRM state.";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await ensureSchema();
    const payload = (await request.json()) as {
      kind?: StateKind;
      key?: string;
      value?: string;
    };

    const kind = payload.kind;
    const key = payload.key?.trim() ?? "";
    const value = String(payload.value ?? "");

    if (!kind || !allowedKinds.has(kind)) {
      return Response.json({ error: "Unknown shared state type." }, { status: 400 });
    }
    if (!key) {
      return Response.json({ error: "Shared state key is required." }, { status: 400 });
    }
    if (kind === "crmDataset" && key !== "current") {
      return Response.json({ error: "CRM dataset key must be current." }, { status: 400 });
    }

    const id = `${kind}::${key}`;
    await env.DB.prepare(
      `INSERT INTO crm_state (id, kind, item_key, value, updated_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(id) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
    )
      .bind(id, kind, key, value)
      .run();

    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save shared CRM state.";
    return Response.json({ error: message }, { status: 500 });
  }
}
