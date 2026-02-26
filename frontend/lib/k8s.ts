type ResponseType = "json" | "text";

type HeadersMap = Record<string, string> | null;
type BodyType = Record<string, unknown> | null | undefined;

export default async function callK8sApi(
  endpoint: string,
  method: string = "GET",
  body?: BodyType,
  headers?: HeadersMap,
  cluster?: string | null,
  accessToken?: string | null,
  responseType: ResponseType = "json"
): Promise<any> {
  let baseUrl = "/api/k8s/proxy";

  if (cluster) {
    baseUrl = `/api/k8s/${cluster}/proxy`;
  }

  try {
    let baseHeaders: HeadersMap = {};
    if (accessToken) {
      baseHeaders = {
        Authorization: `Bearer ${accessToken}`,
      };
    }

    const safeHeaders = headers || {};

    const mergedHeaders: HeadersMap = {
      ...(safeHeaders["Content-Type"] || safeHeaders["content-type"]
        ? {}
        : { "Content-Type": "application/json" }),
      ...baseHeaders,
      ...safeHeaders,
    };

    const response = await fetch(`${baseUrl}${endpoint}`, {
      method,
      headers: mergedHeaders,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      throw new Error(`API call failed: ${response.status} ${response.statusText}`);
    }

    if (responseType === "text") {
      return await response.text();
    }

    return await response.json();
  } catch (error) {
    console.error(`Failed to call K8s API (${endpoint}):`, error);
    throw error;
  }
}

export async function callGoApi(
  endpoint: string,
  method: string = "GET",
  body?: BodyType,
  headers?: HeadersMap,
  accessToken?: string | null,
  responseType: ResponseType = "json"
): Promise<any> {
  const baseUrl = "/api";

  try {
    const baseHeaders: HeadersMap = {
      "Content-Type": "application/json",
    };

    if (accessToken) {
      baseHeaders["Authorization"] = `Bearer ${accessToken}`;
    }

    const mergedHeaders: HeadersMap = {
      ...baseHeaders,
      ...(headers || {}),
    };

    const response = await fetch(`${baseUrl}${endpoint}`, {
      method,
      headers: mergedHeaders,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      throw new Error(`API call failed: ${response.status} ${response.statusText}`);
    }

    if (responseType === "text") {
      return await response.text();
    }

    return await response.json();
  } catch (error) {
    console.error(`Failed to call Go API (${endpoint}):`, error);
    throw error;
  }
}
