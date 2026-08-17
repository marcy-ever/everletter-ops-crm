/**
 * Sample Requests' own derivation and static content, migrated from
 * app/crm/legacy-app.js's renderSamples() (Phase 1 step 9 - CLAUDE.md).
 * View-specific, not cross-view, so it lives beside its component - same
 * boundary step 7 (Launch Plan) drew.
 *
 * SAMPLE_ASSETS and SAMPLE_FLOWS are static content with no dependency on
 * `state` at all (legacy declared them as local literals inside
 * renderSamples() itself, recomputed - identically - on every render).
 * Module-level constants here instead: same values, computed once, and
 * the one place either list exists now, so nothing importing this module
 * can accidentally redeclare a second, drifting copy of the sample
 * library. Only sampleRows actually depends on `sampleType`.
 */

export interface SampleAsset {
  title: string;
  type: "Kid" | "Adult";
  file: string;
  note: string;
}

export const SAMPLE_ASSETS: SampleAsset[] = [
  {
    title: "Marley Meadow Charm",
    type: "Kid",
    file: "/assets/sample-letter-marley.png",
    note: "Soft, whimsical kid sample with envelope and wax-seal context.",
  },
  {
    title: "Ringo Collector's Path",
    type: "Kid",
    file: "/assets/sample-letter-ringo.png",
    note: "Adventure kid sample with map, envelope, seal, and artifact feel.",
  },
  {
    title: "Penelope Folded Note",
    type: "Adult",
    file: "/assets/sample-letter-penelope.png",
    note: "Romantic mystery sample with envelope, paper texture, and wax-seal mood.",
  },
  {
    title: "Seraphine Loft Letter",
    type: "Adult",
    file: "/assets/sample-letter-seraphine.png",
    note: "Soft literary adult sample with handmade paper, seal, and keepsake feel.",
  },
];

export interface SampleFlowStep {
  title: string;
  detail: string;
}

export const SAMPLE_FLOWS: SampleFlowStep[] = [
  { title: "Request captured", detail: "Squarespace form submits email, sample type, source page, and timestamp into the CRM." },
  { title: "Lead created", detail: "CRM creates or updates a Sample Request record and keeps Gmail out of the manual entry loop." },
  { title: "Mailchimp tagged", detail: "CRM adds the email to Mailchimp with sample-kid or sample-adult plus the source." },
  { title: "Sample sent", detail: "Mailchimp Customer Journey sends the correct sample letter automatically." },
  { title: "Conversion matched", detail: "If the same email later buys, CRM links the sample request to the subscriber profile." },
];

export interface SampleRow {
  type: "Kid" | "Adult";
  tag: string;
  template: string;
  status: "Selected" | "Ready";
}

export interface SamplesData {
  sampleType: string;
  sampleRows: SampleRow[];
  sampleAssets: SampleAsset[];
  flows: SampleFlowStep[];
}

// sampleType drives three separate parts of the rendered output: the
// toggle's `active` class (read directly off data.sampleType by the
// component), the Mailchimp-fields tag (same), and sampleRows' Selected/
// Ready status below - all three need covering when testing either
// sampleType value, not just the default.
export function computeSamplesData(sampleType: string): SamplesData {
  const sampleRows: SampleRow[] = [
    { type: "Kid", tag: "sample-kid", template: "Kid sample letter", status: sampleType === "Kid" ? "Selected" : "Ready" },
    { type: "Adult", tag: "sample-adult", template: "Adult sample letter", status: sampleType === "Adult" ? "Selected" : "Ready" },
  ];
  return { sampleType, sampleRows, sampleAssets: SAMPLE_ASSETS, flows: SAMPLE_FLOWS };
}
