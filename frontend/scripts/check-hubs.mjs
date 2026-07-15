#!/usr/bin/env node
/** check-hubs — the frontend module-hub contract, enforced.
 *  Mirror of scripts/check_hubs.py (backend); spec in docs/frontend-org-audit.md §2.
 *
 *  Fails (exit 1) on:
 *   1. cross-feature/deep imports that bypass a hub
 *      (from outside features/<x>, only "@/features/<x>" and "@/features/<x>/api/<mod>" are legal)
 *   2. upward imports against the direction lib <- components <- features <- app
 *      (components/** may never import "@/features/*" or "@/app/*"; lib may import nothing above it)
 *   3. cross-feature edges not on the allowlist  {process->learn, learn->documents}
 *   4. "@/lib/server/*" imported from anywhere except app/** or lib/server/** (the server fence;
 *      middleware.ts may import lib/server/auth.config only)
 *   5. a feature hub (features/<x>/index.ts) missing its doc header, or containing logic
 *
 *  Usage: node scripts/check-hubs.mjs [--report]
 */

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const FEATURES = readdirSync(join(ROOT, "features")).filter((d) =>
  statSync(join(ROOT, "features", d)).isDirectory()
);
const CROSS_FEATURE_ALLOW = new Set(["process->learn", "learn->documents"]);
const LAYER = { lib: 0, hooks: 1, components: 1, features: 2, app: 3 };

const problems = [];

function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".next", ".git"].includes(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (/\.(ts|tsx|mjs)$/.test(e.name) && !e.name.endsWith(".d.ts")) yield p;
  }
}

// 5. hub hygiene
for (const feat of FEATURES) {
  const hub = join(ROOT, "features", feat, "index.ts");
  if (!existsSync(hub)) {
    problems.push(`features/${feat}: missing index.ts hub`);
    continue;
  }
  const src = readFileSync(hub, "utf8");
  if (!/^\/\*\*[\s\S]{80,}?\*\//.test(src.trim())) {
    problems.push(`features/${feat}/index.ts: hub doc header missing or too thin`);
  }
  if (/\b(function|const\s+\w+\s*=\s*\(|class)\b/.test(src.replace(/\/\*[\s\S]*?\*\//g, ""))) {
    problems.push(`features/${feat}/index.ts: hubs hold re-exports + docs only`);
  }
}

// 1-4. import rules
const IMPORT_RE = /(?:import|export)\s+[^"']*?from\s+["'](@\/[^"']+)["']|import\s+["'](@\/[^"']+)["']/g;
for (const area of ["app", "features", "components", "lib", "hooks"]) {
  const dir = join(ROOT, area);
  if (!existsSync(dir)) continue;
  for (const file of walk(dir)) {
    const rel = relative(ROOT, file);
    const parts = rel.split("/");
    const srcArea = parts[0];
    const srcFeat = srcArea === "features" ? parts[1] : null;
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(IMPORT_RE)) {
      const target = m[1] ?? m[2]; // "@/..."
      const t = target.slice(2).split("/");
      const tgtArea = t[0];

      // 4. server fence
      if (tgtArea === "lib" && t[1] === "server") {
        const ok =
          srcArea === "app" ||
          (srcArea === "lib" && parts[1] === "server") ||
          (rel === "middleware.ts" && t[2]?.startsWith("auth.config"));
        if (!ok) problems.push(`${rel}: server module ${target} imported outside app/ or lib/server/`);
      }

      // 2. layer direction (components/hooks/lib never look up)
      if (srcArea in LAYER && tgtArea in LAYER && LAYER[tgtArea] > LAYER[srcArea]) {
        problems.push(`${rel}: upward import ${srcArea} -> ${tgtArea} (${target})`);
      }

      if (tgtArea !== "features") continue;
      const tgtFeat = t[1];
      const sub = t.slice(2).join("/");
      const crossFeature = srcFeat !== tgtFeat;
      if (!crossFeature) continue; // intra-feature deep imports are the point of no-barrel

      // 3. allowlist for feature->feature
      if (srcFeat) {
        const edge = `${srcFeat}->${tgtFeat}`;
        if (!CROSS_FEATURE_ALLOW.has(edge)) {
          problems.push(`${rel}: cross-feature edge ${edge} is not allowlisted (${target})`);
        }
      }

      // 1. hub-or-api-sub-hub only
      const legal = sub === "" || sub === "index" || /^api\/[\w-]+$/.test(sub);
      if (!legal) {
        problems.push(`${rel}: deep import into features/${tgtFeat} — use the hub or an api sub-hub (${target})`);
      }
    }
  }
}

// middleware.ts (repo-root of frontend) — covered above only if walked; check it explicitly
{
  const rel = "middleware.ts";
  const src = readFileSync(join(ROOT, rel), "utf8");
  for (const m of src.matchAll(IMPORT_RE)) {
    const target = m[1] ?? m[2];
    if (target.startsWith("@/lib/server/") && !target.startsWith("@/lib/server/auth.config")) {
      problems.push(`${rel}: server module ${target} — middleware may import auth.config only`);
    }
  }
}

if (problems.length) {
  console.log(`frontend hub-contract violations: ${problems.length}`);
  for (const p of problems) console.log(`  ${p}`);
  process.exit(process.argv.includes("--report") ? 0 : 1);
}
console.log(
  "frontend hub contract holds: hubs documented, no deep/cross-feature/upward imports, server fence intact"
);
