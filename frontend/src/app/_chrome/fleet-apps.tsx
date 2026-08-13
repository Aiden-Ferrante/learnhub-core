import Link from "next/link"

/* Tier one of the fleet header: which of the four apps you are in.
 *
 * The same row renders in shipyard, Mission Control and vault-dashboard, so
 * moving between them does not move the furniture. Tier two — this app's own
 * Learn / Study / Process / Upload — stays in `app-nav.tsx`. The split is the
 * point: switching app and switching page are different acts.
 *
 * The list is duplicated from code/fleet-ui/apps.js rather than imported. The
 * other three are Vite apps and import it directly; this one is Next, builds in
 * Docker, and an import reaching outside the build context would break the
 * image rather than the page — a failure that would show up at deploy, not here.
 * Keep the two in step; PLATFORM.md Wave 3 serves the registry from the platform
 * and retires both copies.
 *
 * Ports, not URLs: resolved against the browser's current hostname, because
 * these apps bind 0.0.0.0 and get read over the tailnet, where a literal
 * localhost points at whichever machine is reading the page.
 */

const FLEET_APPS = [
  { id: "shipyard", label: "Shipyard", port: 8845, blurb: "projects, goals, what the fleet owes" },
  { id: "mission-control", label: "Control", port: 9090, blurb: "what is running" },
  { id: "vault-dashboard", label: "Vault", port: 8989, blurb: "daily notes, habits, health" },
  { id: "learnhub", label: "Learn", port: 3001, blurb: "courses, study queue, uploads" },
  { id: "feedwall", label: "Feed", port: 8975, blurb: "what the frontier said this week" },
] as const

const ME = "learnhub"

export function FleetApps() {
  return (
    <nav aria-label="Fleet" className="flex items-center gap-1 overflow-x-auto">
      <p className="mr-3 whitespace-nowrap text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
        fleet
      </p>
      {FLEET_APPS.map((a) =>
        a.id === ME ? (
          // The current app is stated, not linked — you are already here.
          <span
            key={a.id}
            aria-current="page"
            className="rounded-t-md border-b-2 border-primary px-2.5 py-1.5 text-[12.5px]
              font-medium text-foreground"
          >
            {a.label}
          </span>
        ) : (
          <Link
            key={a.id}
            href={`http://${typeof window !== "undefined" ? window.location.hostname : "localhost"}:${a.port}`}
            title={a.blurb}
            prefetch={false}
            className="rounded-t-md border-b-2 border-transparent px-2.5 py-1.5 text-[12.5px]
              text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            {a.label}
          </Link>
        ),
      )}
    </nav>
  )
}
