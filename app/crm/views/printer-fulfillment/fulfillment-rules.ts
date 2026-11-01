export type EnvelopeSize = "A7" | "A9" | "POSTCARD";

export interface PrinterOutputSettings {
  a7WidthIn: number;
  a7HeightIn: number;
  a9WidthIn: number;
  a9HeightIn: number;
  bleedIn: number;
  cropMarks: boolean;
  envelopeMode: "assembled" | "flat";
}

export const DEFAULT_PRINTER_OUTPUT_SETTINGS: PrinterOutputSettings = {
  a7WidthIn: 7.25,
  a7HeightIn: 5.25,
  a9WidthIn: 8.75,
  a9HeightIn: 5.75,
  bleedIn: 0,
  cropMarks: false,
  envelopeMode: "assembled",
};

export interface SeriesProductionProfile {
  series: string;
  envelopeSize: EnvelopeSize;
  innerEnvelope: string;
  outerEnvelope: string;
  postage: string;
  fontFamily: string;
  fontConfirmed: boolean;
}

const KIDS_POSTAGE = "KIDS USPS stamp";
const ADULT_POSTAGE = "ADULT USPS stamp";

const PROFILES: Record<string, SeriesProductionProfile> = {
  Marley: { series: "Marley", envelopeSize: "A7", innerEnvelope: "Dark pink small inner envelope", outerEnvelope: "Light pink A7 outer envelope", postage: KIDS_POSTAGE, fontFamily: "Quicksand", fontConfirmed: true },
  "Marley - Legacy": { series: "Marley - Legacy", envelopeSize: "A7", innerEnvelope: "Dark pink small inner envelope", outerEnvelope: "Light pink A7 outer envelope", postage: KIDS_POSTAGE, fontFamily: "Quicksand", fontConfirmed: true },
  Gazette: { series: "Gazette", envelopeSize: "A9", innerEnvelope: "Dark pink small inner envelope", outerEnvelope: "Marley identity A9 outer envelope", postage: KIDS_POSTAGE, fontFamily: "Quicksand", fontConfirmed: false },
  Ringo: { series: "Ringo", envelopeSize: "A7", innerEnvelope: "Dark blue small inner envelope", outerEnvelope: "White A7 outer envelope", postage: KIDS_POSTAGE, fontFamily: "Schoolbell", fontConfirmed: true },
  Harper: { series: "Harper", envelopeSize: "A7", innerEnvelope: "Dark purple small inner envelope", outerEnvelope: "Light purple A7 outer envelope", postage: KIDS_POSTAGE, fontFamily: "Anonymous Pro", fontConfirmed: true },
  "Oliver - Legacy": { series: "Oliver - Legacy", envelopeSize: "A7", innerEnvelope: "Dark green small inner envelope", outerEnvelope: "White A7 outer envelope", postage: KIDS_POSTAGE, fontFamily: "Coming Soon", fontConfirmed: false },
  "Oliver - New": { series: "Oliver - New", envelopeSize: "A7", innerEnvelope: "Dark green small inner envelope", outerEnvelope: "White A7 outer envelope", postage: KIDS_POSTAGE, fontFamily: "Coming Soon", fontConfirmed: false },
  Penelope: { series: "Penelope", envelopeSize: "A7", innerEnvelope: "Ivory small inner envelope", outerEnvelope: "Adult A7 outer envelope", postage: ADULT_POSTAGE, fontFamily: "Caveat", fontConfirmed: true },
  Seraphine: { series: "Seraphine", envelopeSize: "A7", innerEnvelope: "Ivory small inner envelope", outerEnvelope: "Adult A7 outer envelope", postage: ADULT_POSTAGE, fontFamily: "Dancing Script", fontConfirmed: true },
  Marigold: { series: "Marigold", envelopeSize: "A7", innerEnvelope: "Ivory small inner envelope", outerEnvelope: "Adult A7 outer envelope", postage: ADULT_POSTAGE, fontFamily: "Gloria Hallelujah", fontConfirmed: true },
  Legends: { series: "Legends", envelopeSize: "A7", innerEnvelope: "HOLD / STOP - CONFIRM inner-envelope color", outerEnvelope: "Legends A7 outer envelope", postage: KIDS_POSTAGE, fontFamily: "Caveat", fontConfirmed: false },
  "Birthday Postcard": { series: "Birthday Postcard", envelopeSize: "POSTCARD", innerEnvelope: "Not used", outerEnvelope: "Not used", postage: "Postcard postage", fontFamily: "Quicksand", fontConfirmed: true },
};

export function productionProfileForSeries(series: string): SeriesProductionProfile | null {
  return PROFILES[series] || null;
}

export function envelopeBatchFileName(batchDate: string, profile: SeriesProductionProfile): string {
  const series = profile.series.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "");
  return `${batchDate}_${series}_${profile.envelopeSize}_Envelopes_ALL.pdf`;
}

export const UNIVERSAL_ASSEMBLY_STEPS = [
  "Print the exact letter/version at 100% actual size.",
  "Fold the letter and place it in the specified colored SMALL INNER envelope.",
  "Leave the inner envelope BLANK and UNSEALED unless a written order exception says otherwise.",
  "Put the inner envelope and every listed artifact/item into the OUTER mailing envelope.",
  "Address and seal the OUTER envelope.",
  "Apply the specified real USPS postage stamp to the OUTER envelope.",
  "Apply the glue/protective sticker to the OUTER envelope, then press the wax seal on top.",
  "Final QA: recipient/address, series/version, letter number, artifacts, envelope, USPS stamp type, glue sticker, and wax seal.",
] as const;
