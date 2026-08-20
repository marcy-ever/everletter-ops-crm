import Script from "next/script";
import { auth } from "@/auth";
import { getBuildInfo } from "@/lib/build-info";
import CrmApp from "./crm/CrmApp";
import Sidebar from "./crm/shell/Sidebar";

export const metadata = {
  title: "Everletter Ops CRM",
  description: "Shared mailing operations CRM for Everletter.",
};

export default async function Home() {
  const session = await auth();
  const buildInfo = getBuildInfo();

  return (
    <>
      <div className="character-decor" aria-hidden="true">
        <img className="character-peek character-peek-marley" src="/assets/marley-corner.png" alt="" />
        <img className="character-peek character-peek-ringo" src="/assets/ringo-corner.png" alt="" />
        <img className="character-peek character-peek-oliver" src="/assets/oliver-corner.png" alt="" />
        <img className="character-peek character-peek-harper" src="/assets/harper-corner.png" alt="" />
        <img className="character-peek character-peek-adult-girls" src="/assets/adult-girls.png" alt="" />
        <img className="character-peek character-peek-seraphine" src="/assets/seraphine-adult.png" alt="" />
        <img className="character-peek character-peek-marigold" src="/assets/marigold-adult-clothesline.png" alt="" />
      </div>

      {/*
        data-user-role/data-user-email: not read anywhere yet. Future
        per-feature restrictions (still pending Marcy specifying what Ashley
        should be restricted from) can read these off the DOM from
        app/crm/shell/init-crm-app.ts without another server round trip.
      */}
      <div className="ops-shell" data-user-role={session?.role ?? ""} data-user-email={session?.user?.email ?? ""}>
        <aside className="sidebar">
          <div>
            <div className="brand-lockup">
              <img src="/assets/everletter-logo-gold.png" alt="Everletter" />
              <span>Ops CRM</span>
            </div>
            <p className="sidebar-copy">Letters, bins, envelopes, and the tiny details that keep mailing day calm.</p>
            <div className="sidebar-seal" aria-hidden="true">
              <img src="/assets/everletter-wax-seal.png" alt="" />
            </div>
          </div>

          <Sidebar />

          <div className="sidebar-note">
            <img src="/assets/everletter-wax-seal.png" alt="" aria-hidden="true" />
            <span>Order IDs can change. Subscriber IDs stay stable.</span>
          </div>

          {/*
            Build identity (lib/build-info.ts) - "load the page and know
            which build this is" (see CLAUDE.md's deploy section).
            NEXT_PUBLIC_BUILD_TIME/NEXT_PUBLIC_BUILD_SHA are inlined
            by Next at build time (devops/app.Dockerfile), so this is a
            build-time string literal by the time it renders - no runtime
            cost, no client component needed.
          */}
          <p className="build-stamp">{buildInfo.label}</p>
        </aside>

        <main className="workspace">
          <header className="topbar">
            <div>
              <p className="section-label">Shared launch mode</p>
              <h2>Mailing operations command center</h2>
            </div>
            <div className="topbar-meta" id="topbarMeta"></div>
          </header>

          {/*
            Independent of which view is active - a save failure during a
            bulk action in Production Queue must still be visible after
            switching tabs. Rendered by app/crm/shell/init-crm-app.ts via
            app/crm/shell/banners.ts's formatSaveFailureBannerHtml(),
            subscribed to lib/client/save-failures.ts's store. Empty (and
            so invisible) whenever nothing has failed.
          */}
          <div id="saveFailureBanner" role="status" aria-live="polite"></div>

          {/*
            Same placement reasoning as #saveFailureBanner above, and a
            deliberately separate element - "your change didn't save" and
            "someone else changed something" are different problems and
            shouldn't share a banner (see CLAUDE.md §8's staleness item).
            Rendered by app/crm/shell/init-crm-app.ts via
            app/crm/shell/banners.ts's formatStalenessBannerHtml(),
            subscribed to lib/client/staleness.ts's store, fed by a
            background poll against GET /api/change-marker. Empty (and so
            invisible) unless the server's change marker has moved past
            what this client's own view reflects.
          */}
          <div id="stalenessBanner" role="status" aria-live="polite"></div>

          <section className="metric-grid" id="metrics" aria-label="CRM summary"></section>
          <section className="status-strip" id="statusStrip" aria-label="Mailing status counts"></section>

          <section className="tool-row" aria-label="Search and filters">
            <label className="search-box">
              <span>Search</span>
              <input id="searchInput" placeholder="Search name, email, character, order, issue..." />
            </label>
            <label className="filter-box" id="statusFilterWrap">
              <span>Status</span>
              <select id="statusFilter">
                <option>Open</option>
                <option>To Prepare</option>
                <option>Printing</option>
                <option>Assembling</option>
                <option>Ready to Mail</option>
                <option>Mailed</option>
                <option>All</option>
              </select>
            </label>
            <label className="filter-box" id="batchFilterWrap">
              <span>Batch</span>
              <select id="batchFilter"></select>
            </label>
            <label className="filter-box past-filter" id="pastBatchFilterWrap">
              <span>Past</span>
              <select id="pastBatchFilter"></select>
            </label>
          </section>

          {/*
            React's mount for the active view (app/crm/CrmApp.tsx portals
            into this element via createPortal). There used to be a second
            mount, #viewMount, that legacy render functions wrote into via
            raw innerHTML - removed once the app.js decomposition's Phase 2
            (CLAUDE.md) deleted that monolith and nothing wrote there
            anymore. Kept as its own element (rather than, say, rendering
            CrmApp directly in place) mainly as a stable anchor point in
            this markup - see app/crm/CrmApp.tsx's own header for why the
            two-mount split existed in the first place.
          */}
          <section id="reactViewMount"></section>
        </main>
      </div>

      <Script src="/seed-data.js" strategy="beforeInteractive" />
      <Script src="/xlsx.full.min.js" strategy="beforeInteractive" />
      <CrmApp />
    </>
  );
}
