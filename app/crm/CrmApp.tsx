"use client";

import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { todayIso } from "@/lib/domain/mailing-rules";
import { effectiveMailings, type EffectiveMailing } from "@/lib/client/selectors";
import { saveReviewedExceptions } from "@/lib/client/local-overrides";
import { saveSharedDataset, saveSharedState } from "@/lib/client/shared-state-client";
import {
  driveConfig,
  getRenderGeneration,
  initCrmApp,
  letterFolderUrl,
  notifyViewChanged,
  openDriveLink,
  render,
  saveFailures,
  staleness,
  state,
  subscribeViewChanged,
  updateComponentStatus,
  updateEnvelopeStatus,
  updateMailingStatus,
  VIEW_REGISTRY,
} from "./legacy-app.js";
import Automation from "./views/Automation";
import type { AutomationRule } from "./views/Automation";
import LaunchPlan from "./views/launch-plan/LaunchPlan";
import { computeLaunchPlanData } from "./views/launch-plan/launch-selectors";
import Sync from "./views/sync/Sync";
import { computeSyncPreview, defaultSyncSubscriberId, defaultSyncSubscriptionId } from "./views/sync/sync-selectors";
import Samples from "./views/samples/Samples";
import { computeSamplesData } from "./views/samples/samples-selectors";
import Exceptions from "./views/exceptions/Exceptions";
import { computeExceptionRows } from "./views/exceptions/exceptions-selectors";
import Import from "./views/import/Import";
import { computeImportData, defaultAutomationRules, readWorkbookFile } from "./views/import/import-selectors";
import Subscribers from "./views/subscribers/Subscribers";
import { computeSubscriberProfile, computeSubscriberRows, printedEnvelopeStatusForMailing, selectSubscriber } from "./views/subscribers/subscribers-selectors";
import Queue from "./views/queue/Queue";
import { computeQueueRows } from "./views/queue/queue-selectors";
import Qa from "./views/qa/Qa";
import { computeQaData, printedEnvelopeStatusForMailing as qaPrintedEnvelopeStatusForMailing } from "./views/qa/qa-selectors";
import Packet from "./views/packet/Packet";
import { computePacketData } from "./views/packet/packet-selectors";
import Bins from "./views/bins/Bins";
import { computeBinsData } from "./views/bins/bins-selectors";
import Print from "./views/envelope-print/Print";
import { computePrintData } from "./views/envelope-print/print-selectors";
import { envelopePrintRows, openEnvelopePrint } from "./views/envelope-print/envelope-html";

// Mounts the legacy CRM monolith into the DOM markup app/page.tsx already
// renders (#viewMount, #topbarMeta, the side-nav buttons, etc.) instead of
// loading it as a separate <Script> tag, AND - as of Phase 1, step 6 of
// the app.js decomposition (CLAUDE.md) - hosts migrated React views
// alongside the eleven still-legacy ones.
//
// The hosting seam, and why it's built this way:
//
//  - state.activeView (app/crm/legacy-app.js) stays the single source of
//    truth for which view is showing, mutated directly by legacy nav
//    handlers exactly as before this change. This component does NOT
//    duplicate it into React state (a second source of truth for "which
//    view is showing" is exactly the kind of problem this project's
//    guidance rules out) - it OBSERVES it, via useSyncExternalStore, the
//    real React API for subscribing to state that lives outside React's
//    own tree. subscribeViewChanged() (lib/client/crm-state.ts, exported
//    from legacy-app.js) is called every time app/crm/legacy-app.js's
//    renderView() runs - i.e. every time the active view might have
//    changed, regardless of which code path changed it - so this
//    component doesn't need to know about individual nav-click/hash-load
//    call sites, only that a render happened.
//  - getSnapshot and getServerSnapshot are the same function
//    (getViewSnapshot) rather than two: whatever it returns is identical
//    at SSR time and at the moment of React's first client render
//    (initCrmApp() only ever runs inside the effect below, strictly after
//    that first render), so there's no value they could ever legitimately
//    disagree on - using one function makes that guarantee explicit
//    instead of hoping two separately-written functions stay in sync.
//    The snapshot itself combines state.activeView with
//    getRenderGeneration() (lib/client/crm-state.ts) rather than watching
//    state.activeView alone - added in step 8 (Sync Simulator), the first
//    interactive migrated view: a form-control change mutates
//    state.syncSubscriberId/etc., never state.activeView, so a snapshot
//    of state.activeView alone would never look different to
//    useSyncExternalStore's Object.is check and React would correctly (by
//    that hook's own contract) skip re-rendering. getRenderGeneration()
//    changes on every notifyViewChanged() call regardless of what
//    prompted it, so the combined snapshot always looks new when a render
//    might actually be needed. See lib/client/crm-state.ts's own header
//    for the full before/after reasoning - this was a real gap step 6/7
//    never hit because neither Automation nor Launch Plan had inputs.
//  - React gets its own mount element, #reactViewMount (app/page.tsx),
//    separate from #viewMount. Legacy code writes into #viewMount via
//    raw innerHTML; if React also owned that same node, legacy's next
//    innerHTML write and React's next reconciliation pass would fight
//    over it - a real bug, not a theoretical one. Rendered via
//    createPortal so this component's actual position in the React tree
//    (a sibling of the legacy DOM apparatus, not inside it) doesn't have
//    to match where its output visually needs to appear.
//    app/crm/legacy-app.js's renderView() clears #viewMount whenever the
//    active view is React-hosted (has no `render` function in
//    VIEW_REGISTRY), and this component returns null - which React
//    correctly reconciles as "remove whatever was in #reactViewMount" -
//    for every view that isn't. Exactly one of the two mounts holds
//    content at any moment, by construction on both sides.
//  - VIEW_REGISTRY (app/crm/legacy-app.js) is read here too, not
//    duplicated - a view is React-hosted according to the *same* single
//    registry renderView() already checks, so this component and
//    renderView() can never disagree about which views are which.
//
// REACT_VIEWS (added in step 7, alongside Launch Plan) is the same lesson
// this codebase already learned once, one layer over: step 5 replaced
// renderView()'s per-view if-chain with VIEW_REGISTRY once enough legacy
// views existed that the chain was real, not speculative, duplication.
// Two React-hosted views is exactly that same moment for this dispatch -
// a second `if (activeView === "launch") {...}` here would be the
// beginning of the identical chain, so it's a lookup table from the
// start instead. Each entry computes its own props from `state` (the
// single explicit place `new Date()` is ever called for a migrated view -
// see launch-selectors.ts's own header on why the view itself never
// reaches for the clock) and returns the element to portal.
//
// Guards on `state.seed` being non-null for views that need real data:
// Automation degrades gracefully with an empty rules array (its 7 static
// flow steps still render), but Launch Plan's computation does real
// property access on `seed` and has no sensible "empty" rendering to
// fall back to - and neither legacy views nor Automation actually show
// anything before state.seed loads either (nothing calls render() until
// then), so "render nothing yet" is the existing behavior, not a new one.
// The one, shared [data-bin-select] write handler - Ashley Bins' own
// reference implementation (step 16, CLAUDE.md), reused as-is by Batch
// Packet's mobile cards (wired in this same step, second commit) rather
// than each view carrying its own copy. Plain updateComponentStatus, no
// envelope-status fan-out - matches legacy's own real [data-bin-select]
// handler (app/crm/legacy-app.js's former renderBins()) exactly, and is
// now the only place this exact write shape is implemented at all.
// notifyViewChanged() alone: legacy's own handler called renderBins()
// only, never render() - this write never touches shell metrics.
function updateBinComponentStatus(mailing: EffectiveMailing, field: string, value: string) {
  updateComponentStatus(mailing, field, value);
  notifyViewChanged();
}

const REACT_VIEWS: Record<string, () => ReactNode> = {
  automation: () => {
    const automationRules = (state.seed?.automationRules as AutomationRule[] | undefined) ?? [];
    return <Automation automationRules={automationRules} />;
  },
  launch: () => {
    if (!state.seed) return null;
    const data = computeLaunchPlanData(
      state.seed,
      effectiveMailings(state.seed, state.statusOverrides),
      state.reviewed,
      state.componentOverrides,
      state.batchFilter,
      state.packetScope,
      state.query,
      todayIso(new Date()),
    );
    return <LaunchPlan data={data} />;
  },
  // The first interactive migrated view - see this file's own header on
  // getViewSnapshot() for why that's what forced the render-generation
  // fix. Lazy-initializes state.syncSubscriberId/syncSubscriptionId on
  // first render exactly like the removed legacy renderSync() did inline
  // ("if (!state.syncSubscriberId) {...}") - a real `state` mutation, so
  // it happens here (the one place besides legacy-app.js allowed to touch
  // `state` for a React-hosted view), not inside the pure
  // defaultSyncSubscriberId()/defaultSyncSubscriptionId() selectors those
  // values come from. Each onXxxChange handler mirrors exactly what the
  // legacy <select>/<input> onchange handlers it replaces did: write into
  // `state`, then notifyViewChanged() - the same signal renderView()
  // fires on every legacy render, so this component doesn't need a
  // separate re-render mechanism of its own.
  sync: () => {
    if (!state.seed) return null;
    if (!state.syncSubscriberId) {
      state.syncSubscriberId = defaultSyncSubscriberId(state.seed);
      state.syncSubscriptionId = defaultSyncSubscriptionId(state.syncSubscriberId, state.seed);
    }
    const data = computeSyncPreview(state.seed, state.syncSubscriberId, state.syncSubscriptionId, state.syncPlan, state.syncOrderDate);
    return (
      <Sync
        data={data}
        onSubscriberChange={(subscriberId) => {
          state.syncSubscriberId = subscriberId;
          state.syncSubscriptionId = state.seed ? defaultSyncSubscriptionId(subscriberId, state.seed) : "";
          notifyViewChanged();
        }}
        onPlanChange={(plan) => {
          state.syncPlan = plan;
          notifyViewChanged();
        }}
        onOrderDateChange={(orderDate) => {
          state.syncOrderDate = orderDate;
          notifyViewChanged();
        }}
        onSubscriptionChange={(subscriptionId) => {
          state.syncSubscriptionId = subscriptionId;
          notifyViewChanged();
        }}
      />
    );
  },
  // No state.seed guard - unlike Launch Plan/Sync, nothing here reads the
  // dataset at all (sampleRows/sampleAssets/flows are all either static
  // or derived from state.sampleType alone), so this view can render
  // before the dataset loads, the same way Automation degrades gracefully.
  //
  // onOpenSample is the new shape this view introduces: a callback that
  // performs a browser action (window.open) instead of mutating `state` -
  // deliberately no notifyViewChanged() call here, since nothing rendered
  // depends on whether a sample was opened. onSampleTypeChange is the
  // familiar mutate-then-notify shape every other callback in this file
  // uses.
  samples: () => {
    const data = computeSamplesData(state.sampleType);
    return (
      <Samples
        data={data}
        onSampleTypeChange={(type) => {
          state.sampleType = type;
          notifyViewChanged();
        }}
        onOpenSample={(file) => {
          window.open(file, "_blank", "noopener,noreferrer");
        }}
      />
    );
  },
  // The first migrated view that writes to the server, and the first
  // callback in this file to call render() instead of notifyViewChanged()
  // - a real, reported finding, not a stylistic choice. Every earlier
  // interactive view's state (state.syncXxx, state.sampleType) is read
  // ONLY by that view's own React component, so notifyViewChanged() alone
  // (which renderView() already calls, and which this component observes
  // via getViewSnapshot() below) was sufficient. Reviewing an exception is
  // different: it changes activeExceptions().length, which
  // renderShell() - a legacy, DOM-writing function entirely outside
  // #viewMount/#reactViewMount, untouched by any React-hosted view so far
  // - reads to paint the "Needs review" metric card and (transitively,
  // via effectiveMailings()) the rest of the topbar. The removed legacy
  // [data-review] handler called render() (renderShell() + renderView()),
  // not renderView() alone - calling only notifyViewChanged() here would
  // have silently dropped the metric-card refresh, a real regression from
  // legacy, not just a style mismatch. render() is already exported (see
  // legacy-app.js's own export list) and its renderView() half still ends
  // in notifyViewChanged(), so this one call reproduces legacy's exact
  // behavior: the shell's counts update AND this component re-renders
  // with the reviewed exception now excluded from activeExceptions().
  //
  // onReview's body mirrors the removed legacy handler's exactly:
  // state.reviewed.add(key) (a Set mutation, same pattern as every other
  // direct `state` write in this file), persist to localStorage
  // (saveReviewedExceptions - the local cache every override already
  // uses), POST to the server (saveSharedState, imported directly from
  // lib/client/ rather than re-exported from legacy-app.js, since nothing
  // else needs it there - unlike saveFailures/staleness, which ARE
  // imported from legacy-app.js because they must be the exact same
  // store instances legacy's own #saveFailureBanner/#stalenessBanner
  // subscriptions already read from), then render(). The optimistic-
  // update shape (state mutated and rendered before the POST resolves) is
  // unchanged from legacy - see CLAUDE.md's Known Issues on
  // saveSharedState's own async/optimistic design; a rejected save
  // surfaces independently via saveFailures' own subscription
  // (#saveFailureBanner render is deliberately independent of
  // renderShell()/renderView(), per that function's own comment), and a
  // successful save's own response marker advances staleness's
  // myMarker/serverMarker together (recordMarkerFromBody, inside
  // saveSharedState) so this user's own review can never flag their own
  // page stale - both already-existing, already-tested properties of
  // saveSharedState/lib/client/staleness.ts, reused here rather than
  // reimplemented.
  exceptions: () => {
    if (!state.seed) return null;
    const rows = computeExceptionRows(state.seed, state.reviewed, state.query);
    return (
      <Exceptions
        rows={rows}
        onReview={(key) => {
          state.reviewed.add(key);
          saveReviewedExceptions(state.reviewed);
          saveSharedState("reviewedException", key, "1", saveFailures, staleness);
          render();
        }}
      />
    );
  },
  // The first async, multi-stage view (select a file -> preview ->
  // publish) and the most destructive action in the app - publishing
  // replaces the dataset (writeImport() deletes every row not in the
  // payload). onFileSelect/onPublish mirror the removed legacy
  // #spreadsheetUpload/#publishImport handlers exactly, including a
  // three-way split on which of notifyViewChanged()/render() each state
  // change needs - the same question step 10 (Needs Review) first
  // answered, just with three answers instead of one this time:
  //  - reading a file (onFileSelect, both its "now reading" status and
  //    its eventual preview-or-error result) touches only
  //    state.importPreview/importStatus - nothing outside this view's
  //    own mount, so notifyViewChanged() alone, matching legacy's
  //    renderImport()-only calls there.
  //  - a REJECTED publish also touches only import-local state
  //    (importBusy/importStatus) - notifyViewChanged() alone again,
  //    matching legacy's renderImport()-only call in that catch branch.
  //  - a SUCCESSFUL publish replaces state.seed itself, which affects
  //    the shell's metrics/topbar the same way step 10's reviewedException
  //    write affected the "Needs review" card - render(), matching
  //    legacy's own render() call in that one branch.
  import: () => {
    if (!state.seed) return null;
    const data = computeImportData(state.seed, state.reviewed, state.importInfo, state.importPreview, state.importStatus, state.importBusy);
    return (
      <Import
        data={data}
        onFileSelect={async (file) => {
          state.importStatus = "Reading spreadsheet...";
          state.importPreview = null;
          notifyViewChanged();
          try {
            const automationRules = defaultAutomationRules(state.seed);
            state.importPreview = await readWorkbookFile(file, new Date(), automationRules);
            state.importStatus = "Preview ready. Review the counts, then publish when it looks right.";
          } catch (error) {
            state.importStatus = error instanceof Error ? error.message : "Could not read that spreadsheet.";
          }
          notifyViewChanged();
        }}
        onPublish={async () => {
          if (!state.importPreview) return;
          state.importBusy = true;
          state.importStatus = "Publishing spreadsheet to the shared CRM...";
          notifyViewChanged();
          try {
            state.importInfo = await saveSharedDataset(state.importPreview.seed, state.importPreview.fileName, staleness);
            state.seed = state.importPreview.seed;
            state.importPreview = null;
            state.importBusy = false;
            state.importStatus = "Imported. This is now the shared CRM data.";
            render();
          } catch (error) {
            state.importBusy = false;
            state.importStatus = error instanceof Error ? error.message : "Could not publish that spreadsheet.";
            notifyViewChanged();
          }
        }}
      />
    );
  },
  // The largest migrated view, and the first that reads state.query
  // without owning the control that sets it - the shell's own
  // #searchInput (initCrmApp()) still calls renderView() on every
  // keystroke, which still ends in notifyViewChanged() unchanged by this
  // migration, so the existing signal already covers a shell-driven
  // search the same way it covers everything else. See
  // app/crm/views/subscribers/Subscribers.tsx's own header.
  //
  // Three actions, two of them writes - and a real, reported finding on
  // which signal each needs: legacy's own [data-profile-mark-envelope]/
  // [data-profile-mark-ashley] handlers (the removed renderSubscribers())
  // called renderSubscribers() only, never render() - even though
  // updateEnvelopeStatus()/updateMailingStatus() mutate
  // state.componentOverrides/statusOverrides, which renderShell()'s
  // status-strip breakdown (effectiveMailings().filter(mailing =>
  // mailing.status === status)) does read. Per step 10/11's own rule
  // ("does this action's effect reach outside the view's own mount?"),
  // this LOOKS like it should call render() - but legacy never did, and
  // "no behavior change" means reproducing what the code actually does,
  // not what the rule would predict. Flagged here rather than silently
  // "fixed" by adding a render() call legacy never had.
  //
  // onPrintEnvelope calls envelopePrintRows()/openEnvelopePrint() (moved
  // to app/crm/views/envelope-print/envelope-html.ts, unchanged, in step
  // 17 - CLAUDE.md) with the exact same argument shape the removed
  // handler used (a one-mailing array), now with seed/reviewed/
  // componentOverrides threaded in explicitly since the relocated
  // generator no longer closes over legacy-app.js's own `state`.
  subscribers: () => {
    if (!state.seed) return null;
    const rows = computeSubscriberRows(state.seed, state.query);
    const selected = selectSubscriber(rows, state.selectedSubscriberId);
    if (selected) state.selectedSubscriberId = selected.subscriberId;
    const profile = selected ? computeSubscriberProfile(state.seed, state.statusOverrides, state.reviewed, state.componentOverrides, selected) : null;
    return (
      <Subscribers
        rows={rows}
        selected={selected}
        onSelect={(subscriberId) => {
          state.selectedSubscriberId = subscriberId;
          notifyViewChanged();
        }}
        profile={profile}
        onPrintEnvelope={(mailing) => {
          const seed = state.seed!;
          openEnvelopePrint(envelopePrintRows([mailing], seed, state.reviewed, state.componentOverrides), seed);
        }}
        onMarkPrinted={(mailing) => {
          updateEnvelopeStatus(mailing, printedEnvelopeStatusForMailing(mailing));
          notifyViewChanged();
        }}
        onMarkAshley={(mailing) => {
          updateEnvelopeStatus(mailing, "In Ashley Box");
          updateMailingStatus(mailing, "Assembling");
          notifyViewChanged();
        }}
      />
    );
  },
  // The busiest operational screen in the app, and the most shell-
  // dependent view yet: state.query/statusFilter/batchFilter are all
  // owned by shell controls outside this view's mount, and all three
  // still drive computeQueueRows() below the same way they already drove
  // renderQueue()'s own filter chain - confirmed directly, not assumed
  // from Subscribers' (step 12) single-shell-control precedent.
  //
  // Both onStatusChange and onBulkStatus call render(), not
  // notifyViewChanged() - unlike Subscribers' mark-printed/mark-ashley
  // (step 12), which reproduced legacy's OWN choice to call
  // renderSubscribers() only, never render(). Here legacy's own
  // [data-status-select]/[data-bulk-status] handlers both call render()
  // directly - a real difference between the two views' legacy code, not
  // an inconsistency introduced by this migration. Confirmed by reading
  // renderQueue() itself, not inferred from the render()-vs-
  // notifyViewChanged() "rule" - that rule describes what legacy already
  // does, per action, and has to be checked against the actual code every
  // time, not applied as a general policy.
  //
  // onBulkStatus is migrated exactly as legacy's own handler: no
  // confirmation, no restyling, no batching, no undo. rows.forEach(...)
  // becomes data.rows.forEach(...) - the exact same currently-shown rows
  // array computeQueueRows() already produced for rendering, not a
  // fresh query. A single click rewrites every shown row, silently, same
  // as before this migration. That's Marcy's call to guard or not - see
  // this step's own task/PR for what's flagged, not fixed.
  queue: () => {
    if (!state.seed) return null;
    const data = computeQueueRows(state.seed, state.statusOverrides, state.reviewed, state.batchFilter, state.statusFilter, state.query, todayIso(new Date()));
    return (
      <Queue
        data={data}
        onStatusChange={(mailing, status) => {
          updateMailingStatus(mailing, status);
          render();
        }}
        onBulkStatus={(status) => {
          data.rows.forEach((mailing) => updateMailingStatus(mailing, status));
          render();
        }}
      />
    );
  },
  // The densest write surface migrated so far: seven independently-
  // editable component-status fields per row, across up to 180 rows, plus
  // two batch actions and a scope toggle. letterFolderUrl is imported from
  // legacy-app.js unchanged (Drive-config lookup - see its own export
  // comment there) and threaded into computeQaData() as an explicit
  // function parameter, same as every other clock/dependency this seam
  // passes in rather than letting a lib-shaped selector reach for a
  // global.
  //
  // onFieldChange calls notifyViewChanged() alone, not render() - reading
  // legacy's own [data-qa-select] handler (renderQa() only, never
  // render()) directly, the same per-action verification step 13's own
  // header comment describes: a component-status write never touches
  // shell metrics or the topbar, only this view's own rows/summary
  // counts. onScopeChange is the same story - legacy's own [data-qa-scope]
  // handler also calls renderQa() only.
  //
  // onScopeChange mutates state.printScope directly - the SAME field
  // Batch Print's still-legacy renderPrint() reads for its own scope
  // toggle (app/crm/legacy-app.js, data-print-scope). Preserved exactly,
  // not a bug: toggling QA's scope here changes what Batch Print shows
  // too, next time that still-legacy view renders - the identical shape
  // of surprise step 7 (Launch Plan) first documented for state.query/
  // packetScope/batchFilter.
  //
  // onMarkReady reproduces legacy's [data-qa-mark-ready] handler exactly:
  // per-row conditional writes against each row's ALREADY-COMPUTED
  // fieldValues (computeQaData()'s own snapshot from this render, not a
  // live re-read) - safe because none of the four conditional fields
  // (envelope/letter/artifact/insert) depend on another field's value
  // changing within the same loop, verified by reading the legacy handler
  // directly, not assumed. notifyViewChanged() only, matching legacy - no
  // component-status write here reaches outside this view's own mount.
  // onMarkMailed calls render() instead, because it writes
  // updateMailingStatus() (not updateComponentStatus()) - the one write in
  // this view that DOES change what the shell's own metrics show,
  // exactly like legacy's own handler, which calls render() and not
  // renderQa(). Both batch actions are migrated exactly as they are - no
  // confirmation, no restyling, no batching, no undo - same rule step 13's
  // bulk buttons were migrated under.
  qa: () => {
    if (!state.seed) return null;
    const data = computeQaData(
      state.seed,
      state.statusOverrides,
      state.reviewed,
      state.componentOverrides,
      state.batchFilter,
      state.printScope,
      state.query,
      todayIso(new Date()),
      letterFolderUrl,
    );
    return (
      <Qa
        data={data}
        printScope={state.printScope}
        onScopeChange={(scope) => {
          state.printScope = scope;
          notifyViewChanged();
        }}
        onFieldChange={(mailing, field, value) => {
          if (field === "envelope") {
            updateEnvelopeStatus(mailing, value);
          } else {
            updateComponentStatus(mailing, field, value);
          }
          notifyViewChanged();
        }}
        onMarkReady={() => {
          data.rows
            .filter((row) => row.fieldValues.payment === "Active")
            .forEach((row) => {
              const mailing = row.mailing;
              if (row.fieldValues.envelope === "Need Print") updateEnvelopeStatus(mailing, qaPrintedEnvelopeStatusForMailing(row));
              if (row.fieldValues.letter === "Need Print") updateComponentStatus(mailing, "letter", "Stuffed");
              if (row.fieldValues.artifact === "Need Check") updateComponentStatus(mailing, "artifact", "Packed");
              if (row.fieldValues.insert === "Need Check") updateComponentStatus(mailing, "insert", "Packed");
              updateComponentStatus(mailing, "qa", "Ready");
            });
          notifyViewChanged();
        }}
        onMarkMailed={() => {
          data.rows.filter((row) => row.isReady).forEach((row) => updateMailingStatus(row.mailing, "Mailed"));
          render();
        }}
      />
    );
  },
  // The largest snapshot in the whole suite, and the first view whose
  // markup ALSO carries a mobile card list under bin-themed names
  // (PacketMobileCard, app/crm/views/packet/Packet.tsx) - see this
  // component's own header for why that's real, pre-existing, and
  // preserved rather than renamed at the DOM-reaching level.
  //
  // A real gap found while migrating (step 15), wired for real here (step
  // 16, second commit) - **a deliberate, separately-reviewed behavior
  // change, not a markup change.** Legacy's own renderPacket() rendered
  // the mobile cards' [data-bin-select] selects but never wired a change
  // listener for them; step 15 left them inert rather than reconstructing
  // a handler with no real precedent to verify against (see Packet.tsx's
  // own header, and that step's PR, for the full story of catching this
  // mid-branch). onFieldChange here is updateBinComponentStatus (above) -
  // Ashley Bins' own real, working [data-bin-select] handler, now shared
  // rather than duplicated. **The snapshot gate does not cover this
  // change** - packet.html stays byte-identical through this commit
  // (value/onChange and defaultValue render identical static markup,
  // verified in step 15), so the proof this write is correct is
  // tests/packet-bins-select-parity.test.mjs and
  // tests/bins-write-path.e2e.test.mjs, not a green snapshot.
  //
  // onScopeChange/onFieldChange call notifyViewChanged() alone, matching
  // legacy's own renderPacket()'s [data-packet-scope] handler and Ashley
  // Bins' own [data-bin-select] handler respectively - neither write
  // touches shell metrics. onPrint/onPrintEnvelopes/onOpenDriveLink are
  // pure browser actions (matching step 9's onOpenSample precedent) -
  // nothing rendered depends on them, so no notifyViewChanged() call at all.
  packet: () => {
    if (!state.seed) return null;
    const seed = state.seed;
    // Bound closure, not the bare relocated function (step 17, CLAUDE.md) -
    // computePacketData() still receives envelopePrintRows as an opaque,
    // threaded-in function (unchanged shape from step 15), so the
    // seed/reviewed/componentOverrides the relocated generator now needs
    // explicitly are captured here rather than changing packet-selectors.ts's
    // own contract.
    const boundEnvelopePrintRows = (rows: EffectiveMailing[]) => envelopePrintRows(rows, seed, state.reviewed, state.componentOverrides);
    const data = computePacketData(
      seed,
      state.statusOverrides,
      state.reviewed,
      state.componentOverrides,
      state.batchFilter,
      state.packetScope,
      state.query,
      todayIso(new Date()),
      letterFolderUrl,
      boundEnvelopePrintRows,
    );
    return (
      <Packet
        data={data}
        packetScope={state.packetScope}
        printReadyFolderUrl={driveConfig.printReadyFolderUrl}
        onScopeChange={(scope) => {
          state.packetScope = scope;
          notifyViewChanged();
        }}
        onFieldChange={updateBinComponentStatus}
        onPrint={() => window.print()}
        onPrintEnvelopes={() => openEnvelopePrint(boundEnvelopePrintRows(data.rows), seed)}
        onOpenDriveLink={(url) => openDriveLink(url)}
      />
    );
  },
  // Desktop-only, deliberately - no mobile card list here despite the
  // view's own name (that markup lives in Batch Packet - step 15's own
  // PR, and bins-selectors.ts's header, have the full story). onFieldChange
  // is updateBinComponentStatus (above) - the REFERENCE implementation
  // this migration's whole [data-bin-select] mechanism is built on, not a
  // Bins-specific callback.
  //
  // onBulkMark reproduces legacy's own [data-bin-mark] handler exactly:
  // three updateComponentStatus calls per shown row (envelope/letter/
  // location), no confirmation/restyling/batching/undo - same rule
  // steps 13-15's bulk buttons were migrated under, and the second of the
  // two sets Marcy owns the decision on. notifyViewChanged() only,
  // matching legacy's own renderBins() call, not render() - a component-
  // status write never touches shell metrics. onPrint is a pure browser
  // action (matching step 9's onOpenSample precedent) - no
  // notifyViewChanged() call at all.
  bins: () => {
    if (!state.seed) return null;
    const data = computeBinsData(state.seed, state.statusOverrides, state.reviewed, state.componentOverrides, state.batchFilter, state.query, todayIso(new Date()));
    return (
      <Bins
        data={data}
        onFieldChange={updateBinComponentStatus}
        onBulkMark={(mode) => {
          data.rows.forEach((row) => {
            const mailing = row.mailing;
            if (mode === "ready") {
              updateComponentStatus(mailing, "envelope", "In Ashley Box");
              updateComponentStatus(mailing, "letter", "Stuffed");
              updateComponentStatus(mailing, "location", "Ashley");
            } else {
              updateComponentStatus(mailing, "envelope", "Need Print");
              updateComponentStatus(mailing, "letter", "Need Print");
              updateComponentStatus(mailing, "location", "Marcy");
            }
          });
          notifyViewChanged();
        }}
        onPrint={() => window.print()}
      />
    );
  },
  // The last of twelve views (step 17, CLAUDE.md). The generator this
  // view calls - envelopeHtml() et al., relocated unchanged to
  // ./views/envelope-print/envelope-html.ts - does NOT become React; see
  // that module's own header. envelopePrintRows()/openEnvelopePrint() now
  // need seed/reviewed/componentOverrides threaded in explicitly (the one
  // real signature change the relocation forced, not a behavior change -
  // same transformation every other selector promoted out of
  // legacy-app.js in this migration already went through).
  //
  // A real, deliberately-preserved quirk: legacy's own renderPrint()
  // mutates state.printStockFilter back to "all" AS A SIDE EFFECT of
  // rendering, if the currently-selected stock no longer matches any
  // computed envelope group. computePrintData() can't do that (a pure
  // function, like every selector in this migration) - it returns
  // effectivePrintStockFilter instead, and this entry writes it back to
  // state when it differs, replicating the exact same self-correction
  // without hiding a mutation inside a selector. See
  // print-selectors.ts's own header for the full reasoning.
  //
  // Every write here calls notifyViewChanged() alone, matching legacy's
  // own [data-print-status]/[data-print-envelope-status]/[data-print-scope]/
  // [data-print-stock]/[data-mark-envelopes-printed] handlers exactly -
  // none of them called render() in the original either, even though a
  // mailing-status write would predict it (same "describe what legacy
  // actually does" finding step 12/step 13 already made for other
  // views). onBrowserPrint/onPrintEnvelopes/onPrintOneEnvelope/
  // onOpenDriveLink/onPrintAction are pure browser actions - no
  // notifyViewChanged() call at all, matching step 9's onOpenSample
  // precedent. onMarkEnvelopesPrinted reuses qaPrintedEnvelopeStatusForMailing
  // (step 14's own copy) rather than adding a fifth duplicate of the same
  // one-line ternary - PrintRowData already carries envelopeQuantity, the
  // one field that function's signature needs.
  print: () => {
    if (!state.seed) return null;
    const seed = state.seed;
    const data = computePrintData(
      seed,
      state.statusOverrides,
      state.reviewed,
      state.componentOverrides,
      state.batchFilter,
      state.printScope,
      state.printStockFilter,
      state.query,
      todayIso(new Date()),
      driveConfig,
    );
    if (data.effectivePrintStockFilter !== state.printStockFilter) {
      state.printStockFilter = data.effectivePrintStockFilter;
    }
    return (
      <Print
        data={data}
        printScope={state.printScope}
        printStockFilter={data.effectivePrintStockFilter}
        printReadyFolderUrl={driveConfig.printReadyFolderUrl}
        onScopeChange={(scope) => {
          state.printScope = scope;
          state.printStockFilter = "all";
          notifyViewChanged();
        }}
        onStockChange={(stock) => {
          state.printStockFilter = stock;
          notifyViewChanged();
        }}
        onFieldChange={(mailing, field, value) => {
          if (field === "status") {
            updateMailingStatus(mailing, value);
          } else {
            updateEnvelopeStatus(mailing, value);
          }
          notifyViewChanged();
        }}
        onBrowserPrint={() => window.print()}
        onPrintEnvelopes={() => {
          openEnvelopePrint(
            envelopePrintRows(
              data.rows.map((row) => row.mailing),
              seed,
              state.reviewed,
              state.componentOverrides,
            ),
            seed,
          );
        }}
        onPrintOneEnvelope={(mailing) => {
          openEnvelopePrint(envelopePrintRows([mailing], seed, state.reviewed, state.componentOverrides), seed);
        }}
        onMarkEnvelopesPrinted={() => {
          data.rows.forEach((row) => updateEnvelopeStatus(row.mailing, qaPrintedEnvelopeStatusForMailing(row)));
          notifyViewChanged();
        }}
        onOpenDriveLink={(url) => openDriveLink(url)}
        onPrintAction={() => alert("Next Drive step: attach the matching envelope or letter file URL for this batch.")}
      />
    );
  },
};

// Runs initCrmApp() inside a browser-only effect specifically so nothing
// in legacy-app.js executes during SSR, where document/window/localStorage
// don't exist (a "use client" component's render still runs once on the
// server to produce the initial HTML - only its effects are browser-only).
// initCrmApp() itself guards against being called twice, which covers
// React StrictMode double-invoking effects in development.
function getViewSnapshot(): string {
  return `${state.activeView}:${getRenderGeneration()}`;
}

export default function CrmApp() {
  useEffect(() => {
    initCrmApp();
  }, []);

  const viewSnapshot = useSyncExternalStore(subscribeViewChanged, getViewSnapshot, getViewSnapshot);
  const activeView = viewSnapshot.slice(0, viewSnapshot.lastIndexOf(":"));

  if (typeof document === "undefined") return null;
  const mount = document.getElementById("reactViewMount");
  if (!mount) return null;

  const entry = (VIEW_REGISTRY as Record<string, { react?: boolean }>)[activeView];
  const renderReactView = REACT_VIEWS[activeView];
  if (!entry?.react || !renderReactView) return null;

  return createPortal(renderReactView(), mount);
}
