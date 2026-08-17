/**
 * The seven mailing-component fields (payment/envelope/letter/artifact/
 * insert/location/qa) and each one's valid status values. Matches
 * `app/crm/views/qa/qa-selectors.ts`'s `QA_FIELDS` exactly - two
 * independently-maintained copies, checked by
 * `tests/component-fields-parity.test.mjs`, not merged into one, since
 * this one is a plain data module `lib/validate-shared-state.ts` can use
 * for server-side validation without pulling in a view-owned module.
 *
 * Added for POST /api/shared-state's componentStatus validation
 * (lib/validate-shared-state.ts) - an unknown field or an invalid value
 * for a known field is rejected before it reaches a write. Originally
 * written against `app/crm/legacy-app.js`'s own `qaFields` array (before
 * that file existed as anything but the whole app); `QA_FIELDS` replaced
 * it as the client-side source of truth once Mailing QA migrated to React
 * (Phase 1 step 14 - CLAUDE.md) and the monolith itself was later deleted
 * entirely (Phase 2).
 */

export const COMPONENT_FIELD_OPTIONS: Record<string, string[]> = {
  payment: ["Active", "Needs Check", "CC Failed", "Paused"],
  envelope: ["Need Print", "Printed", "Both Printed", "In Ashley Box", "Not Needed"],
  letter: ["Need Print", "Printed", "Stuffed", "Not Needed"],
  artifact: ["Need Check", "Packed", "Not Needed"],
  insert: ["Need Check", "Packed", "Not Needed"],
  location: ["Marcy", "Ashley", "Batch Bin", "Mailed"],
  qa: ["Open", "Problem", "Ready"],
};
