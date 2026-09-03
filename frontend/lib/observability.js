/**
 * Client for the centralized observability stack.
 *
 * Every query is scoped to the selected environment. The label conventions line
 * up across backends, which is what makes a single environment selector work:
 *
 *   Loki / Mimir : cluster="<cluster>", namespace="<namespace>"
 *   Tempo        : resource.service.name (scoped attribute -- unscoped names are
 *                  rejected by the API)
 *   Pyroscope    : service_name, formatted "<namespace>/<app>"
 */

const proxy = (backend, path, params = {}) => {
  const search = new URLSearchParams({ path, ...params });
  return `/api/observability/${backend}?${search.toString()}`;
};

const asJson = async (res) => {
  const text = await res.text();
  if (!res.ok) {
    // Loki and Mimir both return a JSON error body; fall back to raw text.
    try {
      const parsed = JSON.parse(text);
      throw new Error(parsed.error || parsed.message || text.slice(0, 300));
    } catch (e) {
      if (e instanceof SyntaxError) throw new Error(text.slice(0, 300) || res.statusText);
      throw e;
    }
  }
  return text ? JSON.parse(text) : null;
};

/** Which backends are actually reachable. */
export async function fetchCapabilities() {
  const res = await fetch('/api/observability/capabilities');
  const data = await asJson(res);
  return data.capabilities || {};
}

// ── Loki ────────────────────────────────────────────────────────────────────

const nanos = (date) => `${Math.floor(date.getTime())}000000`;

/**
 * Build a LogQL stream selector for an environment.
 *
 * Without this scoping a query spans every cluster in the centralized Loki --
 * 29 of them -- which is unusable.
 */
export function buildLogSelector({ cluster, namespace, app, extra }) {
  const parts = [];
  if (cluster) parts.push(`cluster="${cluster}"`);
  if (namespace) parts.push(`namespace="${namespace}"`);
  if (app) parts.push(`app="${app}"`);
  const selector = `{${parts.join(', ')}}`;
  return extra ? `${selector} ${extra}` : selector;
}

export async function queryLogs({ query, start, end, limit = 200, direction = 'backward' }) {
  const res = await fetch(
    proxy('loki', '/loki/api/v1/query_range', {
      query,
      start: nanos(start),
      end: nanos(end),
      limit: String(limit),
      direction,
    })
  );
  return asJson(res);
}

/** Values for a label, optionally constrained to a stream selector. */
export async function fetchLogLabelValues(label, { start, end, selector } = {}) {
  const params = {};
  if (start) params.start = nanos(start);
  if (end) params.end = nanos(end);
  if (selector) params.query = selector;
  const res = await fetch(proxy('loki', `/loki/api/v1/label/${label}/values`, params));
  const data = await asJson(res);
  return data?.data || [];
}

// ── Mimir (Prometheus API) ──────────────────────────────────────────────────

export async function queryMetric(query, at) {
  const params = { query };
  if (at) params.time = String(Math.floor(at.getTime() / 1000));
  const res = await fetch(proxy('mimir', '/prometheus/api/v1/query', params));
  return asJson(res);
}

export async function queryMetricRange(query, { start, end, step }) {
  const res = await fetch(
    proxy('mimir', '/prometheus/api/v1/query_range', {
      query,
      start: String(Math.floor(start.getTime() / 1000)),
      end: String(Math.floor(end.getTime() / 1000)),
      step: String(step),
    })
  );
  return asJson(res);
}

/** Scalar value from an instant query, or null when the series is absent. */
export function scalarFrom(response) {
  const result = response?.data?.result;
  if (!Array.isArray(result) || result.length === 0) return null;
  const value = result[0]?.value?.[1];
  return value === undefined ? null : Number(value);
}

// ── Tempo ───────────────────────────────────────────────────────────────────

export async function searchTraces({ service, start, end, limit = 20, minDuration, status }) {
  // TraceQL rather than the tag-based API: it expresses duration and status
  // filters that the simple search endpoint cannot.
  const filters = [];
  if (service) filters.push(`resource.service.name="${service}"`);
  if (status === 'error') filters.push(`status=error`);
  let q = filters.length ? `{${filters.join(' && ')}}` : '{}';
  if (minDuration) q += ` | select(duration) > ${minDuration}`;

  // Tempo returns an empty result set rather than an error when the time range
  // is missing, so always send one -- default to the last hour.
  const to = end || new Date();
  const from = start || new Date(to.getTime() - 3600 * 1000);
  const params = {
    q,
    limit: String(limit),
    start: String(Math.floor(from.getTime() / 1000)),
    end: String(Math.floor(to.getTime() / 1000)),
  };

  const res = await fetch(proxy('tempo', '/api/search', params));
  return asJson(res);
}

export async function fetchTraceServices() {
  // Tempo requires the scoped attribute name; "service.name" is rejected.
  const res = await fetch(proxy('tempo', '/api/v2/search/tag/resource.service.name/values'));
  const data = await asJson(res);
  return (data?.tagValues || []).map((v) => v.value);
}

export async function fetchTrace(traceId) {
  const res = await fetch(proxy('tempo', `/api/traces/${traceId}`));
  return asJson(res);
}

// ── Pyroscope (Connect-RPC) ─────────────────────────────────────────────────

const pyroscopeRpc = async (method, body) => {
  const res = await fetch(proxy('pyroscope', `/querier.v1.QuerierService/${method}`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return asJson(res);
};

export async function fetchProfileTypes({ start, end }) {
  const data = await pyroscopeRpc('ProfileTypes', {
    start: start.getTime(),
    end: end.getTime(),
  });
  return data?.profileTypes || [];
}

export async function fetchProfileServices({ start, end }) {
  const data = await pyroscopeRpc('LabelValues', {
    name: 'service_name',
    start: start.getTime(),
    end: end.getTime(),
  });
  return data?.names || [];
}

export async function fetchFlamegraph({ profileType, service, start, end }) {
  return pyroscopeRpc('SelectMergeStacktraces', {
    profileTypeID: profileType,
    labelSelector: `{service_name="${service}"}`,
    start: start.getTime(),
    end: end.getTime(),
  });
}
