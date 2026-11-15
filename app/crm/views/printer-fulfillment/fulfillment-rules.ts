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
export const PRINTER_ADDRESS_FONT = "Arial";

const PROFILES: Record<string, SeriesProductionProfile> = {
  Marley: { series: "Marley", envelopeSize: "A7", innerEnvelope: "Dark pink small inner envelope", outerEnvelope: "Marley A7 artwork", postage: KIDS_POSTAGE, fontFamily: PRINTER_ADDRESS_FONT, fontConfirmed: true },
  "Marley - Legacy": { series: "Marley - Legacy", envelopeSize: "A7", innerEnvelope: "Dark pink small inner envelope", outerEnvelope: "Marley Legacy A7 artwork", postage: KIDS_POSTAGE, fontFamily: PRINTER_ADDRESS_FONT, fontConfirmed: true },
  Gazette: { series: "Gazette", envelopeSize: "A9", innerEnvelope: "Dark pink small inner envelope", outerEnvelope: "Gazette A9 artwork", postage: KIDS_POSTAGE, fontFamily: PRINTER_ADDRESS_FONT, fontConfirmed: true },
  "North Pole": { series: "North Pole", envelopeSize: "A9", innerEnvelope: "North Pole insert package", outerEnvelope: "North Pole A9 artwork", postage: KIDS_POSTAGE, fontFamily: PRINTER_ADDRESS_FONT, fontConfirmed: true },
  Ringo: { series: "Ringo", envelopeSize: "A7", innerEnvelope: "Dark blue small inner envelope", outerEnvelope: "Ringo A7 artwork", postage: KIDS_POSTAGE, fontFamily: PRINTER_ADDRESS_FONT, fontConfirmed: true },
  Harper: { series: "Harper", envelopeSize: "A7", innerEnvelope: "Dark purple small inner envelope", outerEnvelope: "Harper A7 artwork", postage: KIDS_POSTAGE, fontFamily: PRINTER_ADDRESS_FONT, fontConfirmed: true },
  "Oliver - Legacy": { series: "Oliver - Legacy", envelopeSize: "A7", innerEnvelope: "Dark green small inner envelope", outerEnvelope: "Oliver Legacy A7 artwork", postage: KIDS_POSTAGE, fontFamily: PRINTER_ADDRESS_FONT, fontConfirmed: true },
  "Oliver - New": { series: "Oliver - New", envelopeSize: "A7", innerEnvelope: "Dark green small inner envelope", outerEnvelope: "Oliver New A7 artwork", postage: KIDS_POSTAGE, fontFamily: PRINTER_ADDRESS_FONT, fontConfirmed: true },
  Penelope: { series: "Penelope", envelopeSize: "A7", innerEnvelope: "Ivory small inner envelope", outerEnvelope: "Penelope A7 artwork", postage: ADULT_POSTAGE, fontFamily: PRINTER_ADDRESS_FONT, fontConfirmed: true },
  Seraphine: { series: "Seraphine", envelopeSize: "A7", innerEnvelope: "Ivory small inner envelope", outerEnvelope: "Seraphine A7 artwork", postage: ADULT_POSTAGE, fontFamily: PRINTER_ADDRESS_FONT, fontConfirmed: true },
  Marigold: { series: "Marigold", envelopeSize: "A7", innerEnvelope: "Ivory small inner envelope", outerEnvelope: "Marigold A7 artwork", postage: ADULT_POSTAGE, fontFamily: PRINTER_ADDRESS_FONT, fontConfirmed: true },
  Legends: { series: "Legends", envelopeSize: "A7", innerEnvelope: "Legends small inner envelope", outerEnvelope: "Legends A7 artwork", postage: KIDS_POSTAGE, fontFamily: PRINTER_ADDRESS_FONT, fontConfirmed: true },
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
