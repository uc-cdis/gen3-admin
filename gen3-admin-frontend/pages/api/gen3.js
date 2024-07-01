// File: pages/api/gen3-query.js

import queryGen3API from '@/lib/gen3'; // Adjust the import path as needed

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  const { endpoint, method, body, url, token } = req.body;
  if (!endpoint || !method) {
    return res.status(400).json({ message: 'Missing required parameters' });
  }
  try {
    const result = await queryGen3API(url, endpoint, method, body, token);
    res.status(200).json(result);
  } catch (error) {
    console.error('Error querying Gen3 API:', error);
    res.status(500).json({ message: 'Error querying Gen3 API', error: error.message });
  }
}