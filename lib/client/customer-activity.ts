export interface CustomerActivityEvent {
  id: number;
  occurredAt: string;
  actorEmail: string | null;
  kind: string;
  previousValue: string | null;
  newValue: string;
}

export interface CustomerActivityState {
  loading: boolean;
  failed: boolean;
  events: CustomerActivityEvent[];
}

export async function loadCustomerActivity(subscriberId: string): Promise<CustomerActivityEvent[]> {
  const response = await fetch(`/api/customer-activity?subscriberId=${encodeURIComponent(subscriberId)}`, { cache: "no-store" });
  if (!response.ok) throw new Error("Could not load customer activity.");
  const body = await response.json() as { events?: CustomerActivityEvent[] };
  return Array.isArray(body.events) ? body.events : [];
}
