import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import MarketingAddresses from "../app/crm/views/marketing-addresses/MarketingAddresses.tsx";

const state = { loading: false, failed: false, rows: [{
  subscriberId: "SUB-1", buyerName: "Taylor Customer", email: "buyer@example.test",
  orderNumber: "202", orderedAt: "2026-09-01T12:00:00Z", billingAddress: "99 Buyer Lane · Boulder, CO, 80301",
  recipientName: "Jamie", mailingAddress: "10 Pine St · Denver, CO, 80202", character: "Ringo",
}] };

test("marketing addresses clearly separates buyer billing and recipient mailing addresses", () => {
  const html = renderToStaticMarkup(MarketingAddresses({ state, query: "", onCustomerClick: () => {} }));
  assert.match(html, /Billing address — marketing only/);
  assert.match(html, /99 Buyer Lane/);
  assert.match(html, /Gift recipient — letter mailing/);
  assert.match(html, /10 Pine St/);
});

test("marketing address buyer link opens the correct customer", () => {
  const calls = [];
  const element = MarketingAddresses({ state, query: "", onCustomerClick: (id) => calls.push(id) });
  const card = element.props.children[1].props.children[0];
  card.props.children[0].props.children[0].props.onClick();
  assert.deepEqual(calls, ["SUB-1"]);
});

test("marketing addresses respects the CRM search", () => {
  const html = renderToStaticMarkup(MarketingAddresses({ state, query: "no match", onCustomerClick: () => {} }));
  assert.match(html, /No captured billing addresses match/);
  assert.doesNotMatch(html, /99 Buyer Lane/);
});
