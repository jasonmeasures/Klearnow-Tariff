# KlearNow Tariff MCP

Connect **Claude Desktop**, **Cursor**, or any MCP client to the live Tariff API so you can **assess duties** and **hot-update 301-FL rules without rebuilding** the app.

## Prerequisites

1. Backend running: `cd backend && npm run dev` (`:8080`)
2. Author API key: `dev-internal` (has `write_rules`)

## Install & run

```bash
cd mcp
npm install
TARIFF_API_URL=http://localhost:8080 TARIFF_API_KEY=dev-internal npm start
```

## Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "klearnow-tariff": {
      "command": "npx",
      "args": ["tsx", "/ABSOLUTE/PATH/TO/Tariff tool/mcp/src/index.ts"],
      "env": {
        "TARIFF_API_URL": "http://localhost:8080",
        "TARIFF_API_KEY": "dev-internal"
      }
    }
  }
}
```

Restart Claude. Ask: *“Look up HTS 6203.42.4010 and assess duty for VN $25,000 on 2026-07-25”* or *“Upsert 301-FL flat 12.5% for XX under heading 9903.05.99”*.

## Cursor

**Settings → MCP → Add new MCP server** (or `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "klearnow-tariff": {
      "command": "npx",
      "args": ["tsx", "/ABSOLUTE/PATH/TO/Tariff tool/mcp/src/index.ts"],
      "env": {
        "TARIFF_API_URL": "http://localhost:8080",
        "TARIFF_API_KEY": "dev-internal"
      }
    }
  }
}
```

## Tools

| Tool | What it does |
|---|---|
| `health` | Pack hash + engines |
| `lookup_hts` | Baseline Column-1 rate |
| `assess_entry` | Duty stack (`auto` or `ch99`) |
| `list_rules` | Browse rules |
| `list_s301fl` / `upsert_s301fl_country` | Read / hot-update 301-FL economies |
| `reload_pack` | Reload caches after file edits |
| `openapi` | Full HTTP contract for other tools |

Writes go to `tariff-rules/data/s301fl_pack.json` and reload memory — **no Docker rebuild, no frontend redeploy**.
