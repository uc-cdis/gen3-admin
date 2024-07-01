
import { getCookie } from 'cookies-next';
import AuthContext from '@/contexts/auth';
import { useContext } from 'react';
/**
 * Generic function to query the Gen3 API
 * @param {string} endpoint - The API endpoint to query (e.g., '/user/user')
 * @param {string} method - The HTTP method to use (GET, POST, PUT, DELETE)
 * @param {object} body - The request body (for POST and PUT requests)
 * @returns {Promise} - A promise that resolves with the API response
 */
async function queryGen3API(url, endpoint, method = 'GET', body = null, accessToken = null) {


  if (!accessToken) {
    accessToken = getCookie('access_token')
    if (!accessToken) {
      throw new Error('No access token found. Please log in.');
    }
  }

  const headers = {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };

  const options = {
    method,
    headers,
    credentials: 'include',
  };
  console.log(options)

  if (body && (method === 'POST' || method === 'PUT')) {
    options.body = JSON.stringify(body);
  }

  try {
    const response = await fetch(`${url}${endpoint}`, options);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Error querying Gen3 API:', error);
    throw error;
  }
}

export default queryGen3API;