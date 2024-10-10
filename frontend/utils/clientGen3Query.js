/**
 * Function to query Gen3 API via the local API route
 * @param {string} endpoint - The API endpoint to query (e.g., '/v0/submission/')
 * @param {string} method - The HTTP method to use (GET, POST, PUT, DELETE, PATCH)
 * @param {object} body - The request body (for POST, PUT, PATCH requests)
 * @param {object} body - The token to be used (for POST, PUT, PATCH requests)
 * @returns {Promise} - A promise that resolves with the API response
 */
async function clientGen3Query(url, endpoint, method = 'GET', body = null, token) {
    console.log("Client Gen3 query")
    try {
      const response = await fetch('/api/gen3', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({url, endpoint, method, body, token }),
      });
  
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
  
      return await response.json();
    } catch (error) {
      console.error('Error querying Gen3 API:', error);
      throw error;
    }
  }
  
  export default clientGen3Query;
  