/**
 * Canonical spec for the subscriber/recipient/subscription/mailing ids
 * app.js generates client-side (buildSubscriberId/buildRecipientId/
 * buildSubscriptionId/buildMailingId in public/app.js). app.js is a
 * non-bundled browser script and can't import this module - its own inline
 * copies of these functions remain the actual source of truth for what the
 * browser sends. This module exists so server-side dual-write code has a
 * tested, parseable spec to match against, instead of re-deriving the
 * format ad hoc. tests/ids.test.mjs verifies this module's output is
 * identical to app.js's real functions for the same input.
 *
 * History: these four ids used to truncate to a fixed character count each
 * (18/22/28/34, plus a 56-char cap inside slug() itself) - a leftover from
 * the original Codex-generated build with no documented reason and nothing
 * downstream depending on it (subscribers.id/subscriptions.id are Postgres
 * `text`, unbounded - see db/schema/). Against the real spreadsheet, that
 * truncation collided distinct people onto the same id: most severely
 * recipientId, where 15 pairs of genuinely different recipients (different
 * names, sometimes different mailing addresses entirely) landed on the same
 * 22-character id because the cutoff fell inside the shared subscriberId
 * prefix, before the recipient-specific name/address ever got a chance to
 * differentiate. subscriptionId inherited the same problem one layer up
 * (built from recipientId + character + plan) - see docs/schema-design.md's
 * mailingId note for the same pattern found there first. Fixed by removing
 * every length cap; verified against the real 1,218-row file to produce
 * zero spurious collisions across all four id types (the only mailingId
 * "collision" left is a genuine spreadsheet duplicate - the same letter
 * number entered three times for one order - which is real, irreducible
 * source-data ambiguity, not an id-generation bug).
 */

function slug(value: string | null | undefined): string {
  return (
    String(value || "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "unknown"
  );
}

export interface SubscriberIdInput {
  email?: string | null;
  recipientName: string;
  address: string;
}

export interface RecipientIdInput {
  subscriberId: string;
  recipientName: string;
  address: string;
}

export interface SubscriptionIdInput {
  recipientId: string;
  character: string;
  plan: string;
}

export interface MailingIdInput {
  orderId: string;
  recipientId: string;
  character: string;
  letterNumber?: string | number | null;
  sourceRow: string | number;
}

export function buildSubscriberId({ email, recipientName, address }: SubscriberIdInput): string {
  const subscriberKey = email || `${slug(recipientName)}-${slug(address)}`;
  return `SUB-${slug(subscriberKey).toUpperCase()}`;
}

export function buildRecipientId({ subscriberId, recipientName, address }: RecipientIdInput): string {
  const recipientKey = `${subscriberId}-${slug(recipientName)}-${slug(address)}`;
  return `REC-${slug(recipientKey).toUpperCase()}`;
}

export function buildSubscriptionId({ recipientId, character, plan }: SubscriptionIdInput): string {
  return `PLAN-${slug(`${recipientId}-${character}-${plan}`).toUpperCase()}`;
}

export function buildMailingId({ orderId, recipientId, character, letterNumber, sourceRow }: MailingIdInput): string {
  return `MAIL-${slug(`${orderId}-${recipientId}-${character}-${letterNumber || sourceRow}`).toUpperCase()}`;
}
