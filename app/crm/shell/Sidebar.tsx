import { NAV_ITEMS } from "./nav-items";

// Renders the twelve nav buttons from NAV_ITEMS (see that module's header
// for why this replaced seven hand-written JSX buttons plus five injected
// at runtime by app/crm/legacy-app.js). Markup, classes, and attributes are
// reproduced exactly from the pre-change output - app/crm/legacy-app.js
// binds delegated listeners via `.side-nav button` and toggles `active` by
// `data-view`, so any structural drift here would silently break
// navigation.
//
// "queue" keeps the `active` class for the server-rendered initial state,
// same as before this change - renderView() (app/crm/legacy-app.js)
// corrects it to the real active view once the client mounts.
export default function Sidebar() {
  return (
    <nav className="side-nav" aria-label="Views">
      {NAV_ITEMS.map((item) => (
        <button key={item.id} className={item.id === "queue" ? "active" : undefined} data-view={item.id} type="button">
          <span>{item.badge}</span> {item.label}
        </button>
      ))}
    </nav>
  );
}
