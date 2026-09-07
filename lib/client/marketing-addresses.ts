export interface MarketingAddressRow {
  subscriberId: string;
  buyerName: string;
  email: string;
  orderNumber: string;
  orderedAt: string;
  billingAddress: string;
  recipientName: string;
  mailingAddress: string;
  character: string;
}

export interface MarketingAddressState {
  loading: boolean;
  failed: boolean;
  rows: MarketingAddressRow[];
}

export async function loadMarketingAddresses(): Promise<MarketingAddressRow[]> {
  const response = await fetch("/api/marketing-addresses");
  if (!response.ok) throw new Error("Could not load marketing addresses.");
  return (await response.json()).rows;
}
