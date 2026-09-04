# @bystep/mcp

[![npm](https://img.shields.io/npm/v/@bystep/mcp.svg)](https://www.npmjs.com/package/@bystep/mcp)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

MCP (Model Context Protocol) server for [Bystep](https://bystep.dev). Exposes the Bystep task loop and PRD as MCP tools to Claude Code, Cursor, Codex and any MCP client, over stdio — the same loop the [`@bystep/cli`](https://www.npmjs.com/package/@bystep/cli) exposes as shell commands, for agents that prefer calling tools directly.

This repository is the **open-source mirror** of `packages/mcp` from the main [bystep monorepo](https://bystep.dev). The Bystep server (web app, database, AI orchestration) stays closed-source; this thin client that runs on your machine is public so you can read exactly what it sends before you wire it into your agent.

## Install

Most MCP clients run it with `npx` directly (see config below) — no manual install needed. If you want it globally:

```
npm install -g @bystep/mcp
```

Requires Node.js >= 18.

## Configure

Add to your MCP client's config (Claude Code `.mcp.json`, Cursor `mcp.json`, etc.):

```json
{
  "mcpServers": {
    "bystep": {
      "command": "npx",
      "args": ["-y", "@bystep/mcp"],
      "env": { "BYSTEP_TOKEN": "bs_…", "BYSTEP_PLAN_ID": "<planId>" }
    }
  }
}
```

Auth resolves from `BYSTEP_TOKEN` env, or falls back to the login saved by `npx @bystep/cli login` (`~/.config/bystep/config.json`). Plan/workspace defaults resolve from `BYSTEP_PLAN_ID` / `BYSTEP_WORKSPACE_ID`, or from `.bystep/config.json` written by `npx @bystep/cli connect`.

## Tools

Read the full input/output schemas in [`src/index.js`](./src/index.js) — every tool is registered there with its `inputSchema` and description.

| Tool | What it does |
|---|---|
| `plan_get` | Fetch the full PRD of a plan as text (or `json: true` for the raw JSON): goals, features, tech stack. Read it once before starting tasks |
| `plan_list` | List the logged-in user's plans with status and workspace |
| `task_next` | Ask the server for ONE next task of a plan. Returns `{ done, task:{ref,title,layer,tier,acceptance,packet,...}, execution, checkpoint_pending, checkpoint?, progress }`. `done: true` means everything is finished. **If `checkpoint_pending` is true, STOP and report to the user** (execution mode `checkpoint`/`strict`) — in `autopilot` mode this never happens except at done |
| `task_packet` | Fresh, small context for ONE task, rendered as Markdown (title, tier, feature goal, PRD excerpt, acceptance table, owned files, do-not-touch, relevant files, conventions, verify commands). Read this instead of `plan_get`'s full PRD while working on a task |
| `task_start` | Mark a task `in_progress`. Work ONLY on this task until it is done |
| `task_verify` | Run the task's acceptance criteria **locally in this process** (test/build/lint via shell, http via fetch, file existence, screenshot/manual reported as skipped) and upload pass/fail evidence — mirrors `bystep task verify`. Call this before `task_complete` |
| `task_complete` | Requires passing evidence; call `task_verify` first. The server rejects an unverified `done` with `409 evidence_required` unless an override reason is passed (recorded and visible in the workspace). Marks the task done and returns the next step |
| `task_fail` | Mark a task `failed` with a short reason when blocked, then continue with `task_next` |
| `task_evidence_get` | Read back the evidence trail of a task (newest first): status, attempt, passed/total, commit, diff, verifier, override reason, reviewer note, date |
| `phase_approve` | Record a human checkpoint approval for a phase/layer, unblocking `task_next` in `checkpoint`/`strict` execution mode; optionally return specific tasks to the agent with a reason |
| `sync_status` | Index/summary counts of the connected workspace: `{ status, fileCount, summarisedCount, hasWiki, wikiVersion }`. The index itself is updated by the CLI (`npx @bystep/cli sync --plan` / `npx @bystep/cli sync`), not by this server — the MCP server never reads or uploads your source files |

### Proof-of-Done loop

`task_next → task_start → task_packet → do only that task → task_verify → task_complete`. Verification is mandatory: `task_complete` is rejected until `task_verify` has recorded a pass (or the caller passes an explicit override reason, which is always recorded and visible). Three execution modes live in `execution.mode` (also returned by `task_next`): `autopilot` never stops the loop except at done; `checkpoint` stops once per phase/layer group for a human to call `phase_approve`; `strict` stops after every task the same way.

## Privacy

This server is a thin proxy: every tool call maps to one authenticated HTTP request to the Bystep API (see [`src/api.js`](./src/api.js)) and returns the response as text. It never reads your filesystem itself — codebase scanning and the strict "never upload source, refuse `.env`/secrets" rules live entirely in `@bystep/cli`'s [`src/scan.js`](https://github.com/bystep-dev/cli/blob/main/src/scan.js), which this package does not call. Read [`src/index.js`](./src/index.js) end to end; it is short by design.

## Exit codes / errors

This is a long-running stdio server, not a one-shot CLI — there is no process exit code to check. Tool failures come back as MCP tool results with `isError: true` and a text message (`{status} {message} ({code})` for API errors, e.g. `401 Not logged in (no_token)`).

## Environment variables

| Variable | Purpose |
|---|---|
| `BYSTEP_TOKEN` | `bs_…` personal token. Falls back to the token saved by `@bystep/cli login` |
| `BYSTEP_API_URL` | API base URL (default `https://bystep.dev`) |
| `BYSTEP_PLAN_ID` | Default `planId` for tools that accept one, when not passed explicitly |
| `BYSTEP_WORKSPACE_ID` | Default `workspaceId` for `sync_status`, when not passed explicitly |
| `BYSTEP_REPO` | Directory to resolve `.bystep/config.json` from (default: current working directory, walking up) |

## Docs & support

- Full docs: https://bystep.dev/docs
- Prefer a shell/CLI workflow? See [`@bystep/cli`](https://www.npmjs.com/package/@bystep/cli) — it exposes the same task loop as commands
- Bugs / feature requests: open an issue in this repo
- Contributing: see [CONTRIBUTING.md](./CONTRIBUTING.md)
- License: [MIT](./LICENSE)

---

## Bahasa Indonesia

Server MCP (Model Context Protocol) untuk [Bystep](https://bystep.dev). Menyediakan loop task dan PRD Bystep sebagai tool MCP untuk Claude Code, Cursor, Codex, dan klien MCP mana pun lewat stdio — loop yang sama yang disediakan [`@bystep/cli`](https://www.npmjs.com/package/@bystep/cli) sebagai perintah shell, untuk agent yang lebih suka memanggil tool langsung.

Repo ini adalah **cermin open-source** dari `packages/mcp` pada monorepo utama Bystep. Server Bystep (aplikasi web, database, orkestrasi AI) tetap tertutup; klien tipis yang berjalan di mesin Anda ini dibuka publik supaya Anda bisa membaca persis apa yang dikirimnya sebelum menghubungkannya ke agent Anda.

### Instalasi

Kebanyakan klien MCP menjalankannya langsung dengan `npx` (lihat konfigurasi di bawah) — tidak perlu instalasi manual. Untuk pasang global:

```
npm install -g @bystep/mcp
```

Membutuhkan Node.js >= 18.

### Konfigurasi

Tambahkan ke konfigurasi klien MCP Anda (`.mcp.json` Claude Code, `mcp.json` Cursor, dsb.):

```json
{
  "mcpServers": {
    "bystep": {
      "command": "npx",
      "args": ["-y", "@bystep/mcp"],
      "env": { "BYSTEP_TOKEN": "bs_…", "BYSTEP_PLAN_ID": "<planId>" }
    }
  }
}
```

Autentikasi diambil dari env `BYSTEP_TOKEN`, atau jatuh ke login yang tersimpan dari `npx @bystep/cli login` (`~/.config/bystep/config.json`). Default plan/workspace diambil dari `BYSTEP_PLAN_ID` / `BYSTEP_WORKSPACE_ID`, atau dari `.bystep/config.json` hasil `npx @bystep/cli connect`.

### Daftar tool

Lihat tabel "Tools" di atas — sama untuk semua bahasa. Ringkasnya: `plan_get`/`plan_list` (baca PRD/daftar plan), `task_next`/`task_start`/`task_packet`/`task_verify`/`task_complete`/`task_fail` (loop task Proof-of-Done, dengan aturan checkpoint), `task_evidence_get` (jejak bukti), `phase_approve` (persetujuan checkpoint), `sync_status` (hitungan indeks — sinkron sendiri tetap lewat CLI).

### Proof-of-Done

Loop: `task_next → task_start → task_packet → kerjakan task itu saja → task_verify → task_complete`. Verifikasi wajib: `task_complete` ditolak sampai `task_verify` mencatat lulus (atau pemanggil memberi alasan override, yang selalu dicatat dan terlihat). Tiga mode eksekusi ada di `execution.mode`: `autopilot` tidak pernah berhenti kecuali selesai; `checkpoint` berhenti sekali per grup fase/layer menunggu manusia memanggil `phase_approve`; `strict` berhenti setelah setiap task.

### Privasi

Server ini adalah proxy tipis: setiap pemanggilan tool berpadanan dengan satu permintaan HTTP terautentikasi ke API Bystep (lihat [`src/api.js`](./src/api.js)) dan mengembalikan responsnya sebagai teks. Server ini TIDAK PERNAH membaca sistem berkas Anda sendiri — pemindaian codebase dan aturan ketat "jangan pernah unggah kode sumber, tolak `.env`/secrets" seluruhnya hidup di `@bystep/cli` ([`src/scan.js`](https://github.com/bystep-dev/cli/blob/main/src/scan.js)), yang tidak dipanggil paket ini. Baca [`src/index.js`](./src/index.js) sampai habis — sengaja dibuat pendek.

### Kode keluar / error

ini server stdio yang berjalan lama, bukan CLI sekali-jalan — tidak ada exit code proses untuk dicek. Kegagalan tool kembali sebagai hasil tool MCP dengan `isError: true` dan pesan teks (`{status} {message} ({code})` untuk error API).

### Variabel lingkungan

`BYSTEP_TOKEN`, `BYSTEP_API_URL`, `BYSTEP_PLAN_ID`, `BYSTEP_WORKSPACE_ID`, `BYSTEP_REPO` — lihat tabel di atas.

### Dokumentasi & dukungan

- Dokumentasi lengkap: https://bystep.dev/docs
- Lebih suka alur shell/CLI? Lihat [`@bystep/cli`](https://www.npmjs.com/package/@bystep/cli)
- Laporan bug / permintaan fitur: buka issue di repo ini
- Kontribusi: lihat [CONTRIBUTING.md](./CONTRIBUTING.md)
- Lisensi: [MIT](./LICENSE)
