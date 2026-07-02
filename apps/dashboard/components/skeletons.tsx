import { Skel } from "@/components/ui";

/* Page-level loading skeletons. Each mirrors the loaded layout closely enough
   that content pops in without a reflow, so the wait reads as "already
   rendering" instead of "blank page with a sentence". All are aria-hidden
   inside a single role="status" wrapper for screen readers. */

function Status({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div role="status" aria-label={label} aria-busy>
      {children}
    </div>
  );
}

function CardSkeleton() {
  return (
    <div className="mkt-card" aria-hidden>
      <div className="mkt-card-head">
        <Skel w={38} h={38} r={10} />
        <Skel w={58} h={24} r={999} />
      </div>
      <Skel w="55%" h={16} />
      <Skel w="90%" h={13} />
      <Skel w="70%" h={13} style={{ marginTop: -4 }} />
      <div className="mkt-statrow">
        <Skel w={72} h={30} />
        <Skel w={104} h={30} />
      </div>
      <Skel h={38} r={9} />
      <Skel h={40} r={9} />
    </div>
  );
}

export function MarketplaceSkeleton() {
  return (
    <Status label="Loading the marketplace">
      <div className="mkt-grid">
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
      </div>
    </Status>
  );
}

export function EndpointDetailSkeleton() {
  return (
    <Status label="Loading endpoint details">
      <div className="card" aria-hidden>
        <div className="mkt-detail-head">
          <Skel w={76} h={13} />
          <Skel w={64} h={26} r={999} />
        </div>
        <Skel w="60%" h={22} style={{ margin: "10px 0 22px" }} />
        <div className="kv" style={{ marginBottom: 22 }}>
          {[0, 1, 2].map((i) => (
            <div className="kv-row" key={i}>
              <Skel w={72} h={13} />
              <Skel w={130} h={13} />
            </div>
          ))}
        </div>
        <Skel w={86} h={13} style={{ marginBottom: 10 }} />
        <Skel h={44} r={9} />
        <Skel w={180} h={13} style={{ margin: "24px 0 10px" }} />
        <Skel h={190} r={9} />
      </div>
    </Status>
  );
}

function TileSkeleton() {
  return (
    <div className="eco-tile" aria-hidden>
      <Skel w={64} h={27} />
      <Skel w={82} h={12} style={{ marginTop: 8 }} />
      <Skel w={100} h={10} style={{ marginTop: 11 }} />
    </div>
  );
}

function FeedRowSkeleton() {
  return (
    <li className="eco-feed-row" aria-hidden>
      <Skel w={28} h={28} r={8} />
      <div className="eco-feed-main">
        <Skel w="70%" h={13} />
        <Skel w={52} h={10} style={{ marginTop: 6 }} />
      </div>
      <Skel w={62} h={14} />
    </li>
  );
}

export function LiveSkeleton() {
  return (
    <Status label="Loading the machine economy">
      <div aria-hidden>
        <div className="eco-stats-head">
          <Skel w={230} h={20} />
          <Skel w={56} h={13} />
        </div>
        <div className="eco-tiles">
          {[0, 1, 2, 3, 4].map((i) => (
            <TileSkeleton key={i} />
          ))}
        </div>
        <div className="eco-cols">
          <div className="eco-panel">
            <div className="eco-panel-head">
              <Skel w={104} h={16} />
              <Skel w={72} h={13} />
            </div>
            <ul className="eco-feed">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <FeedRowSkeleton key={i} />
              ))}
            </ul>
          </div>
          <div className="eco-panel">
            <div className="eco-panel-head">
              <Skel w={110} h={16} />
            </div>
            {[0, 1, 2].map((b) => (
              <div className="eco-board" key={b}>
                <Skel w={112} h={12} style={{ marginBottom: 12 }} />
                {[0, 1, 2].map((i) => (
                  <Skel key={i} h={13} style={{ margin: "11px 0" }} />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </Status>
  );
}

export function ConsoleSkeleton() {
  return (
    <Status label="Loading agent runs">
      <div className="con-cols" aria-hidden>
        <aside className="con-side">
          <div className="con-runlist">
            <div className="con-runlist-head">Recent runs</div>
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {[0, 1, 2, 3].map((i) => (
                <li key={i} style={{ padding: "8px 8px" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 8, alignItems: "center" }}>
                    <Skel w={8} h={8} r={999} />
                    <Skel h={12} />
                    <Skel w={30} h={10} />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </aside>
        <section className="con-main">
          <div className="con-runhead">
            <div className="con-runhead-top">
              <Skel w={92} h={25} r={999} />
              <Skel w={54} h={12} />
            </div>
            <Skel w={34} h={11} />
            <Skel w="82%" h={15} style={{ margin: "9px 0 16px" }} />
            <Skel w={220} h={12} />
          </div>
          <div className="con-timeline">
            <div className="con-narr">
              <Skel w={72} h={10} style={{ marginBottom: 8 }} />
              <Skel w="92%" h={13} />
              <Skel w="60%" h={13} style={{ marginTop: 6 }} />
            </div>
            <div className="con-call">
              <div className="con-call-head">
                <Skel w={110} h={14} />
                <Skel w={46} h={20} r={999} />
              </div>
              <Skel w="66%" h={13} style={{ margin: "6px 0" }} />
              <Skel w="48%" h={13} style={{ margin: "10px 0 4px" }} />
            </div>
          </div>
        </section>
      </div>
    </Status>
  );
}

export function AgentPanelSkeleton() {
  return (
    <Status label="Loading your agent">
      <div className="card" aria-hidden>
        <div className="fleet-head">
          <div className="fleet-id">
            <Skel w={44} h={44} r={12} />
            <div>
              <Skel w={72} h={11} />
              <Skel w={150} h={20} style={{ marginTop: 8 }} />
            </div>
          </div>
          <Skel w={64} h={38} r={9} />
        </div>
        <Skel h={44} r={9} style={{ marginTop: 20 }} />
        <div className="fleet-stats">
          {[0, 1, 2].map((i) => (
            <div className="fleet-stat" key={i}>
              <Skel w={54} h={23} />
              <Skel w={70} h={12} style={{ marginTop: 8 }} />
            </div>
          ))}
        </div>
      </div>
    </Status>
  );
}
