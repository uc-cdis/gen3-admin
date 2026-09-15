/**
 * Error thrown by the API helpers for any non-OK response.
 *
 * Previously `callK8sApi` returned `null` on 404, which made "this resource does
 * not exist" indistinguishable from "the response was empty" -- and most callers
 * did not check, so an outage rendered as an empty list. Carrying the status lets
 * callers (and the shared ErrorState) tell those cases apart.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly endpoint: string;
  /** Parsed upstream error body, when the response had one. */
  readonly body?: unknown;

  constructor(opts: {
    message: string;
    status: number;
    statusText: string;
    endpoint: string;
    body?: unknown;
  }) {
    super(opts.message);
    this.name = 'ApiError';
    this.status = opts.status;
    this.statusText = opts.statusText;
    this.endpoint = opts.endpoint;
    this.body = opts.body;
  }

  get isNotFound() {
    return this.status === 404;
  }

  get isForbidden() {
    return this.status === 403;
  }

  get isUnauthorized() {
    return this.status === 401;
  }

  /** 5xx: worth retrying; 4xx generally is not. */
  get isServerError() {
    return this.status >= 500;
  }
}

/**
 * Extract the most useful message an API error body offers. Kubernetes returns
 * `{message}`, this Go API returns `{error}`, and some paths return plain text.
 */
export function extractErrorMessage(body: unknown, fallback: string): string {
  if (!body) return fallback;
  if (typeof body === 'string') return body.trim() || fallback;
  if (typeof body === 'object') {
    const record = body as Record<string, unknown>;
    for (const key of ['message', 'error', 'reason', 'detail']) {
      const value = record[key];
      if (typeof value === 'string' && value.trim()) return value;
    }
  }
  return fallback;
}
