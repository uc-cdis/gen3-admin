import { useEffect, useState } from 'react';
import { ActionIcon, Group, NumberInput, Text, Tooltip } from '@mantine/core';
import { IconCheck, IconX } from '@tabler/icons-react';

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
 * The input is the control -- there is no button to press first. Typing a
 * different number reveals a confirm and a cancel beside it; matching the
 * current count hides them again. Setting one number never justified opening
 * a dialog over the page you were reading it from.
 *
 * Confirmation is not skipped, because this changes running infrastructure
 * and the steppers make a stray click cheap. It just appears at the point
 * the value actually diverges, rather than gating access to the input.
 *
 * Lives inside cards that are themselves clickable, so every handler stops
 * propagation -- otherwise editing the count also triggered the card and
 * slid the pods drawer open underneath.
 */
export function ScaleControl({
  kind,
  namespace,
  name,
  cluster,
  current,
  compact,
}: ScaleControlProps) {
  const [value, setValue] = useState<number | string>(current ?? 0);
  const { scale, pending } = useScaleWorkload();
  const { canWrite } = useRoles();

  // Follow the live count, but never overwrite an edit in progress: a poll
  // landing mid-keystroke must not reset what the user is typing. `pristine`
  // records the count the field was last synced to, so a genuine change from
  // the cluster is distinguishable from the user's own.
  const [pristine, setPristine] = useState(current ?? 0);
  useEffect(() => {
    const live = current ?? 0;
    if (live === pristine) return;
    setPristine(live);
    // Only adopt the new value if the field is untouched.
    setValue((prev) => (prev === pristine ? live : prev));
  }, [current, pristine]);

  if (!isScalable(kind)) return null;

  const allowed = canWrite(cluster);
  const currentValue = current ?? 0;
  const replicas = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  const valid = Number.isInteger(replicas) && replicas >= 0;
  const dirty = valid && replicas !== currentValue;
  const scalingToZero = dirty && replicas === 0;

  const apply = async () => {
    const ok = await scale({ kind, namespace, name, cluster }, replicas);
    if (!ok) setValue(currentValue);
  };

  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

  return (
    <Group
      gap={4}
      wrap="nowrap"
      onClick={stop}
      onKeyDown={stop}
      role="presentation"
    >
      <Tooltip
        label={allowed ? 'Replicas' : `Requires the ${writeRoleFor(cluster)} role`}
        openDelay={400}
      >
        <NumberInput
          size={compact ? 'xs' : 'sm'}
          w={compact ? 64 : 80}
          value={value}
          onChange={setValue}
          min={0}
          max={100}
          step={1}
          allowDecimal={false}
          allowNegative={false}
          clampBehavior="strict"
          disabled={!allowed || pending}
          aria-label={`Replicas for ${name}`}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && dirty) {
              e.preventDefault();
              apply();
            }
            if (e.key === 'Escape') setValue(currentValue);
          }}
        />
      </Tooltip>

      {dirty && (
        <>
          <Tooltip
            label={
              scalingToZero
                ? 'Scale to zero: stops all replicas'
                : `Scale to ${replicas}`
            }
          >
            <ActionIcon
              size={compact ? 'sm' : 'md'}
              variant="filled"
              color={scalingToZero ? 'statusWarn' : 'statusOk'}
              loading={pending}
              onClick={apply}
              aria-label={`Scale ${name} to ${replicas}`}
            >
              <IconCheck size={14} />
            </ActionIcon>
          </Tooltip>

          <Tooltip label="Cancel">
            <ActionIcon
              size={compact ? 'sm' : 'md'}
              variant="subtle"
              color="gray"
              disabled={pending}
              onClick={() => setValue(currentValue)}
              aria-label="Cancel scaling"
            >
              <IconX size={14} />
            </ActionIcon>
          </Tooltip>
        </>
      )}

      {!dirty && !compact && (
        <Text size="xs" c="dimmed">
          replicas
        </Text>
      )}
    </Group>
  );
}

export default ScaleControl;
