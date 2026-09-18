import { useState } from 'react';
import { Button, Group, Modal, NumberInput, Stack, Text } from '@mantine/core';
import { IconArrowsVertical } from '@tabler/icons-react';

import { RequireWrite } from '@/components/ui';

import { isScalable, useScaleWorkload } from '@/hooks/useScaleWorkload';

type ScaleControlProps = {
  kind: string;
  namespace: string;
  name: string;
  cluster: string | null | undefined;
  current: number | undefined;
  /** Compact variant for a table row. */
  compact?: boolean;
};

/**
 * Sets the replica count on a workload.
 *
 * Disabled rather than hidden when the user lacks write access: a missing
 * button reads as a broken or incomplete product, while a disabled one with a
 * reason tells them exactly what to ask an administrator for. The server
 * enforces this regardless -- the gate here only decides what to explain.
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

  if (!isScalable(kind)) return null;

  const replicas = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  const valid = Number.isInteger(replicas) && replicas >= 0;
  const scalingToZero = valid && replicas === 0 && (current ?? 0) > 0;

  const trigger = (
    <Button
      variant={compact ? 'subtle' : 'default'}
      size={compact ? 'compact-sm' : 'sm'}
      leftSection={<IconArrowsVertical size={16} />}
      onClick={() => {
        setValue(current ?? 0);
        setOpen(true);
      }}
    >
      Scale
    </Button>
  );

  return (
    <>
      <RequireWrite cluster={cluster}>{trigger}</RequireWrite>

      <Modal opened={open} onClose={() => setOpen(false)} title={`Scale ${name}`} centered>
        <Stack gap="md">
          <NumberInput
            label="Replicas"
            description={`Currently ${current ?? 0}.`}
            value={value}
            onChange={setValue}
            min={0}
            allowDecimal={false}
            allowNegative={false}
            data-autofocus
          />

          {scalingToZero && (
            <Text size="sm" c="statusWarn">
              Scaling to zero stops all replicas. The workload stays defined and can be
              scaled back up, but it will serve no traffic until then.
            </Text>
          )}

          <Group justify="flex-end" gap="xs">
            <Button variant="default" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={pending}
              disabled={!valid}
              color={scalingToZero ? 'statusWarn' : undefined}
              onClick={async () => {
                const ok = await scale({ kind, namespace, name, cluster }, replicas);
                if (ok) setOpen(false);
              }}
            >
              {scalingToZero ? 'Scale to zero' : 'Scale'}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}

export default ScaleControl;
