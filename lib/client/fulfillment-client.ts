import type { FulfillmentControl, FulfillmentExportHistory } from "@/lib/domain/fulfillment";

export interface FulfillmentServerState {
  controls: Record<string, FulfillmentControl>;
  history: FulfillmentExportHistory[];
}

export function fulfillmentControlKey(mailingId: string, sourceRow: string | number): string {
  return `${mailingId}::${sourceRow}`;
}

export async function loadFulfillmentState(batchDate: string): Promise<FulfillmentServerState> {
  if (!batchDate) return { controls: {}, history: [] };
  const response = await fetch(`/api/fulfillment?batchDate=${encodeURIComponent(batchDate)}`, { cache: "no-store" });
  if (!response.ok) throw new Error("Could not load fulfillment controls.");
  const body = await response.json() as { controls?: Array<FulfillmentControl & { appMailingId: string; sourceRow: string }>; history?: FulfillmentExportHistory[] };
  const controls: Record<string, FulfillmentControl> = {};
  for (const row of body.controls || []) controls[fulfillmentControlKey(row.appMailingId, row.sourceRow)] = row;
  return { controls, history: body.history || [] };
}

export async function saveFulfillmentControl(mailingId: string, sourceRow: string | number, control: FulfillmentControl): Promise<void> {
  const response = await fetch("/api/fulfillment", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "control", mailingId, sourceRow: String(sourceRow), control }) });
  if (!response.ok) throw new Error((await response.json().catch(() => ({})) as { error?: string }).error || "Could not save fulfillment control.");
}

export async function recordFulfillmentExport(input: { batchDate: string; batchName: string; exportKind: string; designGroup: string; snapshot: unknown[] }): Promise<void> {
  const response = await fetch("/api/fulfillment", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "recordExport", ...input }) });
  if (!response.ok) throw new Error((await response.json().catch(() => ({})) as { error?: string }).error || "Could not archive fulfillment export.");
}
