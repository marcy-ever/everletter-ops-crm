export interface PhotoMailingCandidate { id: string; recipientName: string; address?: string }
export interface PhotoNameMatch extends PhotoMailingCandidate { confidence: "clear" | "review"; score: number }

export function normalizedOcrText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function differsByAtMostOne(left: string, right: string): boolean {
  if (Math.abs(left.length - right.length) > 1) return false;
  let edits = 0;
  for (let l = 0, r = 0; l < left.length || r < right.length;) {
    if (left[l] === right[r]) { l += 1; r += 1; continue; }
    if (++edits > 1) return false;
    if (left.length > right.length) l += 1;
    else if (right.length > left.length) r += 1;
    else { l += 1; r += 1; }
  }
  return true;
}

function similarity(name: string, text: string, fuzzy = false): number {
  const tokens = normalizedOcrText(name).split(" ").filter((token) => token.length > 1);
  if (!tokens.length) return 0;
  const words = normalizedOcrText(text).split(" ");
  return tokens.filter((token) => words.includes(token) || (fuzzy && token.length >= 4 && words.some((word) => word.length >= 4 && differsByAtMostOne(token, word)))).length / tokens.length;
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
    const score = similarity(candidate.recipientName, text, true);
    const addressScore = candidate.address ? similarity(candidate.address, text) : 0;
    if (score >= 0.75 && addressScore >= 0.5) {
      matches.push({ ...candidate, confidence: "clear", score: Math.max(score, addressScore) });
      continue;
    }
    if (score >= 0.5 || addressScore >= 0.6) matches.push({ ...candidate, confidence: "review", score: Math.max(score, addressScore) });
  }
  return matches;
}
