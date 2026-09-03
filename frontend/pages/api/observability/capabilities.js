/**
 * Reports which observability backends are reachable.
 *
 * The stack is not uniform across deployments -- Pyroscope in particular is only
 * present in some clusters -- so the UI asks first and hides tabs for anything
 * missing, rather than showing a tab that errors when opened.
 */

const env = (name, fallback) => process.env[name] || fallback;

// Each probe is the cheapest call that proves the backend is actually serving,
// not merely that something is listening on the port.
const PROBES = {
  loki: {
    url: () => `${env('LOKI_BASE_URL', 'https://loki3.planx-pla.net')}/loki/api/v1/labels`,
  },
  mimir: {
    url: () =>
      `${env('MIMIR_BASE_URL', 'https://mimir.planx-pla.net')}/prometheus/api/v1/query?query=1`,
    headers: () => ({ 'X-Scope-OrgID': env('MIMIR_TENANT', 'anonymous') }),
  },
  tempo: {
    url: () =>
      `${env('TEMPO_BASE_URL', 'https://tempo.planx-pla.net')}/api/echo`,
  },
  pyroscope: {
    url: () => `${env('PYROSCOPE_BASE_URL', 'https://pyroscope.planx-pla.net')}/ready`,
  },
};

const probe = async (name, cfg) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const res = await fetch(cfg.url(), {
      headers: cfg.headers ? cfg.headers() : undefined,
      signal: controller.signal,
    });
    return { name, available: res.ok, status: res.status };
  } catch (error) {
    return { name, available: false, error: error.name === 'AbortError' ? 'timeout' : error.message };
  } finally {
    clearTimeout(timer);
  }
};

export default async function handler(req, res) {
  const results = await Promise.all(
    Object.entries(PROBES).map(([name, cfg]) => probe(name, cfg))
  );

  const capabilities = {};
  for (const r of results) {
    capabilities[r.name] = r;
  }
  res.status(200).json({ capabilities });
}
