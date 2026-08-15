/**
 * The seven mailing-component fields (payment/envelope/letter/artifact/
 * insert/location/qa) and each one's valid status values. Mirrors
 * app/crm/legacy-app.js's `qaFields` array exactly (verified directly
 * against every `<option>` list in that file, including the ones
 * duplicated inline in renderBins()/packet cards rather than reading
 * qaFields itself - all confirmed identical).
 *
 * Added for POST /api/shared-state's componentStatus validation
 * (lib/validate-shared-state.ts) - an unknown field or an invalid value
 * for a known field is rejected before it reaches a write. Not imported
 * by app/crm/legacy-app.js itself (yet) - that file keeps its own
 * `qaFields` (and the three places that duplicate its values inline)
 * untouched; this is a deliberate server-validation-only scope decision,
 * not an oversight - see the PR that added this file.
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
