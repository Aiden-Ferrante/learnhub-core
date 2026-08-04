---
id: TASK-27
title: Learn Hub 1.0 — packaged for outside review by 2026-08-18
status: To Do
assignee: []
created_date: '2026-08-04 23:57'
labels:
  - docs
  - release
dependencies:
  - TASK-7
priority: high
type: feature
ordinal: 27000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Self-set deadline: 2026-08-18.

Learn Hub is the strongest candidate in the code/ fleet for an outside reviewer (internship applications open ~Aug-Nov 2026), but it is currently not evaluable by anyone who is not already running it. The app opens on a login wall with no self-serve signup ('Accounts are provisioned by the administrator'), so a reviewer given the repo URL can read code but cannot see the product work.

The goal is NOT new features. It is making the existing system legible to someone with no context and no credentials. Scope is packaging only; treat feature work as out of scope and file it separately.

Done so far: README.md written (what/why, quickstart, seam, ports) and deploy/compose/.env.example corrected — it had documented the retired ARANGO_ROOT_PASSWORD and omitted the required POSTGRES_PASSWORD, so the documented setup path failed on 'docker compose up'.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A ~90 second demo video exists showing the real loop: upload a PDF, extract a chapter's concepts, do a review session
- [ ] #2 The video is linked from README.md above the fold, so a reviewer sees the product without running anything
- [ ] #3 PROJECT.yaml github link points at learnhub-core (currently points at the non-existent .../learnhub)
- [ ] #4 A person handed only the repo URL can, without credentials, answer: what is this, why does it exist, and does it work
<!-- AC:END -->
