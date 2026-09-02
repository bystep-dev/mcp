# @bystep/mcp

MCP (Model Context Protocol) server for [Bystep](https://bystep.dev). Exposes the task loop and PRD to Claude Code, Cursor, and any MCP client over stdio.

Tools: `plan_get`, `plan_list`, `task_next`, `task_start`, `task_complete`, `task_fail`, `sync_status`.

Auth: `BYSTEP_TOKEN` env (a `bs_…` token from Settings → API keys) or the login saved by `npx bystep login`.
Defaults: `BYSTEP_PLAN_ID` / `BYSTEP_WORKSPACE_ID`, or `.bystep/config.json` written by `npx bystep connect`.

```json
{ "mcpServers": { "bystep": { "command": "npx", "args": ["-y", "@bystep/mcp"], "env": { "BYSTEP_TOKEN": "bs_…", "BYSTEP_PLAN_ID": "<planId>" } } } }
```
