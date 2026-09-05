/**
 * The shell chrome painted around whichever view is active: the topbar's
 * imported-date/mailing-count line, the four metric cards, the per-status
 * meter strip, the batch/past-batch filter dropdowns, and (renderView) the
 * side-nav active-button tracking plus the status/batch filter wrappers'
 * visibility. Moved from app/crm/legacy-app.js (Phase 2, the monolith's
 * deletion - CLAUDE.md) - this is everything render() used to do besides
 * dispatching to a per-view render function, which no longer exists now
 * that every view is react-hosted (app/crm/CrmApp.tsx's own REACT_VIEWS
 * dispatch, unaffected by this move).
 *
 * DOM element refs are bound once via bindShellElements() (called from
 * app/crm/shell/init-crm-app.ts's initCrmApp(), same as
 * app/crm/legacy-app.js used to assign its own module-scoped `let`
 * bindings there) rather than threaded as a parameter to every render call -
 * there is exactly one real #topbarMeta/#metrics/etc. on the page for its
 * whole lifetime, a genuinely singleton concern unlike `state` (business
 * data, which legitimately needs a fresh instance per test - see
 * app/crm/shell/crm-app-state.ts's own header). Tests that need to exercise
 * this module bind their own stub elements first.
 *
 * `state`/`notifyViewChanged` are explicit parameters instead, the same
 * "thread state in, don't close over a module singleton" pattern every
 * selector promoted out of legacy-app.js during Phase 1 already followed -
 * what lets a test call renderShell()/renderView() against a fresh,
 * isolated createAppState() instance instead of the one real app singleton.
 *
 * renderView() lost its `entry?.render`/`else { viewMount.innerHTML = '' }`
 * branch in this same move: no VIEW_REGISTRY entry has ever carried a
 * `render` function since step 17 (Envelope Print) merged - every view is
 * react-hosted, and #viewMount (which existed solely so a legacy view had
 * somewhere to write) is removed from app/page.tsx entirely as part of this
 * same branch. VIEW_REGISTRY itself lost its own `react` field for the
 * identical reason - see app/crm/shell/view-registry.ts's header.
 */

import { isOpenStatus, MAILING_STATUSES, todayIso } from "@/lib/domain/mailing-rules";
import { formatDate } from "@/lib/domain/format";
import { escapeHtml, number } from "../format";
import { activeExceptions, availableBatchDates, effectiveMailings, nextBatchDate, pastBatchDates } from "@/lib/client/selectors";
import { upcomingBatchDates } from "@/lib/domain/batch-dates";
import type { CrmState } from "@/lib/client/crm-state";
import { VIEW_REGISTRY } from "./view-registry";

export interface ShellElements {
  topbarMeta: HTMLElement;
  metrics: HTMLElement;
  statusStrip: HTMLElement;
  statusFilterWrap: HTMLElement;
  batchFilter: HTMLSelectElement;
  batchFilterWrap: HTMLElement;
  pastBatchFilter: HTMLSelectElement;
  pastBatchFilterWrap: HTMLElement;
}

let elements: ShellElements | null = null;

export function bindShellElements(next: ShellElements): void {
  elements = next;
}

function requireElements(): ShellElements {
  if (!elements) throw new Error("render-shell: bindShellElements() must be called before rendering");
  return elements;
}

function metric(characterImage: string, characterName: string, label: string, value: number | string | null | undefined, tone: string): string {
  return `
    <div class="metric metric-${tone}">
      <div class="metric-icon"><img src="${escapeHtml(characterImage)}" alt="${escapeHtml(characterName)}" /></div>
      <span>${escapeHtml(label)}</span>
      <strong>${number(value)}</strong>
    </div>
  `;
}

export function renderBatchFilter(state: CrmState): void {
  const { statusFilterWrap, batchFilter, pastBatchFilter } = requireElements();
  const today = todayIso(new Date());
  const mailings = effectiveMailings(state.seed!, state.statusOverrides);
  const dates = Array.from(new Set([...upcomingBatchDates(today), ...availableBatchDates(mailings, today)])).sort();
  const nextDate = nextBatchDate(mailings, today);
  const pastDates = pastBatchDates(mailings, today);
  const selectedPastDate = pastDates.includes(state.batchFilter) ? state.batchFilter : "";
  const options = [
    `<option value="next" ${state.batchFilter === "next" ? "selected" : ""}>Next batch: ${formatDate(nextDate)}</option>`,
    `<option value="all" ${state.batchFilter === "all" ? "selected" : ""}>All open batches</option>`,
    selectedPastDate ? `<option value="${escapeHtml(selectedPastDate)}" selected>Past batch: ${formatDate(selectedPastDate)}</option>` : "",
    ...dates.map((date) => `<option value="${escapeHtml(date)}" ${state.batchFilter === date ? "selected" : ""}>${formatDate(date)}</option>`),
  ];
  batchFilter.innerHTML = options.join("");
  pastBatchFilter.innerHTML = [
    '<option value="">Past batches...</option>',
    ...pastDates.map((date) => `<option value="${escapeHtml(date)}" ${selectedPastDate === date ? "selected" : ""}>${formatDate(date)}</option>`),
  ].join("");
  const selectedStatuses = state.statusFilter === "All"
    ? new Set(MAILING_STATUSES)
    : state.statusFilter === "Open"
      ? new Set(MAILING_STATUSES.filter((status) => status !== "Mailed"))
      : new Set(state.statusFilter.split("|"));
  statusFilterWrap.querySelectorAll<HTMLInputElement>("[data-status-filter]").forEach((input) => {
    input.checked = selectedStatuses.has(input.dataset.statusFilter || "");
  });
}

export function renderShell(state: CrmState): void {
  const { topbarMeta, metrics, statusStrip } = requireElements();
  const seed = state.seed!;
  const openExceptionCount = activeExceptions(seed, state.reviewed).length + (state.squarespaceOrderReviews?.reviews.length ?? 0) + (state.batchPhotoReviews?.reviews.length ?? 0);
  const activeMailings = effectiveMailings(seed, state.statusOverrides).filter((mailing) => mailing.activeState === "Active");
  const openMailingCount = activeMailings.filter((mailing) => isOpenStatus(mailing.status)).length;
  topbarMeta.innerHTML = `
    <span>Imported ${formatDate(seed.summary.asOf)}</span>
    <span>${number(seed.summary.mailingCount)} mailings</span>
  `;

  metrics.innerHTML = [
    metric("/assets/marley-corner.png", "Marley", "Active subscribers", seed.summary.activeSubscriberCount ?? seed.summary.subscriberCount, "blue"),
    metric("/assets/harper-corner.png", "Harper", "Open mailings", openMailingCount, "green"),
    metric("/assets/oliver-corner.png", "Oliver", "Due next 14 days", seed.summary.dueNext14Count, "amber"),
    metric("/assets/ringo-corner.png", "Ringo", "Needs review", openExceptionCount, "rose"),
  ].join("");

  statusStrip.innerHTML = MAILING_STATUSES.map((status) => {
    const count = effectiveMailings(seed, state.statusOverrides).filter((mailing) => mailing.status === status).length;
    const width = Math.max(8, (count / seed.summary.mailingCount) * 100);
    return `
      <div class="status-meter">
        <div><span>${escapeHtml(status)}</span><strong>${number(count)}</strong></div>
        <div class="meter-track"><span style="width:${width}%"></span></div>
      </div>
    `;
  }).join("");
  renderBatchFilter(state);
}

export function renderView(state: CrmState, notifyViewChanged: () => void): void {
  document.querySelectorAll(".side-nav button").forEach((button) => {
    button.classList.toggle("active", button.getAttribute("data-view") === state.activeView);
  });
  const { statusFilterWrap, batchFilterWrap, pastBatchFilterWrap } = requireElements();
  const entry = VIEW_REGISTRY[state.activeView];
  statusFilterWrap.style.display = entry?.showStatusFilter ? "flex" : "none";
  batchFilterWrap.style.display = entry?.showBatchFilter ? "flex" : "none";
  pastBatchFilterWrap.style.display = batchFilterWrap.style.display;
  // Tells app/crm/CrmApp.tsx a view switch may have happened, so it can
  // re-render via React's own reconciliation - see
  // lib/client/crm-state.ts's own comment on notifyViewChanged() for why
  // this lives here rather than at every individual state.activeView
  // assignment site.
  notifyViewChanged();
}

export function render(state: CrmState, notifyViewChanged: () => void): void {
  renderShell(state);
  renderView(state, notifyViewChanged);
}
