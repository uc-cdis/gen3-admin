import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import {
  Badge,
  Box,
  Button,
  Collapse,
  Divider,
  Group,
  Modal,
  Paper,
  Stack,
  Text,
} from '@mantine/core';
import { IconChevronDown, IconChevronRight, IconFileText, IconTerminal } from '@tabler/icons-react';

import callK8sApi from '@/lib/k8s';
import { resolveStatus } from '@/lib/status';
import { toPodShape, type ContainerShape, type PodShape } from '@/lib/podShape';
import LogWindow from '@/components/Logs/LogWindowAgent';

const TerminalComponent = dynamic(() => import('@/components/Shell/Terminal'), { ssr: false });

type PodEvent = {
  reason: string;
  message: string;
  type: string;
  lastTimestamp: string;
};

type PodDetailModalProps = {
  /** The raw Kubernetes pod, or null when closed. */
  pod: any | null;
  namespace: string;
  cluster: string;
  accessToken?: string;
  onClose: () => void;
};

/**
 * One pod, in place.
 *
 * The "Other pods" grid used to be a set of links out to the resource detail
 * page, which meant leaving the dashboard to answer "why is this job
 * pending" and then navigating back. These pods are mostly Jobs and one-off
 * runs -- the question is nearly always short-lived, so the answer belongs
 * over the page rather than instead of it.
 *
 * Same shape as the workload modal's pod rows, so the two read alike.
 */
export function PodDetailModal({
  pod,
  namespace,
  cluster,
  accessToken,
  onClose,
}: PodDetailModalProps) {
  const [events, setEvents] = useState<PodEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [logsFor, setLogsFor] = useState<string | null>(null);
  const [shellFor, setShellFor] = useState<string | null>(null);

  const shape: PodShape | null = pod ? toPodShape(pod) : null;
  const podName = shape?.name;

  useEffect(() => {
    if (!podName || !accessToken) {
      setEvents([]);
      return;
    }

    let cancelled = false;
    setEventsLoading(true);

    callK8sApi(
      `/api/v1/namespaces/${namespace}/events?fieldSelector=involvedObject.name=${podName}`,
      'GET',
      null,
      null,
      cluster,
      accessToken
    )
      .then((res: any) => {
        if (cancelled) return;
        const parsed = (res?.items ?? []).map((e: any) => ({
          reason: e.reason,
          message: e.message,
          type: e.type,
          lastTimestamp: e.lastTimestamp || e.eventTime || e.metadata?.creationTimestamp,
        }));
        parsed.sort(
          (a: PodEvent, b: PodEvent) =>
            new Date(b.lastTimestamp).getTime() - new Date(a.lastTimestamp).getTime()
        );
        setEvents(parsed);
      })
      // Events are supporting detail, not the point of the modal: a failure
      // here should leave the container list readable.
      .catch(() => {
        if (!cancelled) setEvents([]);
      })
      .finally(() => {
        if (!cancelled) setEventsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [podName, namespace, cluster, accessToken]);

  const status = shape
    ? resolveStatus('pod', shape.phase, {
        reason: shape.containers.find((c) => c.reason)?.reason,
        ready:
          shape.containers.filter((c) => !c.isInit).length > 0 &&
          shape.containers.filter((c) => !c.isInit).every((c) => c.ready),
      })
    : null;

  return (
    <Modal
      opened={Boolean(pod)}
      onClose={onClose}
      size="lg"
      title={
        <Group gap="sm" wrap="nowrap">
          <Text fw={600} ff="monospace" size="sm" truncate="end">
            {shape?.name}
          </Text>
          {status && (
            <Badge size="sm" variant="light" color={status.color} style={{ flexShrink: 0 }}>
              {status.label}
            </Badge>
          )}
        </Group>
      }
    >
      {shape && (
        <Stack gap="sm">
          <Stack gap={4}>
            <Text size="xs" fw={600} c="dimmed" tt="uppercase">
              Containers
            </Text>
            {shape.containers.map((c) => (
              <ContainerLine
                key={`${c.isInit ? 'init' : 'main'}-${c.name}`}
                container={c}
                onLogs={() => setLogsFor(c.name)}
                onShell={c.isInit ? undefined : () => setShellFor(c.name)}
              />
            ))}
          </Stack>

          <Divider />

          <Stack gap={4}>
            <Text size="xs" fw={600} c="dimmed" tt="uppercase">
              Recent events
            </Text>
            {events.length === 0 ? (
              <Text size="xs" c="dimmed">
                {eventsLoading ? 'Loading…' : 'No events recorded.'}
              </Text>
            ) : (
              events.slice(0, 10).map((e, i) => (
                <Group key={`${e.reason}-${i}`} gap="xs" wrap="nowrap" align="flex-start">
                  <Badge
                    size="xs"
                    variant="light"
                    color={e.type === 'Warning' ? 'statusWarn' : 'statusNeutral'}
                    style={{ flexShrink: 0 }}
                  >
                    {e.reason}
                  </Badge>
                  <Text size="xs" c="dimmed" lineClamp={2} style={{ flex: 1, minWidth: 0 }}>
                    {e.message}
                  </Text>
                </Group>
              ))
            )}
          </Stack>
        </Stack>
      )}

      <Modal
        opened={Boolean(logsFor)}
        onClose={() => setLogsFor(null)}
        size="90vw"
        title={
          <Group gap="xs">
            <IconFileText size={16} />
            <Text fw={600}>
              Logs — {shape?.name} / {logsFor}
            </Text>
          </Group>
        }
      >
        {shape && logsFor && (
          <Box h="70vh">
            <LogWindow
              namespace={namespace}
              pod={shape.name}
              cluster={cluster}
              containers={[logsFor]}
            />
          </Box>
        )}
      </Modal>

      <Modal
        opened={Boolean(shellFor)}
        onClose={() => setShellFor(null)}
        size="90vw"
        title={
          <Group gap="xs">
            <IconTerminal size={16} />
            <Text fw={600}>
              Shell — {shape?.name} / {shellFor}
            </Text>
          </Group>
        }
      >
        {shape && shellFor && (
          <Box h="70vh">
            <TerminalComponent
              namespace={namespace}
              pod={shape.name}
              container={shellFor}
              cluster={cluster}
            />
          </Box>
        )}
      </Modal>
    </Modal>
  );
}

function ContainerLine({
  container,
  onLogs,
  onShell,
}: {
  container: ContainerShape;
  onLogs: () => void;
  onShell?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const stateColor =
    container.state === 'Running'
      ? 'statusOk'
      : container.state === 'Waiting'
        ? 'statusPending'
        : container.state === 'Terminated'
          ? 'statusWarn'
          : 'statusNeutral';

  return (
    <Paper withBorder radius="sm" p="xs">
      <Group gap="xs" wrap="nowrap">
        {container.isInit && (
          <Badge size="xs" variant="default" style={{ flexShrink: 0 }}>
            init
          </Badge>
        )}
        <Text size="sm" truncate="end" style={{ flex: 1, minWidth: 0 }}>
          {container.name}
        </Text>
        {container.restartCount > 0 && (
          <Text
            size="xs"
            fw={600}
            c={container.restartCount > 5 ? 'statusError' : 'statusWarn'}
            style={{ flexShrink: 0 }}
          >
            {container.restartCount}↺
          </Text>
        )}
        <Badge size="xs" variant="light" color={stateColor} style={{ flexShrink: 0 }}>
          {container.state}
        </Badge>
        <Button size="compact-xs" variant="subtle" onClick={onLogs}>
          Logs
        </Button>
        {onShell && (
          <Button size="compact-xs" variant="subtle" onClick={onShell}>
            Shell
          </Button>
        )}
        {container.reason && (
          <Button
            size="compact-xs"
            variant="subtle"
            color="gray"
            onClick={() => setOpen((o) => !o)}
            aria-label="Show reason"
          >
            {open ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
          </Button>
        )}
      </Group>

      {container.reason && (
        <Collapse expanded={open}>
          <Text size="xs" c="dimmed" mt={6}>
            {container.reason}
          </Text>
        </Collapse>
      )}
    </Paper>
  );
}

export default PodDetailModal;
