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

export function fetchHttpClient(fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis)): HttpClient {
	return async (request) => {
		const response = await fetchImpl(request.url, {
			method: request.method,
			headers: request.headers,
			body: request.body,
			signal: request.signal,
		});
		const text = await response.text();
		let json: unknown = null;
		try { json = text ? JSON.parse(text) : null; } catch { /* caller sees text */ }
		return { status: response.status, headers: response.headers, text, json, ok: response.ok };
	};
}
