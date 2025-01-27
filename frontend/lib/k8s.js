


export default async function callK8sApi(endpoint, method = 'GET', body = null, headers = {}, cluster = null, accessToken = null, responseType = 'json') {
  // console.log('calling k8s api', endpoint)
  
  let baseUrl = '/api/k8s/proxy';

  if (cluster) {
    baseUrl = `/api/k8s/${cluster}/proxy`;
  }

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

    if (responseType === 'json') {
      return await response.json();
    } else if (responseType === 'text') {
      return await response.text();
    }
  } catch (error) {
    console.error(`Failed to call K8s API (${endpoint}):`, error);
    throw error;
  }
}


export async function callGoApi(endpoint, method = 'GET', body = null, headers = {}, accessToken = null, responseType = 'json') {
  // console.log('calling go api', endpoint)
  const baseUrl = '/api';

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


    if (responseType === 'json') {
      return await response.json();
    } else if (responseType === 'text') {
      return await response.text();
    }
    return await response.json();
  } catch (error) {
    console.error(`Failed to call Go API (${endpoint}):`, error);
    throw error;
  }
}