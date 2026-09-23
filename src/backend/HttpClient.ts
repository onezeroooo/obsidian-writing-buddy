export interface HttpRequest {
	url: string;
	method?: string;
	headers?: Record<string, string>;
	body?: string;
	signal?: AbortSignal;
}

export interface HttpResponse {
	status: number;
	headers: Headers;
	text: string;
	json: unknown;
	ok: boolean;
}

export type HttpClient = (request: HttpRequest) => Promise<HttpResponse>;

export function fetchHttpClient(fetchImpl: typeof fetch = window.fetch.bind(window)): HttpClient {
	return async (request) => {
		const response = await fetchImpl(request.url, {
			method: request.method,
			headers: request.headers,
			body: request.body,
			signal: request.signal,
		});
		const text = await response.text();
		return { status: response.status, headers: response.headers, text, json: parseJsonBody(text), ok: response.ok };
	};
}

/** The body as JSON, or null when it is empty or not JSON; the caller still has the text and status. */
export function parseJsonBody(text: string): unknown {
	if (!text) return null;
	try { return JSON.parse(text); } catch { return null; }
}
