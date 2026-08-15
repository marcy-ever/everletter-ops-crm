/**
 * localStorage caches for the three client-side override sets: mailing
 * status, component status, and reviewed exceptions. These are the
 * client-side fallback/cache layer described in CLAUDE.md's data-flow
 * section - the shared Postgres-backed state (lib/client/shared-state-client.ts)
 * is the real source of truth; these keys just make the CRM usable if that
 * endpoint is briefly unavailable, and survive a refresh before the next
 * successful GET arrives.
 *
 * Pure value-in/value-out functions - no `state` coupling, so any caller
 * (currently only lib/client/crm-state.ts and lib/client/shared-state-client.ts)
 * decides what to persist and when. Extracted from app/crm/legacy-app.js
 * (step 4 of the app.js decomposition - see CLAUDE.md); the three key names
 * and every load*'s parse-error-swallowing behavior are preserved exactly -
 * renaming a key would silently discard a real user's local state.
 */

const STATUS_OVERRIDES_KEY = "everletterStatusOverrides";
const COMPONENT_OVERRIDES_KEY = "everletterComponentOverrides";
const REVIEWED_EXCEPTIONS_KEY = "everletterReviewedExceptions";

export type StatusOverrides = Record<string, string>;
export type ComponentOverrides = Record<string, string>;

export function loadStatusOverrides(): StatusOverrides {
  try {
    return JSON.parse(localStorage.getItem(STATUS_OVERRIDES_KEY) || "{}");
  } catch {
    return {};
  }
}

export function saveStatusOverrides(overrides: StatusOverrides): void {
  localStorage.setItem(STATUS_OVERRIDES_KEY, JSON.stringify(overrides));
}

export function loadComponentOverrides(): ComponentOverrides {
  try {
    return JSON.parse(localStorage.getItem(COMPONENT_OVERRIDES_KEY) || "{}");
  } catch {
    return {};
  }
}

export function saveComponentOverrides(overrides: ComponentOverrides): void {
  localStorage.setItem(COMPONENT_OVERRIDES_KEY, JSON.stringify(overrides));
}

export function loadReviewedExceptions(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(REVIEWED_EXCEPTIONS_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

export function saveReviewedExceptions(reviewed: Set<string>): void {
  localStorage.setItem(REVIEWED_EXCEPTIONS_KEY, JSON.stringify(Array.from(reviewed)));
}
