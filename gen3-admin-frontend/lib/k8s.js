import { getCookie } from 'cookies-next';

export default async function callK8sApi(endpoint, method = 'GET', body = null, headers = {}) {
  const accessToken = getCookie('access_token');
  const baseUrl = '/api/go/k8s/proxy';

  try {
    // Base headers with authorization
    const baseHeaders = {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    };

    // Merge headers, giving priority to the input `headers`
    const mergedHeaders = {
      ...baseHeaders,
      ...headers, 
    };

    const response = await fetch(`${baseUrl}${endpoint}`, {
      method,
      headers: mergedHeaders,
      body: body ? JSON.stringify(body) : null,
    });

    if (!response.ok) {
      throw new Error(`API call failed: ${response.status} ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error(`Failed to call K8s API (${endpoint}):`, error);
    throw error;
  }
}
