import { ApiError, extractErrorMessage } from './apiError';

type ResponseType = 'json' | 'text';

type HeadersMap = Record<string, string> | null;
type BodyType = Record<string, unknown> | unknown[] | null | undefined;

export type CallOptions = {
  /**
   * Return `null` instead of throwing on 404. Use only where absence is a valid,
   * expected answer (probing whether a resource exists). Everywhere else a 404
   * should surface as an error so it is not mistaken for an empty result.
   */
  nullOn404?: boolean;
  signal?: AbortSignal;
};

async function parseBody(response: Response, responseType: ResponseType): Promise<any> {
  const text = await response.text();
  if (!text) return responseType === 'text' ? '' : null;
  if (responseType === 'text') return text;
  try {
    return JSON.parse(text);
  } catch {
    // Some proxy error paths return plain text even for JSON endpoints.
    return text;
  }
}

async function request(
  url: string,
  endpoint: string,
  method: string,
  body: BodyType,
  headers: HeadersMap,
  accessToken: string | null | undefined,
  responseType: ResponseType,
  options: CallOptions
): Promise<any> {
  const provided = headers || {};
  const hasContentType = Object.keys(provided).some(
    (k) => k.toLowerCase() === 'content-type'
  );

  const merged: Record<string, string> = {
    ...(hasContentType ? {} : { 'Content-Type': 'application/json' }),
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    ...provided,
  };

  const response = await fetch(url, {
    method,
    headers: merged,
    body: body ? JSON.stringify(body) : undefined,
    signal: options.signal,
  });

  if (!response.ok) {
    if (response.status === 404 && options.nullOn404) return null;

    const errorBody = await parseBody(response, 'json').catch(() => null);
    throw new ApiError({
      message: extractErrorMessage(
        errorBody,
        `${method} ${endpoint} failed: ${response.status} ${response.statusText}`
      ),
      status: response.status,
      statusText: response.statusText,
      endpoint,
      body: errorBody,
    });
  }

  return parseBody(response, responseType);
}

/**
 * Call the Kubernetes API through the Go proxy.
 *
 * Positional signature is kept for the ~58 existing call sites; new code should
 * prefer the hooks in `hooks/useK8s.ts`, which handle caching, deduplication and
 * token plumbing.
 */
export default async function callK8sApi(
  endpoint: string,
  method: string = 'GET',
  body?: BodyType,
  headers?: HeadersMap,
  cluster?: string | null,
  accessToken?: string | null,
  responseType: ResponseType = 'json',
  options: CallOptions = {}
): Promise<any> {
  const baseUrl = cluster ? `/api/k8s/${cluster}/proxy` : '/api/k8s/proxy';
  return request(
    `${baseUrl}${endpoint}`,
    endpoint,
    method,
    body,
    headers ?? null,
    accessToken,
    responseType,
    options
  );
}

/** Call the Go API directly (non-Kubernetes endpoints). */
export async function callGoApi(
  endpoint: string,
  method: string = 'GET',
  body?: BodyType,
  headers?: HeadersMap,
  accessToken?: string | null,
  responseType: ResponseType = 'json',
  options: CallOptions = {}
): Promise<any> {
  return request(
    `/api${endpoint}`,
    endpoint,
    method,
    body,
    headers ?? null,
    accessToken,
    responseType,
    options
  );
}

export { ApiError };
