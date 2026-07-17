#!/usr/bin/env node
/** check-hubs — the frontend module-hub contract, enforced.
 *  Mirror of scripts/check_hubs.py (backend).
 *
 *  The tree: kit/ (product-blind UI + hooks + utils) ← gateways/ (all backend talk:
 *  server seam + api fetchers) ← surfaces/ (the five screens) ← app/ (routes).
 *
 *  Fails (exit 1) on:
 *   1. cross-surface deep imports that bypass a hub
 *      (from outside surfaces/<x>, only "@/surfaces/<x>" is legal — surfaces are
 *      siblings; any hub-mediated edge is allowed, in either direction)
 *   2. upward imports against kit <- gateways <- surfaces <- app
 *      (kit may import nothing above it; gateways never imports surfaces or app)
 *   3. "@/gateways/server/*" imported from anywhere except app/** or gateways/**
 *      (the server fence; middleware.ts may import gateways/server/auth.config only)
 *   4. a surface hub (surfaces/<x>/index.ts) missing its doc header, or containing logic
 *
 *  gateways/api/<mod> modules are directly importable (per-backend-domain sub-hubs;
 *  the 2026-07-14 no-barrel decision stands for them).
 *
 *  Usage: node scripts/check-hubs.mjs [--report]
 */

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("../src/", import.meta.url).pathname;
const SURFACES = readdirSync(join(ROOT, "surfaces")).filter((d) =>
  statSync(join(ROOT, "surfaces", d)).isDirectory()
);
const LAYER = { kit: 0, gateways: 1, surfaces: 2, app: 3 };

const problems = [];

function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".next", ".git"].includes(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (/\.(ts|tsx|mjs)$/.test(e.name) && !e.name.endsWith(".d.ts")) yield p;
  }
}

// 4. hub hygiene
for (const s of SURFACES) {
  const hub = join(ROOT, "surfaces", s, "index.ts");
  if (!existsSync(hub)) {
    problems.push(`surfaces/${s}: missing index.ts hub`);
    continue;
  }
  const src = readFileSync(hub, "utf8");
  if (!/^\/\*\*[\s\S]{80,}?\*\//.test(src.trim())) {
    problems.push(`surfaces/${s}/index.ts: hub doc header missing or too thin`);
  }
  if (/\b(function|const\s+\w+\s*=\s*\(|class)\b/.test(src.replace(/\/\*[\s\S]*?\*\//g, ""))) {
    problems.push(`surfaces/${s}/index.ts: hubs hold re-exports + docs only`);
  }
}

// 1-3. import rules
const IMPORT_RE = /(?:import|export)\s+[^"']*?from\s+["'](@\/[^"']+)["']|import\s+["'](@\/[^"']+)["']/g;
for (const area of ["app", "surfaces", "gateways", "kit"]) {
  const dir = join(ROOT, area);
  if (!existsSync(dir)) continue;
  for (const file of walk(dir)) {
    const rel = relative(ROOT, file);
    const parts = rel.split("/");
    const srcArea = parts[0];
    const srcSurface = srcArea === "surfaces" ? parts[1] : null;
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(IMPORT_RE)) {
      const target = m[1] ?? m[2]; // "@/..."
      const t = target.slice(2).split("/");
      const tgtArea = t[0];

      // 3. server fence
      if (tgtArea === "gateways" && t[1] === "server") {
        const ok = srcArea === "app" || srcArea === "gateways";
        if (!ok) problems.push(`${rel}: server module ${target} imported outside app/ or gateways/`);
      }

      // 2. layer direction
      if (srcArea in LAYER && tgtArea in LAYER && LAYER[tgtArea] > LAYER[srcArea]) {
        problems.push(`${rel}: upward import ${srcArea} -> ${tgtArea} (${target})`);
      }

      if (tgtArea !== "surfaces") continue;
      const tgtSurface = t[1];
      if (srcSurface === tgtSurface) continue; // intra-surface deep imports are internal
      // 1. cross-surface (or app->surface): hub only
      if (t.length > 2) {
        problems.push(`${rel}: deep import into surfaces/${tgtSurface} — use its hub (${target})`);
      }
    }
  }
}

// middleware.ts — server fence exception: auth.config only
{
  const rel = "middleware.ts";
  const src = readFileSync(join(ROOT, rel), "utf8");
  for (const m of src.matchAll(IMPORT_RE)) {
    const target = m[1] ?? m[2];
    if (target.startsWith("@/gateways/server/") && !target.startsWith("@/gateways/server/auth.config")) {
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
  "frontend hub contract holds: hubs documented, no deep/upward imports, server fence intact"
);
