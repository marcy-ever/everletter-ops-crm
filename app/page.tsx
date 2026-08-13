import Script from "next/script";
import { auth } from "@/auth";

export const metadata = {
  title: "Everletter Ops CRM",
  description: "Shared mailing operations CRM for Everletter.",
};

export default async function Home() {
  const session = await auth();

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
        should be restricted from) can read these off the DOM from app.js
        without another server round trip.
      */}
      <div className="ops-shell" data-user-role={session?.role ?? ""} data-user-email={session?.user?.email ?? ""}>
        <aside className="sidebar">
          <div>
            <div className="brand-lockup">
              <img src="/assets/everletter-logo-gold.png" alt="Everletter" />
              <span>Ops CRM</span>
            </div>
            <p className="sidebar-copy">Letters, bins, envelopes, and the tiny details that keep mailing day calm.</p>
            <div className="sidebar-characters" aria-hidden="true">
              <img src="/assets/ringo-fullbody-map.png" alt="" />
              <img src="/assets/marley-fullbody-butterfly.png" alt="" />
              <img src="/assets/oliver-character-card.png" alt="" />
              <img src="/assets/harper-fullbody-treat.png" alt="" />
            </div>
            <div className="sidebar-adult-cameo" aria-hidden="true">
              <img src="/assets/penelope-adult.png" alt="" />
            </div>
          </div>

          <nav className="side-nav" aria-label="Views">
            <button className="active" data-view="queue" type="button"><span>Q</span> Production Queue</button>
            <button data-view="exceptions" type="button"><span>!</span> Needs Review</button>
            <button data-view="subscribers" type="button"><span>S</span> Subscribers</button>
            <button data-view="import" type="button"><span>U</span> Import Sheet</button>
            <button data-view="print" type="button"><span>P</span> Batch Print</button>
            <button data-view="sync" type="button"><span>Y</span> Sync Simulator</button>
            <button data-view="automation" type="button"><span>A</span> Automation Map</button>
          </nav>

          <div className="sidebar-note">
            <img src="/assets/everletter-wax-seal.png" alt="" aria-hidden="true" />
            <span>Order IDs can change. Subscriber IDs stay stable.</span>
          </div>
        </aside>

        <main className="workspace">
          <header className="topbar">
            <div>
              <p className="section-label">Shared launch mode</p>
              <h2>Mailing operations command center</h2>
            </div>
            <div className="topbar-meta" id="topbarMeta"></div>
          </header>

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

          <section id="viewMount"></section>
        </main>
      </div>

      <Script src="/seed-data.js" strategy="beforeInteractive" />
      <Script src="/xlsx.full.min.js" strategy="beforeInteractive" />
      <Script src="/app.js" strategy="afterInteractive" />
    </>
  );
}
