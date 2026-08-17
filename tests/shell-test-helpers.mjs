// Two stubs, sized to what's actually needed after Phase 2 (the app.js
// decomposition's monolith deletion - CLAUDE.md) removed
// tests/e2e-helpers.mjs's loadAppJsSandbox():
//
// installLocalStorageStub() - Node has no global `localStorage` at all, and
// lib/client/crm-state.ts's write-through mutators (updateMailingStatus/
// updateComponentStatus/updateEnvelopeStatus) call
// lib/client/local-overrides.ts's save*Overrides() unconditionally as part
// of every write, which reference the bare `localStorage` identifier - so
// EVERY e2e write-path test that calls one of those mutators needs this,
// not just tests that also touch document/window. Kept separate from
// installShellDomStub() below so a test that only needs this doesn't have
// to pull in (or explain why it doesn't use) a document/fetch stub it
// never touches.
//
// installShellDomStub() - the fuller document/window stub for the smaller
// set of tests that genuinely need one: app/crm/shell/render-shell.ts's
// renderView() (document.querySelectorAll('.side-nav button')) and
// app/crm/shell/init-crm-app.ts's bootCrmApp() (visibilitychange wiring,
// element lookups). Calls installLocalStorageStub() itself, so a caller
// needing both never has to call both separately.
//
// Both write onto the real, shared globalThis, same as the harness they
// replace - safe because node:test runs a file's tests sequentially (see
// docs/testing.md), not because of any isolation these stubs themselves
// provide. Call fresh at the start of every test that needs one.
export function installLocalStorageStub() {
  globalThis.localStorage = { getItem: () => null, setItem() {} };
}

export function installShellDomStub() {
  installLocalStorageStub();
  const elementsBySelector = new Map();

  function makeStubElement() {
    let html = "";
    return {
      addEventListener() {},
      querySelectorAll: () => [],
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      style: {},
      dataset: {},
      getAttribute: () => null,
      setAttribute() {},
      querySelector: () => makeStubElement(),
      get innerHTML() {
        return html;
      },
      set innerHTML(value) {
        html = value;
      },
    };
  }

  function queryDocument(selector) {
    if (!elementsBySelector.has(selector)) elementsBySelector.set(selector, makeStubElement());
    return elementsBySelector.get(selector);
  }

  let visibilityState = "visible";
  const visibilityListeners = new Set();

  globalThis.document = {
    querySelector: queryDocument,
    querySelectorAll: () => [],
    get visibilityState() {
      return visibilityState;
    },
    addEventListener(type, listener) {
      if (type === "visibilitychange") visibilityListeners.add(listener);
    },
    removeEventListener(type, listener) {
      if (type === "visibilitychange") visibilityListeners.delete(listener);
    },
  };
  globalThis.window = { EVERLETTER_SEED: undefined, location: { hash: "" } };
  globalThis.fetch = async () => ({ ok: false, json: async () => ({}) });

  return {
    getCapturedHtml: (selector) => elementsBySelector.get(selector)?.innerHTML ?? "",
    // Simulates the real trigger for a 'visibilitychange' event (the
    // property changing, then the event firing).
    setDocumentVisibility(next) {
      visibilityState = next;
      visibilityListeners.forEach((listener) => listener());
    },
  };
}
