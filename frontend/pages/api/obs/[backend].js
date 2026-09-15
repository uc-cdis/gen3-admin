/**
 * Proxy for the centralized observability stack.
 *
 * Loki, Mimir, Tempo and Pyroscope all live in the CSOC cluster's `monitoring`
 * namespace. This server-side route reaches them so the browser never needs
 * direct access (which would mean VPN on every operator's machine, plus CORS).
 *
 * Defaults are the VPN-facing hostnames, which work both from a developer laptop
 * and from a deployed CSOC. When running inside the CSOC cluster, point the
 * *_BASE_URL variables at the in-cluster services instead -- e.g.
 * LOKI_BASE_URL=http://loki3-gateway.monitoring -- to skip the public hop.
 *
 * Each backend has its own quirks, encoded in BACKENDS below:
 *   - Mimir requires an X-Scope-OrgID tenant header and serves the Prometheus
 *     API under a /prometheus prefix.
 *   - Pyroscope speaks Connect-RPC (POST + JSON body), not REST.
 *   - Tempo needs scoped attribute names (resource.service.name, not service.name).
 */

export const config = {
  api: { bodyParser: false },
};

const env = (name, fallback) => process.env[name] || fallback;

const BACKENDS = {
  loki: {
    baseUrl: () => env('LOKI_BASE_URL', 'https://loki3.planx-pla.net'),
    // Guard the proxy to the read APIs; this must never become an open relay.
    allowedPrefixes: ['/loki/api/'],
  },
  mimir: {
    baseUrl: () => env('MIMIR_BASE_URL', 'https://mimir.planx-pla.net'),
    allowedPrefixes: ['/prometheus/api/'],
    headers: () => ({ 'X-Scope-OrgID': env('MIMIR_TENANT', 'anonymous') }),
  },
  tempo: {
    baseUrl: () => env('TEMPO_BASE_URL', 'https://tempo.planx-pla.net'),
    allowedPrefixes: ['/api/'],
  },
  pyroscope: {
    baseUrl: () => env('PYROSCOPE_BASE_URL', 'https://pyroscope.planx-pla.net'),
    allowedPrefixes: ['/querier.v1.', '/pyroscope/', '/ready'],
  },
};

const readBody = async (req) => {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
};

// Response content types this proxy will reflect back to the browser. Anything
// else is downgraded to text/plain (see below).
const ALLOWED_RESPONSE_TYPES = [
  'application/json',
  'application/connect+json',
  'application/connect+proto',
  'application/proto',
  'application/protobuf',
  'application/grpc-web+proto',
  'application/grpc-web+json',
  'text/plain',
];

export default async function handler(req, res) {
  const { backend } = req.query;
  const cfg = BACKENDS[backend];

  if (!cfg) {
    res.status(404).json({ error: `unknown backend: ${backend}` });
    return;
  }

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  try {
    const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const { searchParams } = requestUrl;
    const path = searchParams.get('path') || '';

    if (!cfg.allowedPrefixes.some((p) => path.startsWith(p))) {
      res.status(400).json({
        error: `path must start with one of: ${cfg.allowedPrefixes.join(', ')}`,
      });
      return;
    }
    searchParams.delete('path');

    const target = new URL(`${cfg.baseUrl().replace(/\/+$/, '')}${path}`);
    searchParams.forEach((value, key) => target.searchParams.append(key, value));

    const headers = { ...(cfg.headers ? cfg.headers() : {}) };
    // Forward content-type so Connect-RPC bodies are interpreted correctly, but
    // drop hop-by-hop headers and anything that would confuse the upstream.
    if (req.headers['content-type']) headers['content-type'] = req.headers['content-type'];

    const options = { method: req.method, headers };
    if (!['GET', 'HEAD'].includes(req.method)) {
      const body = await readBody(req);
      if (body.length > 0) options.body = body;
    }

    const upstream = await fetch(target.toString(), options);
    const text = await upstream.text();

    res.status(upstream.status);
    // Never pass the upstream Content-Type through verbatim. These backends
    // return JSON or Connect-RPC, and echoing an upstream text/html back on
    // our own origin would let a compromised or misconfigured backend land
    // script in the user's session. Anything unrecognised is served as plain
    // text, which renders inert.
    const upstreamType = (upstream.headers.get('content-type') || '').toLowerCase();
    const passThrough = ALLOWED_RESPONSE_TYPES.find((t) => upstreamType.startsWith(t));
    res.setHeader('Content-Type', passThrough ? upstreamType : 'text/plain; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(text);
  } catch (error) {
    console.error(`[observability:${backend}] proxy error`, error);
    res.status(502).json({ error: error.message || 'proxy request failed' });
  }
}
