import { useEffect, useMemo, useState } from 'react';

import {
  Accordion,
  Alert,
  Badge,
  Button,
  Checkbox,
  Divider,
  Group,
  Modal,
  NumberInput,
  ScrollArea,
  Stack,
  Switch,
  Text,
  TextInput,
} from '@mantine/core';
import { IconAlertTriangle, IconEye, IconRefresh } from '@tabler/icons-react';

import { ErrorState, StatusBadge } from '@/components/ui';

/**
 * Sync dialog.
 *
 * Two design points worth stating:
 *
 *  1. The dry run renders a real diff *before* anything is applied. That is what
 *     makes a sync button on production infrastructure trustworthy, and it is
 *     only possible because the backend now uses the ArgoCD API (a CRD
 *     `.operation` patch cannot express dryRun).
 *  2. Options are persisted per application. They are tedious to re-enter, and
 *     the ones you want for a given app rarely change between syncs.
 */

const STORAGE_PREFIX = 'gen3.argocd.syncOptions.';

const DEFAULT_FLAGS = {
  prune: false,
  force: false,
  replace: false,
  applyOutOfSyncOnly: false,
  serverSideApply: false,
  respectIgnoreDifferences: true,
  createNamespace: false,
  revision: '',
  retryLimit: 0,
};

function loadFlags(appKey) {
  if (typeof window === 'undefined') return DEFAULT_FLAGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + appKey);
    if (!raw) return DEFAULT_FLAGS;
    return { ...DEFAULT_FLAGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_FLAGS;
  }
}

function saveFlags(appKey, flags) {
  if (typeof window === 'undefined') return;
  try {
    // Deliberately not persisting `revision`: reusing a pinned revision from a
    // previous sync without noticing would be surprising.
    const { revision, ...rest } = flags;
    window.localStorage.setItem(STORAGE_PREFIX + appKey, JSON.stringify(rest));
  } catch {
    /* localStorage unavailable (private mode); options just will not persist. */
  }
}

export default function SyncDialog({
  opened,
  onClose,
  app,
  appKey,
  degraded = false,
  onSync,
  onDryRun,
  dryRunResult,
  dryRunLoading,
  dryRunError,
  syncing,
}) {
  const [flags, setFlags] = useState(DEFAULT_FLAGS);
  const [selectedResources, setSelectedResources] = useState([]);
  const [scopeToSelection, setScopeToSelection] = useState(false);

  const resources = app?.status?.resources || [];
  const outOfSync = useMemo(
    () => resources.filter((r) => r.status && r.status !== 'Synced'),
    [resources]
  );

  useEffect(() => {
    if (!opened) return;
    setFlags(loadFlags(appKey));
    // Preselect only the resources that actually differ: that is almost always
    // the intent when syncing from an out-of-sync state.
    setSelectedResources(outOfSync.map(resourceRefKey));
    setScopeToSelection(false);
  }, [opened, appKey, outOfSync]);

  const update = (patch) => setFlags((current) => ({ ...current, ...patch }));

  const buildFlags = () => ({
    ...flags,
    resources: scopeToSelection
      ? resources.filter((r) => selectedResources.includes(resourceRefKey(r))).map(toSyncRef)
      : undefined,
  });

  const submit = () => {
    saveFlags(appKey, flags);
    onSync?.(buildFlags());
  };

  const preview = () => onDryRun?.({ ...buildFlags(), dryRun: true });

  const destructive = flags.prune || flags.replace || flags.force;

  return (
    <Modal opened={opened} onClose={onClose} title={`Sync ${app?.metadata?.name ?? ''}`} size="xl">
      <Stack gap="md">
        {degraded && (
          <Alert variant="light" color="statusWarn" icon={<IconAlertTriangle size={18} />} title="Limited sync">
            The ArgoCD API is unreachable, so this will fall back to patching the Application
            resource directly. Options are approximate, progress cannot be tracked reliably, and
            the request may be ignored if a sync is already running.
          </Alert>
        )}

        {destructive && (
          <Alert variant="light" color="statusError" icon={<IconAlertTriangle size={18} />} title="Destructive options enabled">
            <Stack gap={2}>
              {flags.prune && <Text size="sm">Prune deletes live resources no longer defined in Git.</Text>}
              {flags.replace && <Text size="sm">Replace recreates resources rather than patching them, causing downtime.</Text>}
              {flags.force && <Text size="sm">Force deletes and recreates resources that cannot be patched.</Text>}
            </Stack>
          </Alert>
        )}

        <Group gap="xl" align="flex-start" wrap="wrap">
          <Stack gap="xs">
            <Text size="sm" fw={600}>Common</Text>
            <Switch
              label="Prune"
              description="Delete resources removed from Git"
              checked={flags.prune}
              onChange={(e) => update({ prune: e.currentTarget.checked })}
            />
            <Switch
              label="Apply out-of-sync only"
              description="Skip resources already in sync"
              checked={flags.applyOutOfSyncOnly}
              onChange={(e) => update({ applyOutOfSyncOnly: e.currentTarget.checked })}
            />
            <Switch
              label="Respect ignore differences"
              description="Honour ignoreDifferences from the app spec"
              checked={flags.respectIgnoreDifferences}
              onChange={(e) => update({ respectIgnoreDifferences: e.currentTarget.checked })}
            />
          </Stack>

          <Stack gap="xs">
            <Text size="sm" fw={600}>Advanced</Text>
            <Switch
              label="Force"
              description="Delete and recreate when a patch fails"
              checked={flags.force}
              onChange={(e) => update({ force: e.currentTarget.checked })}
            />
            <Switch
              label="Replace"
              description="Use replace instead of apply"
              checked={flags.replace}
              onChange={(e) => update({ replace: e.currentTarget.checked })}
            />
            <Switch
              label="Server-side apply"
              checked={flags.serverSideApply}
              onChange={(e) => update({ serverSideApply: e.currentTarget.checked })}
            />
            <Switch
              label="Create namespace"
              checked={flags.createNamespace}
              onChange={(e) => update({ createNamespace: e.currentTarget.checked })}
            />
          </Stack>
        </Group>

        <Divider />

        <Group grow align="flex-start">
          <TextInput
            label="Revision"
            description={`Leave blank to use the app's target revision${
              app?.spec ? ` (${primaryRevision(app.spec) || 'HEAD'})` : ''
            }`}
            placeholder="branch, tag, commit SHA or chart version"
            value={flags.revision}
            onChange={(e) => update({ revision: e.currentTarget.value })}
          />
          <NumberInput
            label="Retry limit"
            description="0 disables retries"
            min={0}
            max={10}
            value={flags.retryLimit}
            onChange={(value) => update({ retryLimit: Number(value) || 0 })}
          />
        </Group>

        {resources.length > 0 && (
          <Accordion variant="contained">
            <Accordion.Item value="resources">
              <Accordion.Control>
                <Group gap="xs">
                  <Text size="sm">Resource selection</Text>
                  <Badge size="xs" variant="light">
                    {scopeToSelection ? `${selectedResources.length} selected` : 'all resources'}
                  </Badge>
                </Group>
              </Accordion.Control>
              <Accordion.Panel>
                <Stack gap="xs">
                  <Switch
                    label="Sync only the selected resources"
                    checked={scopeToSelection}
                    onChange={(e) => setScopeToSelection(e.currentTarget.checked)}
                  />
                  <ScrollArea.Autosize mah={220}>
                    <Stack gap={4}>
                      {resources.map((resource) => {
                        const key = resourceRefKey(resource);
                        return (
                          <Group key={key} gap="xs" wrap="nowrap">
                            <Checkbox
                              disabled={!scopeToSelection}
                              checked={selectedResources.includes(key)}
                              onChange={(event) =>
                                setSelectedResources((current) =>
                                  event.currentTarget.checked
                                    ? [...current, key]
                                    : current.filter((k) => k !== key)
                                )
                              }
                              label={
                                <Group gap={6} wrap="nowrap">
                                  <Text size="xs" c="dimmed">{resource.kind}</Text>
                                  <Text size="sm">{resource.name}</Text>
                                </Group>
                              }
                            />
                            <StatusBadge domain="argoSync" value={resource.status} size="xs" />
                          </Group>
                        );
                      })}
                    </Stack>
                  </ScrollArea.Autosize>
                </Stack>
              </Accordion.Panel>
            </Accordion.Item>
          </Accordion>
        )}

        {dryRunError && <ErrorState error={dryRunError} title="Dry run failed" onRetry={preview} />}

        {dryRunResult && !dryRunError && (
          <Alert variant="light" color="statusInfo" title="Dry run complete">
            <Stack gap={4}>
              <Group gap="xs">
                <Text size="sm">Result:</Text>
                <StatusBadge domain="argoOp" value={dryRunResult?.status?.operationState?.phase} size="sm" />
              </Group>
              {dryRunResult?.status?.operationState?.message && (
                <Text size="xs" c="dimmed">{dryRunResult.status.operationState.message}</Text>
              )}
              <Text size="xs" c="dimmed">
                Nothing was applied. Review the Diff tab, then sync for real.
              </Text>
            </Stack>
          </Alert>
        )}

        <Group justify="space-between">
          <Button
            variant="default"
            leftSection={<IconEye size={16} />}
            onClick={preview}
            loading={dryRunLoading}
            disabled={degraded}
          >
            Dry run
          </Button>
          <Group gap="xs">
            <Button variant="subtle" onClick={onClose}>Cancel</Button>
            <Button
              leftSection={<IconRefresh size={16} />}
              color={destructive ? 'statusError' : undefined}
              onClick={submit}
              loading={syncing}
            >
              {destructive ? 'Sync with destructive options' : 'Synchronize'}
            </Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}

function resourceRefKey(resource) {
  return `${resource.group || ''}/${resource.kind}/${resource.namespace || ''}/${resource.name}`;
}

function toSyncRef(resource) {
  return {
    group: resource.group || '',
    kind: resource.kind,
    name: resource.name,
    namespace: resource.namespace || '',
  };
}

/** Target revision of the primary source, handling multi-source specs. */
function primaryRevision(spec) {
  if (spec?.source?.targetRevision) return spec.source.targetRevision;
  return spec?.sources?.[0]?.targetRevision;
}
