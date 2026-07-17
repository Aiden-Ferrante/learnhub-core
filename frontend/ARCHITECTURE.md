# Frontend architecture

Surface-partitioned Next.js 15 (App Router) app, organized by the **physical experience**:
each screen you can stand on is a package. The layered sentence (mirroring the backend's
`gateways ← process ← supplemental ← conductor ← api`):

**`kit` ← `gateways` ← `surfaces` ← `app`**

```
frontend/                   # root = framework configs only (next/tailwind/ts/shadcn/pnpm),
│                           # plus scripts/ (repo tooling). No public/ — the app currently
│                           # ships zero static assets; recreate it (and restore the
│                           # Dockerfile's `COPY /app/public` line) if a real one arrives.
└── src/                    # ALL custom code lives here
    ├── app/                # Next.js routes ONLY — thin entry points that mount surface hubs
    │   ├── courses/…       #   shelf → course home → chapter/read/concepts/drill/dump
    │   ├── study/ process/ upload/ reader/ login/ styleguide/
    │   ├── _chrome/        #   nav shell: top nav, breadcrumbs, user menu, shortcuts
    │   └── api/…           #   ~40 thin proxy handlers → learn backend (the client never
    │                       #   sees the backend's address)
    ├── surfaces/           # THE product — five screens, one package each, hub-gated
    │   ├── library/        #   course shelf + course home + syllabus tree + course data hooks
    │   ├── reading/        #   book/chapter readers, guided-reading/, audiobook, prefs/theme
    │   ├── concepts/       #   concepts screen + shared concept primitives (markdown, kind
    │   │                   #   palette, mastery dot, section panel)
    │   ├── studying/       #   quiz/drill/exam/dump/review/lock-in panels, planner, hotkeys
    │   └── processing/     #   upload widget, documents table + context, build console
    ├── gateways/           # ALL backend talk (same word, same meaning as backend gateways/)
    │   ├── api/            #   typed fetchers, one module per backend domain (no barrel —
    │   │                   #   directly importable sub-hubs) + toc.ts outline helpers
    │   └── server/         #   server-only: learn-proxy, learn-upstream, auth*, pg, user dbs
    ├── kit/                # product-blind building blocks
    │   ├── ui/             #   shadcn primitives (managed by components.json)
    │   ├── patterns/       #   the pattern kit: stat-tile, status-pill, meter-bar, …
    │   ├── layout/         #   brand mark, theme provider/toggle, info modal
    │   ├── hooks/          #   use-polling, use-async-data, use-toast
    │   └── lib/            #   cn(), course-title, schedule, scope-url
    ├── middleware.ts       # auth redirects (Next requires it at src/ root)
    └── types/              # ambient .d.ts overrides
```

## The contract (enforced by `scripts/check-hubs.mjs`, mirror of the backend checker)

1. **Surfaces are siblings, gated by hubs.** Each `surfaces/<x>/index.ts` is the surface's
   only legal import surface from outside. Cross-surface edges are allowed in any
   direction (screens genuinely embed each other — reading's study drawer mounts
   studying's panels; studying embeds concepts primitives) but always through the hub,
   never a deep path. Intra-surface deep imports are internal and free.
2. **Layer direction.** `kit` imports nothing above it; `gateways` never imports surfaces
   or app. `app/` pages import surface hubs (+ `gateways/api` modules where they fetch).
3. **The server fence.** `gateways/server/*` is importable only from `app/**` (the proxy
   routes + auth pages) and within `gateways/`. Client code fetches relative `/api/…`
   proxy routes instead. `middleware.ts` may import `gateways/server/auth.config` only.
4. **No barrel over `gateways/api/`** — every file imports the domain module it needs, so
   a component's header tells you exactly which backend domains it touches. (A barrel
   also re-triggered an RSC-manifest bundler bug on Next ≤ 15.2.4; fixed in 15.2.9, but
   the explicit imports are the better design regardless.)

## Identifiers — `Course.id` vs `Course.learnDocId`

A course carries **two** ids and they are not interchangeable:

- **`Course.id`** (= `app_documents.id`, = `app_documents.key`) — the app-document-id. It is
  what appears in the URL `/courses/<id>` and identifies the course card.
- **`Course.learnDocId`** (= `app_documents.learn_doc_id`, = the backend's `documents.key`) —
  the learn-doc-key. **Everything the learn backend serves — outline, concepts, mastery,
  reviews, chapters — is keyed by this**, exposed to the proxy routes as `?doc=…`.

So any call into the learn API keys by the learn-doc-key, with a fallback for legacy rows
that never got one:

```ts
const docKey = course.learnDocId ?? course.id   // the one resolution, do it once
```

That `?? course.id` fallback exists because early `app_documents` rows used the app id
directly as the learn key (no separate `learn_doc_id`). New uploads always set both. When you
add a study/content call, key it by `learnDocId ?? id` — never by `id` alone.

## Where does new code go?

| You are adding… | It goes in… |
|---|---|
| A new screen | its own `surfaces/<name>/` with an `index.ts` hub; a thin page in `app/` mounts it |
| A panel/component for an existing screen | that surface's folder; export via the hub only if another surface or `app/` needs it |
| A call to a new backend endpoint | the matching `gateways/api/<domain>.ts` (+ a thin proxy route under `app/api/learn/`) |
| Anything touching Postgres, NextAuth, or `LEARN_SERVICE_URL` | `gateways/server/` |
| A shadcn primitive | `kit/ui/` via the shadcn CLI |
| A reusable product-blind pattern/hook/util | `kit/patterns/` · `kit/hooks/` · `kit/lib/` |

After changes, rebuild the Docker `app` image (`:3001` is what Mission Control opens):
`docker compose -f ../deploy/compose/docker-compose.yml build app && … up -d app`.
