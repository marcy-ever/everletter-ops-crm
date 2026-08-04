// TEMPORARY: the Cloudflare D1 (`cloudflare:workers` env.DB) backing for this
// route was removed as part of dropping the Cloudflare Worker/Sites runtime.
// Persistence is being migrated to self-hosted Postgres via Drizzle in a
// follow-up step; until then this route is a non-persistent stub so the app
// can build/run under plain Next.js. The client already falls back to
// localStorage/seed data when this returns an empty/error state.

type StateKind = "mailingStatus" | "componentStatus" | "reviewedException" | "crmDataset";

const allowedKinds = new Set<StateKind>([
  "mailingStatus",
  "componentStatus",
  "reviewedException",
  "crmDataset",
]);

export async function GET() {
  return Response.json({
    statusOverrides: {},
    componentOverrides: {},
    reviewed: [],
    dataset: null,
  });
}

export async function POST(request: Request) {
  const payload = (await request.json()) as {
    kind?: StateKind;
    key?: string;
    value?: string;
  };

  const kind = payload.kind;
  const key = payload.key?.trim() ?? "";

  if (!kind || !allowedKinds.has(kind)) {
    return Response.json({ error: "Unknown shared state type." }, { status: 400 });
  }
  if (!key) {
    return Response.json({ error: "Shared state key is required." }, { status: 400 });
  }
  if (kind === "crmDataset" && key !== "current") {
    return Response.json({ error: "CRM dataset key must be current." }, { status: 400 });
  }

  return Response.json(
    { error: "Shared CRM persistence is temporarily unavailable (Postgres migration pending)." },
    { status: 503 },
  );
}
