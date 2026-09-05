export interface PhotoMailingCandidate { id: string; recipientName: string }
export interface PhotoNameMatch extends PhotoMailingCandidate { confidence: "clear" | "review"; score: number }

export function normalizedOcrText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function similarity(name: string, text: string): number {
  const tokens = normalizedOcrText(name).split(" ").filter((token) => token.length > 1);
  if (!tokens.length) return 0;
  const words = new Set(normalizedOcrText(text).split(" "));
  return tokens.filter((token) => words.has(token)).length / tokens.length;
}

export function matchEnvelopeNames(text: string, candidates: PhotoMailingCandidate[]): PhotoNameMatch[] {
  const normalizedText = normalizedOcrText(text);
  const matches: PhotoNameMatch[] = [];
  for (const candidate of candidates) {
    const normalizedName = normalizedOcrText(candidate.recipientName);
    if (normalizedName && normalizedText.includes(normalizedName)) {
      matches.push({ ...candidate, confidence: "clear", score: 1 });
      continue;
    }
    const score = similarity(candidate.recipientName, text);
    if (score >= 0.5) matches.push({ ...candidate, confidence: "review", score });
  }
  return matches;
}
