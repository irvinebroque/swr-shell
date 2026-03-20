# swr-shell

A minimal demo of **stale-while-revalidate (SWR) caching** using Cloudflare Workers and R2. It shows how to serve a JSON asset from R2 through Cloudflare's CDN so that Worker subrequests always receive a fast cached response — with background revalidation instead of cold reads.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/irvinebroque/swr-shell)

---

## How it works

```
Browser → Worker (swr-shell-demo) → Cloudflare CDN cache → R2 bucket
```

1. A browser requests `swr-shell-demo.your-subdomain.workers.dev/`.
2. The Worker makes a subrequest to a **bootstrap data URL** — an R2 object served behind Cloudflare's CDN on a custom domain.
3. The CDN serves the R2 object from cache and returns it in milliseconds. The Worker renders the response headers and body into an HTML debug page so you can observe cache behavior live.
4. The R2 object is uploaded with:
   ```
   Cache-Control: public, max-age=0, s-maxage=30, stale-while-revalidate=2147483648
   ```
   Which means:
   - Cloudflare's edge serves the asset fresh for **30 seconds** — subrequests during this window get `cf-cache-status: HIT` (~8ms).
   - After 30 seconds, Cloudflare serves the stale copy immediately while revalidating in the background (`cf-cache-status: REVALIDATED`). The caller still gets a fast response.
   - The asset stays warm in cache indefinitely via `stale-while-revalidate`.
   - `max-age=0` tells browsers and the Worker's own fetch cache not to cache client-side — all caching goes through the CDN layer.

### Why not just use `max-age`?

Without SWR configured correctly, every Worker subrequest that misses the CDN cache pays the full R2 origin latency (~195ms). With `s-maxage=60, stale-while-revalidate=3600`, that cold read happens at most once per 60-second window, and background revalidation keeps the asset warm. Result: clients nearly always see sub-10ms cache hits.

### What the debug page shows

The Worker captures and renders these response headers from the upstream fetch:

| Header | What it tells you |
|---|---|
| `cf-cache-status` | `HIT`, `MISS`, `REVALIDATED`, or `EXPIRED` |
| `age` | Seconds since the cached copy was last fetched from origin |
| `cache-control` | The `Cache-Control` value stored on the R2 object |
| `etag` | Entity tag for the object version |
| `last-modified` | When the object was last written to R2 |
| `x-origin-revision` | Custom header for tracking which version is in cache |

### Cache behavior reference

| Scenario | `cf-cache-status` | Latency |
|---|---|---|
| First request to an edge node | `MISS` | ~195ms |
| Subsequent requests within 30s | `HIT` | ~8ms |
| First request after 30s (SWR window) | `REVALIDATED` | ~8ms (stale served, background refresh) |
| Request after 1hr with no traffic | `EXPIRED` | ~195ms |

---

## Repository structure

```
swr-shell/
├── src/
│   └── index.ts             # Worker logic + HTML renderer
├── test/
│   └── index.spec.ts        # Vitest unit tests
├── data/
│   └── bootstrap.json       # The JSON payload uploaded to R2
├── wrangler.jsonc            # Worker config (name, vars, observability)
├── vite.config.mts           # Vite build config
└── vitest.config.mts         # Vitest config
```

---

## Deploying to your own Cloudflare account

### Prerequisites

- A [Cloudflare account](https://dash.cloudflare.com/sign-up)
- A domain added to Cloudflare (needed to serve the R2 bucket on a custom hostname — required for caching)
- [Node.js](https://nodejs.org) ≥ 18 and [pnpm](https://pnpm.io) installed
- Wrangler authenticated: `npx wrangler login`

---

### Step 1 — Clone the repo

```sh
git clone https://github.com/irvinebroque/swr-shell.git
cd swr-shell
pnpm install
```

---

### Step 2 — Create the R2 bucket

```sh
npx wrangler r2 bucket create bootstrap-data --jurisdiction eu
```

You can use any jurisdiction — just update `BOOTSTRAP_ORIGIN_URL` in `wrangler.jsonc` to match your custom domain later.

---

### Step 3 — Connect a custom domain to the R2 bucket

R2 objects are not publicly accessible by default. You need to attach a custom hostname so the Worker can fetch the object over HTTP, and so Cloudflare's CDN layer sits in front of it (which is what enables SWR caching).

1. Go to **Cloudflare Dashboard → R2 → bootstrap-data → Settings → Custom Domains**.
2. Click **Connect Domain**.
3. Enter a hostname on a zone you control, e.g. `bootstrap-data.yourdomain.com`.
4. Cloudflare automatically creates the DNS record and provisions TLS.

> **Why this matters:** The CDN cache is what makes `stale-while-revalidate` work. Without a CDN layer in front of R2, Worker subrequests go straight to the R2 origin every time.

---

### Step 4 — Create a Cache Rule for the R2 origin

By default, Cloudflare does not cache `application/json` responses. You need a Cache Rule to make it eligible.

1. Go to **Cloudflare Dashboard → your zone → Caching → Cache Rules**.
2. Click **Create rule**.
3. Set the match condition to: **Hostname** equals `bootstrap-data.yourdomain.com`.
4. Under **Cache eligibility**, select **Eligible for cache**.
5. Under **Edge TTL**, select **Use Cache-Control header** (respect the origin's directive).
6. Save and deploy the rule.

---

### Step 5 — (Optional) Enable Tiered Cache

Tiered Cache reduces the number of requests that reach R2 by routing cache misses through Cloudflare's upper-tier data centers before going to origin.

1. Go to **Cloudflare Dashboard → your zone → Caching → Tiered Cache**.
2. Enable **Smart Tiered Cache Topology**.

---

### Step 6 — Upload the bootstrap data to R2

```sh
pnpm run upload:bootstrap-data
```

This puts `data/bootstrap.json` into your R2 bucket with the correct `Cache-Control` header stored as object metadata:

```
public, max-age=0, s-maxage=30, stale-while-revalidate=2147483648
```

---

### Step 7 — Update the bootstrap origin URL in wrangler.jsonc

Edit `wrangler.jsonc` and replace the `BOOTSTRAP_ORIGIN_URL` with your custom domain:

```jsonc
"vars": {
    "BOOTSTRAP_ORIGIN_URL": "https://bootstrap-data.yourdomain.com/api/bootstrap"
}
```

---

### Step 8 — Deploy the Worker

```sh
pnpm run deploy
```

On success, Wrangler prints the Worker URL:

```
https://swr-shell-demo.your-subdomain.workers.dev
```

Open it in a browser. You should see the bootstrap JSON body and response headers. Refresh a few times and watch `cf-cache-status` and `age` change.

---



## Local development

```sh
pnpm run dev
```

This starts the Worker locally via Vite + `@cloudflare/vite-plugin`. Note that local dev bypasses the Cloudflare CDN, so `cf-cache-status` will not appear — you'll see raw R2 origin latency on every request.

---

## Re-uploading bootstrap data

If you change `data/bootstrap.json`, re-upload it:

```sh
pnpm run upload:bootstrap-data
```

The existing CDN cache entry expires at most `s-maxage + stale-while-revalidate` = 3660 seconds (~1 hour) after the last request. To force an immediate purge, use **Cloudflare Dashboard → Caching → Purge Cache** or the [Cache Purge API](https://developers.cloudflare.com/cache/how-to/purge-cache/).

---

## Other commands

```sh
pnpm test          # run Vitest unit tests
pnpm run typecheck # run tsc --noEmit
pnpm run cf-typegen  # regenerate worker-configuration.d.ts from wrangler.jsonc
```

---

## License

MIT
