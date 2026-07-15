# Frontend architecture

Feature-partitioned Next.js 15 (App Router) app — the frontend mirror of the backend's
domain-partitioned modular monolith. The rule that generates the whole layout: **code
lives with the feature that owns it; only genuinely shared things live at the top level.**

```
frontend/
├── app/                        # Next.js routes ONLY — thin entry points
│   ├── page.tsx                #   the #learn/#upload/#configure hash router
│   ├── login/  reader/         #   auth page · full-screen book reader
│   └── api/…                   #   ~40 thin proxy handlers → learn backend
├── features/
│   ├── learn/                  # THE product: study surfaces
│   │   ├── api/                #   typed client, one module per backend domain
│   │   ├── components/
│   │   │   ├── learn-tab.tsx   #   the Learn screen (course shelf ⇄ course home)
│   │   │   ├── home/           #   course shelf, course home, syllabus tree, today strip…
│   │   │   ├── reader/         #   book/chapter/deep-chapter readers, audiobook, ask
│   │   │   ├── concepts/       #   concept views, cards, mastery dots
│   │   │   └── study/          #   review, quiz, drill, exam, chapter walk, brain dump
│   │   ├── hooks/              #   reading prefs/theme, in-book find
│   │   └── lib/                #   courses, course groups, learn-path, read-along…
│   ├── documents/              # upload + document table + PDF conversion
│   │   ├── components/         #   upload-tab, upload-documents, documents-table
│   │   ├── document-context.tsx#   the selected-document React context
│   │   ├── hooks/  lib/
│   └── process/                # the chapter build pipeline dashboard
│       └── components/         #   process-tab, process-dashboard, pipeline-grid, machine-strip
├── components/
│   ├── layout/                 # app chrome: header brand, theme, user menu, info modal
│   └── ui/                     # shadcn primitives (managed by components.json — leave in place)
├── hooks/                      # ONLY cross-feature hooks (use-toast)
├── lib/
│   ├── server/                 # server-only: learn-proxy, learn-upstream, auth*, pg, user dbs
│   └── utils.ts                # cn() — shadcn's class helper
└── types/                      # ambient .d.ts overrides
```

## The three boundaries that matter

1. **Client vs server.** Anything importing `pg`, NextAuth config, or the backend's real
   address lives in `lib/server/`. Client code never imports from there; it fetches the
   relative `/api/…` proxy routes. The proxy handlers (`app/api/learn/*`) are the only
   consumers of `lib/server/learn-proxy.ts` + `learn-upstream.ts`.

2. **Feature vs feature.** `learn`, `documents`, and `process` are separate concerns.
   Allowed cross-feature imports (keep this list short):
   - `features/learn/lib/courses.ts` imports the documents context (a course *is* a
     processed document — that coupling is real).
   - `process` reads `features/learn/api/pipeline` (the build pipeline is served by the
     learn backend).

3. **API client modularity.** `features/learn/api/` is split by backend domain — outline,
   content, concepts, progress, review, quiz, reading, chapter, audiobook, search,
   pipeline (+ `http.ts` for shared parsing). **There is deliberately no barrel
   (`index.ts`)**: every file imports the module it needs, so a component's header tells
   you exactly which domains it touches. (A barrel also re-triggered an RSC-manifest
   bundler bug on Next ≤ 15.2.4 — builds broke with "Could not find the module
   app/page.tsx#default in the React Client Manifest"; fixed in 15.2.9, but the explicit
   imports are the better design regardless.)

## Where does new code go?

| You are adding… | It goes in… |
|---|---|
| A new study surface / panel | `features/learn/components/<home\|reader\|concepts\|study>/` |
| A call to a new backend endpoint | the matching `features/learn/api/<domain>.ts` (+ a thin proxy route under `app/api/learn/`) |
| A hook used by one feature | that feature's `hooks/` |
| Anything touching Postgres, NextAuth, or `LEARN_SERVICE_URL` | `lib/server/` |
| A shadcn primitive | `components/ui/` via the shadcn CLI |
| Header/theme/global chrome | `components/layout/` |

After changes, rebuild the Docker `app` image (`:3001` is what Mission Control opens):
`docker compose -f ../deploy/compose/docker-compose.yml build app && … up -d app`.
