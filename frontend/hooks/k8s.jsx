import { useSession } from "next-auth/react";
import { useState, useEffect } from "react";

export function useK8sApi() {
  const { data: sessionData } = useSession();
  const [accessToken, setAccessToken] = useState(null);

  useEffect(() => {
    if (sessionData) {
      setAccessToken(sessionData.accessToken);
    }
  }, [sessionData]);

  const callK8sApi = async (endpoint, method = 'GET', body = null, headers = {}, cluster = null, accessToken = null) => {
    console.log('calling k8s api', endpoint)
    if (!accessToken) {
      throw new Error('No access token available');
    }

    let baseUrl = '/api/go/k8s/proxy';

    if (cluster) {
      baseUrl = `/api/go/k8s/proxy/${cluster}`;
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

      return await response.json();
    } catch (error) {
      console.error(`Failed to call K8s API (${endpoint}):`, error);
      throw error;
    }
  };

  return { callK8sApi };
}
