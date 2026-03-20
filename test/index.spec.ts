import { afterEach, describe, expect, it, vi } from 'vitest';

import shellWorker from '../src';

const shellEnv = {
	BOOTSTRAP_ORIGIN_URL: 'https://bootstrap-data.apreswhatever.com/api/bootstrap',
} as unknown as Env;

describe('shell worker', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('renders bootstrap headers and body as HTML', async () => {
		const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
			const url =
				input instanceof Request ? input.url : input instanceof URL ? input.toString() : String(input);

			if (url === 'https://bootstrap-data.apreswhatever.com/api/bootstrap') {
				return new Response(
					JSON.stringify({
						message: 'Bootstrap data came from an R2 object, not KV.',
						revision: 'r2-seed-v1',
						requestPath: '/',
						generatedAt: '2026-03-19T00:00:00.000Z',
						originDelayMs: 0,
						cacheControl: 'public, max-age=0, s-maxage=60, stale-while-revalidate=2147483648',
					}),
					{
						headers: {
							'cache-control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=2147483648',
							'cf-cache-status': 'HIT',
							'cf-ray': 'abc123def456-LHR',
							'age': '3',
							'etag': '"bootstrap-r2-seed-v1"',
						},
					},
				);
			}

			throw new Error(`Unexpected fetch URL: ${url}`);
		});

		const incomingRayId = '999aaa111bbb-SJC';
		const response = await shellWorker.fetch(
			new Request('https://shell.example.com/', { headers: { 'cf-ray': incomingRayId } }),
			shellEnv,
		);
		const html = await response.text();

		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('text/html; charset=UTF-8');
		expect(fetchSpy).toHaveBeenCalledTimes(1);
		// Ray ID of the incoming request shown in the page
		expect(html).toContain(incomingRayId);
		// cf-ray from the upstream bootstrap fetch shown in headers section
		expect(html).toContain('abc123def456-LHR');
		expect(html).toContain('cf-cache-status');
		expect(html).toContain('HIT');
		expect(html).toContain('stale-while-revalidate=2147483648');
		expect(html).toContain('r2-seed-v1');
	});
});
