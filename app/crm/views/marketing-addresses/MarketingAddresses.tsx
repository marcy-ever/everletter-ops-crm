import type { MarketingAddressState } from "@/lib/client/marketing-addresses";
import { includesText } from "@/lib/client/selectors";

export default function MarketingAddresses({ state, query, onCustomerClick }: { state: MarketingAddressState | null; query: string; onCustomerClick: (subscriberId: string) => void }) {
  if (!state || state.loading) return <section className="data-panel"><p className="empty-state">Loading marketing addresses…</p></section>;
  if (state.failed) return <section className="data-panel"><p className="empty-state">Could not load marketing addresses.</p></section>;
  const rows = state.rows.filter((row) => includesText([row.buyerName, row.email, row.billingAddress, row.recipientName, row.mailingAddress, row.character, row.orderNumber], query));
  return <section className="data-panel" aria-label="Marketing addresses">
    <div className="panel-head"><div><h3>Marketing Addresses</h3><p>Buyer billing addresses for thank-you notes and marketing. These are never used for mailing customer letters.</p></div><span className="panel-count">{rows.length} records</span></div>
    {rows.length ? <div className="marketing-address-list">{rows.map((row) => <article className="marketing-address-card" key={`${row.orderNumber}:${row.subscriberId}`}>
      <div className="marketing-address-buyer"><button type="button" className="link-button recipient-profile-link" onClick={() => onCustomerClick(row.subscriberId)}>{row.buyerName}</button><span>{row.email}</span><small>Order #{row.orderNumber}</small></div>
      <div><span className="section-label">Billing address — marketing only</span><strong>{row.billingAddress}</strong></div>
      <div><span className="section-label">Gift recipient — letter mailing</span><strong>{row.recipientName}</strong><span>{row.mailingAddress}</span><small>{row.character}</small></div>
    </article>)}</div> : <p className="empty-state">No captured billing addresses match this search yet.</p>}
  </section>;
}
