// Shared by every migrated-view equivalence test (tests/automation-view.test.mjs
// was first, Phase 1 step 6 - CLAUDE.md; step 7's tests/launch-view.test.mjs
// is the second consumer, which is what actually makes this a shared
// helper rather than one file's local function - same threshold this
// task itself applied to lib/client/selectors.ts's packetRows).
//
// Proves a React component's server-rendered output is equivalent to a
// frozen legacy template-literal snapshot. Byte-identity isn't
// achievable: JSX discards whitespace-only text between elements on
// separate lines entirely, at compile time, so renderToStaticMarkup()
// produces maximally compact HTML with no gaps between tags at all, while
// the legacy output's whitespace came from real newlines/indentation
// baked into a template literal string. Two strings that render
// identically in a browser can therefore differ on every line of a byte
// diff.
//
// Normalization rules, applied to BOTH sides before comparing - explicitly
// weaker than byte-identity, and worth being honest about why it's still
// the strongest gate available without pulling in an HTML/DOM parser
// dependency this repo doesn't otherwise need (no jsdom/linkedom in
// node_modules):
//
//  1. Trim whitespace (including newlines) immediately after any `>` -
//     removes indentation/newlines a template literal leaves right after
//     an opening or closing tag, whether what follows is another tag or
//     the start of that element's own text content.
//  2. Trim whitespace immediately before any `<` - the mirror of rule 1,
//     for whitespace right before a tag.
//  3. Collapse any remaining whitespace RUN (spaces/newlines/tabs, one or
//     more - now only ever found inside text content, between two real
//     words) to a single space, then trim the whole string - handles text
//     that happens to wrap across source lines without altering its
//     rendered meaning.
//
// Verified against a real edge case rules 1-2 alone don't cover, not just
// asserted (see tests/automation-view.test.mjs's own sanity-check test,
// step 6): naive "only collapse whitespace *between* two tags" leaves
// leading/trailing space stranded right after an opening tag or right
// before a closing one (e.g. "<p>  a  </p>" - the outer spaces sit next
// to only ONE tag, not between two) - rule 3's global collapse-plus-trim
// is what actually closes that gap.
//
// What this does NOT paper over: a real structural difference (a missing
// attribute, reordered/renamed class, different tag, different text)
// survives all three rules unchanged and still fails the comparison - the
// rules only ever remove whitespace, never touch markup, attributes, or
// text content.
export function normalizeHtml(html) {
  return html
    .replace(/>\s+/g, ">")
    .replace(/\s+</g, "<")
    .replace(/\s+/g, " ")
    .trim();
}
