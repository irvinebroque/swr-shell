# swr-shell

https://swr-shell-demo.roundtrip.workers.dev/

A minimal demo of **stale-while-revalidate (SWR) caching** using [Cloudflare Workers](https://developers.cloudflare.com/workers/). Shows how to ensure that reads are **always** hot. You should use this pattern for data that is on the critical path, where it is preferrable to serve stale data than to end up with a cold read.

The shell-and-inject pattern used here applies to any SSR framework running on Workers: stream the HTML shell immediately, fetch bootstrap data in parallel, and inject it into the response via [`HTMLRewriter`](https://developers.cloudflare.com/workers/runtime-apis/html-rewriter/) — without blocking time-to-first-byte.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/irvinebroque/swr-shell)

---

## How it works

```
Browser → Worker (swr-shell-demo) -- fetch() subrequest → Cloudflare Tiered Cache → Origin
```

1. A browser requests `swr-shell-demo.your-subdomain.workers.dev/`.
2. The Worker **immediately starts streaming an HTML shell** to the browser — no waiting for data. At the same time, it kicks off a subrequest to a **bootstrap data URL**: this can be any origin server that is "Orange Clouded", sitting behind Cloudflare and Cloudflare's Tiered Cache.
3. This `fetch()` subrequest goes **through** Cloudflare's Tiered Cache. The origin server responds with `Cache-Control` headers of its choosing, ex: `Cache-Control: public, max-age=30, stale-while-revalidate=2592000`
4. Cloudflare respects the `stale-while-revalidate` directive — meaning that even if the `fetch()` subrequest from the Worker makes a request later, and the cached data is stale, the `fetch()` subrequest will **return stale data immediately** — and Cloudflare will asynchronously update the cache, so that subsequent requests receive a fresh response.

See: [Cache-Control directives](https://developers.cloudflare.com/cache/concepts/cache-control/) · [Revalidation and stale-while-revalidate](https://developers.cloudflare.com/cache/concepts/revalidation/) · [Async stale-while-revalidate](https://developers.cloudflare.com/changelog/post/2026-02-26-async-stale-while-revalidate/)

## Deploying to your own Cloudflare account

---

### Step 1 — Clone the repo

```sh
git clone https://github.com/irvinebroque/swr-shell.git
cd swr-shell
pnpm install
```

---

### Step 2 — Create the R2 bucket

**Note:** If you already have an origin server that can serve the data you need, with the proper `Cache-Control` headers, skip to Step 7.

```sh
npx wrangler r2 bucket create bootstrap-data --jurisdiction eu
```

You can use any jurisdiction — I've chosen EU here to demonstrate the performance impact, when data is stored far away from the eyeball. =

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
public, max-age=30, stale-while-revalidate=2592000
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

This starts the Worker locally via Vite + [`@cloudflare/vite-plugin`](https://developers.cloudflare.com/workers/vite-plugin/). Note that local dev bypasses the Cloudflare CDN, so `cf-cache-status` will not appear — you'll see raw origin latency on every request.

---

## Re-uploading bootstrap data

If you change `data/bootstrap.json`, re-upload it:

```sh
pnpm run upload:bootstrap-data
```

---

## License

MIT
