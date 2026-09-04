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
| `task_next` | Ask the server for ONE next task of a plan. Returns `{ done, task:{ref,title,layer,...}, progress:{phase:{current,total}, layer, page, doneTasks, totalTasks} }`. `done: true` means everything is finished. **Checkpoint**: if `layer` or `phase.current` differs from the task you just finished, stop and report to the user before `task_start` |
| `task_start` | Mark a task `in_progress`. Work ONLY on this task until it is done |
| `task_complete` | Mark a task `done`, then call `task_next` again |
| `task_fail` | Mark a task `failed` with a short reason when blocked, then continue with `task_next` |
| `sync_status` | Index/summary counts of the connected workspace: `{ status, fileCount, summarisedCount, hasWiki, wikiVersion }`. The index itself is updated by the CLI (`npx @bystep/cli sync --plan` / `npx @bystep/cli sync`), not by this server — the MCP server never reads or uploads your source files |

### Coming in v0.2 — Proof-of-Done

Two tools are being added alongside the CLI's `task verify`:

- `task_verify {planId?, ref, skip?[], override?}` — runs the task's acceptance criteria and uploads pass/fail evidence, mirroring `bystep task verify`.
- `task_evidence_get {planId?, ref}` — reads back the evidence trail for a task.

`task_complete`'s description will change to make the new requirement explicit: "Requires passing evidence; call task_verify first." — the server rejects an unverified `done` unless the caller passes an override reason, which is recorded and visible in the workspace.

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

Lihat tabel "Tools" di atas — sama untuk semua bahasa. Ringkasnya: `plan_get`/`plan_list` (baca PRD/daftar plan), `task_next`/`task_start`/`task_complete`/`task_fail` (loop task, dengan aturan checkpoint), `sync_status` (hitungan indeks — sinkron sendiri tetap lewat CLI).

### Akan datang di v0.2 — Proof-of-Done

Dua tool baru menyertai `task verify` di CLI: `task_verify` (menjalankan acceptance criteria dan mengunggah bukti lulus/gagal) dan `task_evidence_get` (membaca jejak bukti sebuah task). Deskripsi `task_complete` akan berubah menjadi "Requires passing evidence; call task_verify first."

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
