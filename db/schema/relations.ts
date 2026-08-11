import { relations } from "drizzle-orm";
import { subscribers } from "./subscribers";
import { subscriptions } from "./subscriptions";
import { orders } from "./orders";
import { mailings } from "./mailings";
import { mailingComponents } from "./mailing_components";
import { exceptions } from "./exceptions";
import { stagingLocations } from "./staging_locations";

// Kept in one file, separate from the table definitions, rather than
// alongside each table - relations() calls between entity files would
// otherwise need circular imports (e.g. subscribers.ts importing
// subscriptions.ts for `many(subscriptions)`, while subscriptions.ts
// imports subscribers.ts for the FK's `.references()`). Table files only
// ever import "upward" (child imports parent for `.references()`), so this
// file - which imports everything - is the only place that needs to see
// both directions at once.

export const subscribersRelations = relations(subscribers, ({ many }) => ({
  subscriptions: many(subscriptions),
}));

export const subscriptionsRelations = relations(subscriptions, ({ one, many }) => ({
  subscriber: one(subscribers, {
    fields: [subscriptions.subscriberId],
    references: [subscribers.id],
  }),
  orders: many(orders),
  mailings: many(mailings),
  exceptions: many(exceptions),
}));

export const ordersRelations = relations(orders, ({ one }) => ({
  subscription: one(subscriptions, {
    fields: [orders.subscriptionId],
    references: [subscriptions.id],
  }),
}));

export const mailingsRelations = relations(mailings, ({ one, many }) => ({
  subscription: one(subscriptions, {
    fields: [mailings.subscriptionId],
    references: [subscriptions.id],
  }),
  stagingLocation: one(stagingLocations, {
    fields: [mailings.stagingLocationId],
    references: [stagingLocations.id],
  }),
  components: many(mailingComponents),
  exceptions: many(exceptions),
}));

export const mailingComponentsRelations = relations(mailingComponents, ({ one }) => ({
  mailing: one(mailings, {
    fields: [mailingComponents.mailingId],
    references: [mailings.id],
  }),
}));

export const exceptionsRelations = relations(exceptions, ({ one }) => ({
  subscription: one(subscriptions, {
    fields: [exceptions.subscriptionId],
    references: [subscriptions.id],
  }),
  mailing: one(mailings, {
    fields: [exceptions.mailingId],
    references: [mailings.id],
  }),
}));

export const stagingLocationsRelations = relations(stagingLocations, ({ many }) => ({
  mailings: many(mailings),
}));
