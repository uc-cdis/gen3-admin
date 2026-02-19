import callK8sApi from '@/lib/k8s';

type SyncOverrides = {
  prune?: boolean;
  dryRun?: boolean;
  force?: boolean;
  syncOptions?: string[]; // fully custom options if you want to override everything
};

type SyncArgoCDParams = {
  cluster: string;
  appName: string;
  namespace?: string;     // default: argocd
  accessToken: string;
  overrides?: SyncOverrides;
};

/**
 * Safely triggers an ArgoCD sync:
 * - reuses the app's existing syncOptions
 * - merges in defaults
 * - allows overrides without clobbering config
 */
export async function syncArgoCD({
  cluster,
  appName,
  namespace = 'argocd',
  accessToken,
  overrides,
}: SyncArgoCDParams) {
  const endpoint = `/apis/argoproj.io/v1alpha1/namespaces/${namespace}/applications/${appName}`;

  try {
    // 1️⃣ Fetch current app to reuse existing sync options
    const app = await callK8sApi(
      endpoint,
      'GET',
      null,
      null,
      cluster,
      accessToken
    );

    const existingOptions: string[] =
      app?.spec?.syncPolicy?.syncOptions || [];

    // 2️⃣ Start from existing options + safe defaults
    const mergedOptions = new Set<string>([
      ...existingOptions,
      'RespectIgnoreDifferences=true',
      'CreateNamespace=true',
    ]);

    // 3️⃣ Apply overrides
    if (overrides?.prune) mergedOptions.add('Prune=true');
    if (overrides?.dryRun) mergedOptions.add('DryRun=true');
    if (overrides?.force) mergedOptions.add('Force=true');

    // 4️⃣ Hard override (if explicitly provided)
    const finalOptions = overrides?.syncOptions?.length
      ? overrides.syncOptions
      : Array.from(mergedOptions);

    // 5️⃣ Trigger sync
    const payload = {
      operation: {
        sync: {
          syncOptions: finalOptions,
        },
      },
    };

    return await callK8sApi(
      endpoint,
      'PATCH',
      payload,
      { 'Content-Type': 'application/merge-patch+json' },
      cluster,
      accessToken
    );
  } catch (err) {
    console.error('[ArgoCD] sync failed:', err);
    throw err;
  }
}


type ArgoAppStatus = {
  sync: {
    status: 'Synced' | 'OutOfSync' | 'Unknown';
  };
  health: {
    status: 'Healthy' | 'Progressing' | 'Degraded' | 'Missing' | 'Unknown';
  };
  operationState?: {
    phase?: 'Running' | 'Succeeded' | 'Failed' | 'Error';
    message?: string;
    startedAt?: string;
    finishedAt?: string;
  };
};

export async function getArgoAppStatus({
  cluster,
  appName,
  namespace = 'argocd',
  accessToken,
}: {
  cluster: string;
  appName: string;
  namespace?: string;
  accessToken: string;
}): Promise<ArgoAppStatus> {
  const endpoint = `/apis/argoproj.io/v1alpha1/namespaces/${namespace}/applications/${appName}`;

  const app = await callK8sApi(endpoint, 'GET', null, null, cluster, accessToken);

  return {
    sync: {
      status: app?.status?.sync?.status || 'Unknown',
    },
    health: {
      status: app?.status?.health?.status || 'Unknown',
    },
    operationState: app?.status?.operationState,
  };
}

export async function waitForArgoSync({
  cluster,
  appName,
  namespace = 'argocd',
  accessToken,
  intervalMs = 4000,
  timeoutMs = 120_000, // 2 minutes
  onUpdate,
}: {
  cluster: string;
  appName: string;
  namespace?: string;
  accessToken: string;
  intervalMs?: number;
  timeoutMs?: number;
  onUpdate?: (status: ArgoAppStatus) => void;
}) {
  const start = Date.now();

  while (true) {
    const status = await getArgoAppStatus({
      cluster,
      appName,
      namespace,
      accessToken,
    });

    onUpdate?.(status);

    const phase = status.operationState?.phase;

    if (phase === 'Succeeded') return status;
    if (phase === 'Failed' || phase === 'Error') {
      throw new Error(status.operationState?.message || 'ArgoCD sync failed');
    }

    if (Date.now() - start > timeoutMs) {
      throw new Error('Timed out waiting for ArgoCD sync');
    }

    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
