/**
 * Parsing for the environment key held in `activeGlobalEnv`.
 *
 * The key is built by `useEnvironments` as `<agent>/<namespace>/<appName>` --
 * three segments. Consumers, however, had all grown their own
 * `activeGlobalEnv.split('/')` destructuring the first two, which silently
 * discards the app name and leaves every call site to reinvent the
 * empty-string case. This centralises the shape so the format is defined in
 * one place.
 */

export type EnvKey = {
  /** Agent (cluster) name, or '' when nothing is selected. */
  cluster: string;
  /** Kubernetes namespace the release lives in, or ''. */
  namespace: string;
  /** Helm release / ArgoCD app name, or ''. The segment older callers dropped. */
  appName: string;
};

const EMPTY: EnvKey = { cluster: '', namespace: '', appName: '' };

/**
 * Split an environment key into its parts.
 *
 * Tolerates the empty string, `undefined`, and keys with fewer than three
 * segments, because the value is restored from localStorage and may predate
 * any given key format. Missing segments come back as '' rather than
 * `undefined`, so callers can compare without guarding.
 */
export function parseEnvKey(raw: string | null | undefined): EnvKey {
  if (!raw) return EMPTY;

  const [cluster = '', namespace = '', appName = ''] = raw.split('/');
  return { cluster, namespace, appName };
}

/** True when an environment key names a cluster. */
export function hasEnvSelection(raw: string | null | undefined): boolean {
  return parseEnvKey(raw).cluster !== '';
}
