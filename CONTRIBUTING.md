# Contributing to @bystep/mcp

Thanks for considering a contribution. This package is a thin MCP proxy to the Bystep API — please keep it that way (see `packages/cli` for the codebase-scanning logic; it doesn't belong here).

## Setup

```
git clone https://github.com/bystep-dev/mcp.git
cd mcp
npm install
```

No build step: it's plain ESM (`type: "module"`), Node >= 18.

## Tests

```
node --test test/*.test.mjs
```

(equivalently `npm test`). `test/server.test.mjs` is the reference for style: it connects an in-process `@modelcontextprotocol/sdk` client to `createServer()` over `InMemoryTransport` — no network, no real token needed for `tools/list`. Add or update a test for any tool you add or change.

## Code style

- Plain ESM, no TypeScript, no bundler/build step. Keep dependencies at (or below) the current two: `@modelcontextprotocol/sdk`, `zod`.
- 2-space indent, no semicolons, single quotes — match the existing files.
- `src/index.js` registers every tool; `src/api.js` is the HTTP client; `src/config.js` mirrors `packages/cli/src/config.js` on purpose (same env vars, same `.bystep/config.json` / `~/.config/bystep/config.json` shape) — if you change one, check whether the other needs the matching change.

## Adding or changing a tool

1. Register it in `createServer()` in `src/index.js` with `server.registerTool(name, { title, description, inputSchema }, handler)`. Use `zod` for `inputSchema` and describe each field — the description is what the calling agent sees.
2. Wrap the handler in the existing `wrap()` helper so errors come back as `{ isError: true, content }` instead of throwing.
3. Add a test in `test/server.test.mjs` — at minimum, assert the tool appears in `tools/list` and that a call with obviously-invalid input errors sensibly.
4. Update the tool table in `README.md`.

## Pull requests

- One logical change per PR; keep the diff focused.
- `node --test test/*.test.mjs` must pass.
- Don't touch `packages/cli` in the same PR unless the change is genuinely coupled (see the `config.js` note above).
- This mirror is synced from the main Bystep monorepo; a maintainer may need to port your change there, so please be patient with review turnaround.

---

## Bahasa Indonesia

Terima kasih sudah mempertimbangkan untuk berkontribusi. Paket ini adalah proxy MCP tipis ke API Bystep — mohon dijaga tetap begitu (logika pemindaian codebase ada di `packages/cli`, bukan di sini).

### Persiapan

```
git clone https://github.com/bystep-dev/mcp.git
cd mcp
npm install
```

Tanpa tahap build: ESM murni (`type: "module"`), Node >= 18.

### Pengujian

```
node --test test/*.test.mjs
```

(setara `npm test`). `test/server.test.mjs` adalah rujukan gaya: menghubungkan klien `@modelcontextprotocol/sdk` in-process ke `createServer()` lewat `InMemoryTransport` — tanpa jaringan, tanpa token asli untuk `tools/list`. Tambah/ubah test untuk setiap tool yang Anda tambah atau ubah.

### Gaya kode

- ESM murni, tanpa TypeScript, tanpa bundler/tahap build. Jaga dependency tetap di (atau di bawah) dua yang sekarang: `@modelcontextprotocol/sdk`, `zod`.
- Indentasi 2 spasi, tanpa titik koma, tanda kutip tunggal — ikuti file yang sudah ada.
- `src/index.js` mendaftarkan semua tool; `src/api.js` klien HTTP; `src/config.js` sengaja mencerminkan `packages/cli/src/config.js` (env var sama, bentuk `.bystep/config.json` / `~/.config/bystep/config.json` sama) — bila Anda ubah satu, cek apakah yang lain perlu perubahan serupa.

### Menambah atau mengubah tool

1. Daftarkan di `createServer()` pada `src/index.js` dengan `server.registerTool(name, { title, description, inputSchema }, handler)`. Pakai `zod` untuk `inputSchema` dan beri deskripsi tiap field — deskripsi itulah yang dilihat agent pemanggil.
2. Bungkus handler dengan helper `wrap()` yang sudah ada supaya error kembali sebagai `{ isError: true, content }`, bukan melempar exception.
3. Tambahkan test di `test/server.test.mjs` — minimal, pastikan tool muncul di `tools/list` dan pemanggilan dengan input jelas-tidak-valid mengembalikan error yang masuk akal.
4. Perbarui tabel tool di `README.md`.

### Pull request

- Satu perubahan logis per PR; jaga diff tetap fokus.
- `node --test test/*.test.mjs` harus lulus.
- Jangan sentuh `packages/cli` dalam PR yang sama kecuali perubahannya benar-benar terkait (lihat catatan `config.js` di atas).
- Cermin ini disinkronkan dari monorepo utama Bystep; maintainer mungkin perlu memindahkan perubahan Anda ke sana, jadi mohon sabar menunggu review.
