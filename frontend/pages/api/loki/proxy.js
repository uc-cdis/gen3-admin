// pages/api/loki/proxy.js

import { NextResponse } from 'next/server';

export const config = {
  runtime: 'edge',
};

const LOKI_BASE_URL = 'https://loki.planx-pla.net';
// const LOKI_BASE_URL = 'http://monitoring-loki-gateway.monitoring';
// const LOKI_BASE_URL = 'http://localhost:8085'

export default async function handler(req) {
  try {
    // Extract the path and query parameters from the request
    const { searchParams } = new URL(req.url);
    const path = searchParams.get('path') || '';

    // Remove the path parameter from the search params
    searchParams.delete('path');

    // Construct the URL for the Loki API
    const lokiUrl = new URL(`${LOKI_BASE_URL}${path}`);

    // Copy all other query parameters to the Loki URL
    searchParams.forEach((value, key) => {
      lokiUrl.searchParams.append(key, value);
    });

    // Get the request method
    const method = req.method;

    // Prepare headers for the Loki request
    const headers = new Headers();
    for (const [key, value] of req.headers) {
      // Skip headers that are not needed or might cause issues
      if (!['host', 'connection', 'content-length'].includes(key.toLowerCase())) {
        headers.append(key, value);
      }
    }

    // Create options for the fetch request
    const options = {
      method,
      headers,
    };

    // Include the body for POST, PUT, PATCH requests
    if (['POST', 'PUT', 'PATCH'].includes(method)) {
      const contentType = req.headers.get('content-type');
      if (contentType) {
        options.headers.set('Content-Type', contentType);
      }
      options.body = await req.text();
    }

    // Make the request to the Loki API
    const response = await fetch(lokiUrl.toString(), options);

    // Get the response data
    const responseData = await response.text();

    // Create a new response with the Loki API response
    const newResponse = new NextResponse(responseData, {
      status: response.status,
      statusText: response.statusText,
      headers: {
        'Content-Type': response.headers.get('Content-Type') || 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });

    return newResponse;
  } catch (error) {
    console.error('Error proxying request to Loki:', error);

    return new NextResponse(
      JSON.stringify({ error: 'Failed to proxy request to Loki API' }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  }
}
