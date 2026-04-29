export const config = {
  api: {
    bodyParser: false,
  },
};

const DEFAULT_LOKI_BASE_URL = 'http://monitoring-loki-gateway.monitoring';

const getLokiBaseUrl = () => (
  process.env.LOKI_BASE_URL ||
  process.env.NEXT_PUBLIC_LOKI_BASE_URL ||
  DEFAULT_LOKI_BASE_URL
).replace(/\/+$/, '');

const readBody = async (req) => {
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }

  return Buffer.concat(chunks);
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  try {
    const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const { searchParams } = requestUrl;
    const path = searchParams.get('path') || '';

    if (!path.startsWith('/loki/api/')) {
      res.status(400).json({ error: 'path must target /loki/api/*' });
      return;
    }

    searchParams.delete('path');

    const lokiUrl = new URL(`${getLokiBaseUrl()}${path}`);

    searchParams.forEach((value, key) => {
      lokiUrl.searchParams.append(key, value);
    });

    const headers = {};
    Object.entries(req.headers).forEach(([key, value]) => {
      if (!['host', 'connection', 'content-length'].includes(key.toLowerCase()) && value !== undefined) {
        headers[key] = Array.isArray(value) ? value.join(',') : value;
      }
    });

    const options = {
      method: req.method,
      headers,
    };

    if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
      options.body = await readBody(req);
    }

    const response = await fetch(lokiUrl.toString(), options);
    const responseData = Buffer.from(await response.arrayBuffer());

    res.status(response.status);
    res.setHeader('Content-Type', response.headers.get('Content-Type') || 'application/json');
    res.send(responseData);
  } catch (error) {
    console.error('Error proxying request to Loki:', error);

    res.status(500).json({ error: 'Failed to proxy request to Loki API' });
  }
}
