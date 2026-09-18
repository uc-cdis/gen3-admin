import { useEffect, useState } from 'react';
import { Button, Group, NumberInput, Popover, Stack, Text } from '@mantine/core';
import { IconArrowsVertical } from '@tabler/icons-react';

import { useRoles, writeRoleFor } from '@/hooks/useRoles';
import { isScalable, useScaleWorkload } from '@/hooks/useScaleWorkload';

type ScaleControlProps = {
  kind: string;
  namespace: string;
  name: string;
  cluster: string | null | undefined;
  current: number | undefined;
  /** Compact variant for a table row or card. */
  compact?: boolean;
};

/**
 * Sets the replica count on a workload.
 *
 * A popover rather than a modal: setting one number is not worth dimming the
 * page and losing the context you were reading. It also sits inside cards
 * that are themselves clickable, so every event here stops propagating --
 * otherwise opening the control also triggered the card's own handler and
 * the pods drawer slid open behind the dialog.
 *
 * Disabled rather than hidden without write access, with the missing role
 * named in the title.
 */
export function ScaleControl({
  kind,
  namespace,
  name,
  cluster,
  current,
  compact,
}: ScaleControlProps) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<number | string>(current ?? 0);
  const { scale, pending } = useScaleWorkload();
  const { canWrite } = useRoles();

  // Follow the live count while closed, so reopening does not show a stale
  // number after a rollout or someone else's change.
  useEffect(() => {
    if (!open) setValue(current ?? 0);
  }, [current, open]);

  if (!isScalable(kind)) return null;

  const allowed = canWrite(cluster);

  const replicas = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  const valid = Number.isInteger(replicas) && replicas >= 0;
  const unchanged = valid && replicas === (current ?? 0);
  const scalingToZero = valid && replicas === 0 && (current ?? 0) > 0;

  const submit = async () => {
    const ok = await scale({ kind, namespace, name, cluster }, replicas);
    if (ok) setOpen(false);
  };

  return (
    // The wrapper catches anything the popover's own handlers miss, so a
    // click inside it never reaches a clickable ancestor.
    <span
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      role="presentation"
    >
      <Popover
        opened={open}
        onChange={setOpen}
        position="bottom-end"
        withArrow
        shadow="md"
        trapFocus
        width={220}
      >
        <Popover.Target>
          {/* The Button must be Popover.Target's direct child so the ref
              attaches; RequireWrite wraps its child in a span when disabled,
              which would break positioning. The gate is inline instead. */}
          <Button
            variant={compact ? 'subtle' : 'default'}
            size={compact ? 'compact-sm' : 'sm'}
            leftSection={<IconArrowsVertical size={16} />}
            disabled={!allowed}
            title={allowed ? undefined : `Requires the ${writeRoleFor(cluster)} role`}
            onClick={(e) => {
              e.stopPropagation();
              setOpen((o) => !o);
            }}
          >
            Scale
          </Button>
        </Popover.Target>

        <Popover.Dropdown onClick={(e) => e.stopPropagation()}>
          <Stack gap="xs">
            <NumberInput
              label="Replicas"
              size="xs"
              value={value}
              onChange={setValue}
              min={0}
              max={100}
              allowDecimal={false}
              allowNegative={false}
              clampBehavior="strict"
              data-autofocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && valid && !unchanged) {
                  e.preventDefault();
                  submit();
                }
              }}
            />

            {scalingToZero && (
              <Text size="xs" c="statusWarn">
                Stops all replicas. Nothing will serve traffic until you scale back up.
              </Text>
            )}

            <Group gap="xs" grow>
              <Button size="xs" variant="default" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                size="xs"
                loading={pending}
                disabled={!valid || unchanged}
                color={scalingToZero ? 'statusWarn' : undefined}
                onClick={submit}
              >
                {scalingToZero ? 'Scale to 0' : 'Apply'}
              </Button>
            </Group>
          </Stack>
        </Popover.Dropdown>
      </Popover>
    </span>
  );
}

export default ScaleControl;
