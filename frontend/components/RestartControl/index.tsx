import { useState } from "react";
import { ActionIcon, Button, Group, Text, Tooltip } from "@mantine/core";
import { IconCheck, IconReload, IconX } from "@tabler/icons-react";

import { useRoles, writeRoleFor } from "@/hooks/useRoles";
import { isRestartable, useRestartWorkload } from "@/hooks/useRestartWorkload";

type RestartControlProps = {
  kind: string;
  namespace: string;
  name: string;
  cluster: string | null | undefined;
  /** Replica count, to warn when there is no headroom for a rolling restart. */
  desired?: number;
  /** Icon-only variant for a card footer. */
  compact?: boolean;
};

/**
 * Rolls a workload's pods.
 *
 * Confirms in place, like `ScaleControl`: the button swaps into a confirm and
 * a cancel rather than opening a dialog over the grid you are scanning. This
 * replaces running pods, so it is never a single unguarded click -- but on a
 * card that is itself clickable, a modal to confirm one icon press would be
 * heavier than the action.
 *
 * Lives inside clickable cards, so every handler stops propagation --
 * otherwise restarting also opened the pods modal underneath.
 */
export function RestartControl({
  kind,
  namespace,
  name,
  cluster,
  desired,
  compact,
}: RestartControlProps) {
  const [confirming, setConfirming] = useState(false);
  const { restart, pending } = useRestartWorkload();
  const { canWrite } = useRoles();

  if (!isRestartable(kind)) return null;

  const allowed = canWrite(cluster);
  // A stopped workload has no pods to roll. Restarting it would patch the
  // template and change nothing visible, which reads as a no-op bug.
  const stopped = (desired ?? 0) === 0;
  const singleReplica = (desired ?? 0) === 1;

  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

  const apply = async () => {
    const ok = await restart({ kind, namespace, name, cluster });
    // Collapse either way: on success the rollout is underway, and on failure
    // the notification carries the reason -- leaving the confirm armed would
    // invite a second blind press.
    setConfirming(false);
    return ok;
  };

  const disabledReason = !allowed
    ? `Requires the ${writeRoleFor(cluster)} role`
    : stopped
      ? "Scaled to zero: nothing to restart"
      : null;

  if (!confirming) {
    const label = disabledReason ?? "Restart: replaces all pods";

    return (
      <Group
        gap={4}
        wrap="nowrap"
        onClick={stop}
        onKeyDown={stop}
        role="presentation"
      >
        <Tooltip label={label} openDelay={400} withArrow>
          {compact ? (
            <ActionIcon
              size="sm"
              variant="subtle"
              color="gray"
              disabled={!allowed || stopped || pending}
              onClick={() => setConfirming(true)}
              aria-label={`Restart ${name}`}
            >
              <IconReload size={14} />
            </ActionIcon>
          ) : (
            <Button
              size="xs"
              variant="default"
              leftSection={<IconReload size={14} />}
              disabled={!allowed || stopped || pending}
              onClick={() => setConfirming(true)}
            >
              Restart
            </Button>
          )}
        </Tooltip>
      </Group>
    );
  }

  return (
    <Group
      gap={4}
      wrap="nowrap"
      onClick={stop}
      onKeyDown={stop}
      role="presentation"
    >
      {!compact && (
        <Text size="xs" c="dimmed">
          Restart?
        </Text>
      )}

      <Tooltip
        label={
          singleReplica
            ? "Restart now: one replica, so expect brief downtime"
            : "Restart now: rolling, a few pods at a time"
        }
        withArrow
      >
        <ActionIcon
          size={compact ? "sm" : "md"}
          variant="filled"
          color={singleReplica ? "statusWarn" : "statusOk"}
          loading={pending}
          onClick={apply}
          aria-label={`Confirm restart of ${name}`}
        >
          <IconCheck size={14} />
        </ActionIcon>
      </Tooltip>

      <Tooltip label="Cancel" withArrow>
        <ActionIcon
          size={compact ? "sm" : "md"}
          variant="subtle"
          color="gray"
          disabled={pending}
          onClick={() => setConfirming(false)}
          aria-label="Cancel restart"
        >
          <IconX size={14} />
        </ActionIcon>
      </Tooltip>
    </Group>
  );
}

export default RestartControl;
