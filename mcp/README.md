# learn-hub MCP server

Lets an MCP client (Claude Code / Claude Desktop) drive the **Learn Hub** — inspect
courses & study state, run processing, study interactively, and curate content.

**Design:** the server talks **only** to the Learn service's REST API (`:8010`). It holds **no
database credentials** — the few gaps (listing courses, editing concepts) are REST endpoints the
learn service serves with its own Arango access (`app/admin_routes.py`). Keyless & local.

## Tools (27)

| Group | Tools |
|---|---|
| **Inspect** (read) | `list_courses`, `get_outline`, `get_chapter`, `get_section`, `search_text`, `list_concepts`, `concept_mastery`, `due_reviews`, `section_content` |
| **Processing** (write) | `extract`, `extraction_status`, `prepare_quizzes`, `quiz_prepare_status` |
| **Study** (write) | `quiz_next`, `quiz_answer`, `grade_review` |
| **Author/curate** (write) | `update_concept`, `set_concept_questions` |
| **Reading & audio** | `orient`, `skeleton`, `reading_guide`, `prepare_reading_guide`, `flashcard_deck`, `audiobook_voices`, `generate_audiobook`, `audiobook_status`, `audiobook_list` |

Most tools take a course `doc` (a learnDocId from `list_courses`) and an optional `scope`
(a TOC section key like `toc:language-models`; omit = whole course).

## Run / register

Already registered at **user scope** (in `~/.claude.json`). To re-add elsewhere:

```bash
claude mcp add --scope user learn-hub \
  -e LEARN_URL=http://localhost:8010 -e LEARN_USER_DB=learnhub \
  -- /home/mooteo/Desktop/code/learnhub/mcp/.venv/bin/python \
     /home/mooteo/Desktop/code/learnhub/mcp/server.py
```

**Env:** `LEARN_URL` (default `http://localhost:8010`), `LEARN_USER_DB` (default `learnhub`,
sent as the `X-User-Db` header). Requires the learn service (`compose-learn-1`) to be up.

## HTTP transport (Claude Desktop / other devices over the tailnet)

Set `LEARN_MCP_TRANSPORT=http` to serve Streamable-HTTP (default port `8011`, `LEARN_MCP_PORT`).
The MCP SDK's DNS-rebinding guard 421s unknown Host headers; `LEARN_MCP_ALLOWED_HOSTS`
(comma-separated `host[:port|:*]`) is allow-listed — it defaults to localhost + the
`spark-9415` tailnet host.

Registered as the **Mission Control** app `learn-hub-mcp` (start/stop there). To connect a remote
Claude Desktop / Claude Code:

```bash
claude mcp add --transport http learn-hub http://spark-9415.tailff006f.ts.net:8011/mcp
```

On **this** machine, the stdio user-scope entry in `~/.claude.json` already covers Claude Code
and Claude Desktop — no extra step.

## Smoke test

```bash
.venv/bin/python - <<'PY'
import asyncio
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
async def m():
    p = StdioServerParameters(command=".venv/bin/python", args=["server.py"])
    async with stdio_client(p) as (r,w):
        async with ClientSession(r,w) as s:
            await s.initialize()
            print([t.name for t in (await s.list_tools()).tools])
asyncio.run(m())
PY
```
