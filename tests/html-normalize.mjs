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
//  4. Collapse a boolean HTML attribute written as `attr=""` down to the
//     bare `attr` - added in step 8 (Sync Simulator), the first migrated
//     view with a <select>. Legacy template literals write a conditional
//     boolean attribute as a bare word via `${cond ? 'selected' : ''}`
//     (nothing at all when false, literally just `selected` when true);
//     React's controlled <select value=...> - the idiomatic way to mark
//     an <option> selected without triggering React's own "use value/
//     defaultValue, not selected on <option>" warning - renders the true
//     case as `selected=""` in static markup instead (verified directly,
//     not assumed). Same meaning in every browser, different bytes.
//     Narrowly scoped to the `attr=""` shape specifically (not "any empty
//     attribute") so it can't quietly paper over an attribute that's
//     meaningfully, deliberately empty on one side and absent on the
//     other - it only ever unifies two spellings of the same boolean-true
//     state.
//  5. Collapse whitespace immediately before a tag's closing `>` (or
//     self-closing `/>`) down to nothing - also step 8, also
//     <select>-driven. Legacy's per-option template literal is
//     `<option value="${v}" ${selected}>` - when `selected` is the
//     empty-string branch, that leaves a stray space sitting between the
//     last real attribute and `>` (`value="..." >`); the self-closing
//     `<input ... ${x} />`-shaped case (e.g. the date input, whose markup
//     has no conditional attribute at all but still carries the same
//     trailing-space-before-`/>` habit throughout this codebase's
//     template literals) needs the identical fix one character later.
//     Rules 1-2 don't reach either: rule 1 only trims whitespace AFTER
//     `>`, rule 2 only trims whitespace BEFORE `<` - neither covers
//     whitespace before `>`/`/>` itself, sitting inside the tag's own
//     attribute list rather than between two tags or around text. React's
//     static output never has anything to trim here (JSX simply omits an
//     absent attribute, space included, and always self-closes a void
//     element as `/>` with no preceding space), so without this rule
//     otherwise-identical markup fails the comparison over a single
//     leftover space character. Scoped to whitespace immediately before
//     `>`/`/>`; can't touch text content, since escapeHtml() means a
//     literal, unescaped `>` never appears there.
//  6. Collapse React's numeric apostrophe entity (`&#x27;`) and legacy's
//     named-decimal one (`&#039;`) to the same spelling - added in step 9
//     (Sample Requests), the first migrated view whose real text/attribute
//     content contains an apostrophe ("Ringo Collector's Path"). Legacy's
//     escapeHtml() (app/crm/format.ts) hand-escapes `'` as `&#039;`;
//     React's own automatic text/attribute escaping in
//     renderToStaticMarkup() uses `&#x27;` instead (verified directly).
//     Both decode to the identical character (U+0027 APOSTROPHE) in every
//     browser - this rule doesn't touch `&amp;`/`&lt;`/`&gt;`/`&quot;`,
//     which are already spelled identically on both sides (also verified
//     directly), so it's scoped to the one entity that actually differs.
//  7. Strip React's automatically-injected `<link rel="preload"
//     as="image" href="...">` tags entirely - also step 9, and the one
//     rule here that removes real elements rather than normalizing a
//     spelling. Samples is the first migrated view with an <img> (the
//     sample-letter thumbnails); react-dom's server renderer emits a
//     preload hint for every image it encounters (verified directly with
//     a minimal repro - any <img src="..."> produces a sibling
//     `<link rel="preload" as="image" href="...">` immediately before
//     it), a real optimization with nowhere to go but inline since
//     renderToStaticMarkup() has no `<head>` to route it into. Legacy
//     never produced these (a raw <img> tag, no preload mechanism at
//     all), and neither snapshot side should be expected to contain them
//     - they're genuinely extra elements, not a rewritten spelling of
//     something already there, so they're removed outright rather than
//     collapsed into a shared form. Scoped to that exact `rel`/`as` pair
//     so it can't accidentally eat an unrelated, deliberately-authored
//     preload link some future view might add for a real reason.
//
// What this does NOT paper over: a real structural difference (a missing
// attribute, reordered/renamed class, different tag, different text)
// survives all seven rules unchanged and still fails the comparison - the
// rules only ever remove whitespace, remove React's own auto-injected
// image-preload hints, or normalize a boolean-attribute or
// apostrophe-entity spelling; they never touch real markup, real
// attribute values, or text content.
export function normalizeHtml(html) {
  return html
    .replace(/<link rel="preload" as="image"[^>]*\/>/g, "")
    .replace(/>\s+/g, ">")
    .replace(/\s+</g, "<")
    .replace(/\s+/g, " ")
    .replace(/(\s[a-zA-Z-]+)=""/g, "$1")
    .replace(/\s+(\/?>)/g, "$1")
    .replace(/&#x27;/g, "&#039;")
    .trim();
}
