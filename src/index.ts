export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const rayId = request.headers.get('cf-ray') ?? 'unknown';
		const result = await fetchBootstrap(env);
		return new Response(renderHtml(result, rayId), {
			status: 200,
			headers: { 'content-type': 'text/html; charset=UTF-8' },
		});
	},
} satisfies ExportedHandler<Env>;

type BootstrapResult =
	| { ok: true; body: string; headers: Record<string, string> }
	| { ok: false; error: string };

async function fetchBootstrap(env: Env): Promise<BootstrapResult> {
	try {
		const res = await fetch(env.BOOTSTRAP_ORIGIN_URL, {
			headers: { Accept: 'application/json' },
		});

		const TRACKED_HEADERS = [
			'content-type',
			'cache-control',
			'cf-cache-status',
			'cf-ray',
			'age',
			'etag',
			'last-modified',
			'x-origin-revision',
		];

		const headers: Record<string, string> = {};
		for (const name of TRACKED_HEADERS) {
			const val = res.headers.get(name);
			if (val !== null) headers[name] = val;
		}

		const body = await res.text();
		return { ok: true, body, headers };
	} catch (err) {
		return { ok: false, error: String(err) };
	}
}

function h(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function renderHtml(result: BootstrapResult, rayId: string): string {
	const content = result.ok
		? `<h2>Headers</h2>
<pre>${h(JSON.stringify(result.headers, null, 2))}</pre>
<h2>Body</h2>
<pre>${h(result.body)}</pre>`
		: `<pre class="err">${h(result.error)}</pre>`;

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Bootstrap data</title>
<style>
  body { font: 14px/1.5 monospace; max-width: 900px; margin: 40px auto; padding: 0 20px; background: #0d0d0d; color: #e8e8e8; }
  h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .08em; color: #666; margin: 28px 0 8px; }
  pre { background: #111; border: 1px solid #222; border-radius: 4px; padding: 16px; overflow-x: auto; margin: 0; white-space: pre-wrap; word-break: break-all; }
  .err { color: #f87171; }
  .ray { font-size: 11px; color: #555; margin: 0 0 24px; }
  .ray span { color: #888; }
</style>
</head>
<body>
<p class="ray">Ray ID: <span>${h(rayId)}</span></p>
${content}
</body>
</html>`;
}
