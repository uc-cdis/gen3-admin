import { cloneElement, type ReactElement } from 'react';
import { Tooltip } from '@mantine/core';

import { useRoles, writeRoleFor } from '@/hooks/useRoles';

export type RequireWriteProps = {
  /** Agent the action targets. */
  cluster: string | null | undefined;
  /** The control. Receives `disabled` when the user may not write. */
  children: ReactElement<{ disabled?: boolean }>;
  /** Overrides the default tooltip. */
  reason?: string;
};

/**
 * Disables a write control for users who lack `<agent>-write`.
 *
 * Disabled rather than hidden, deliberately: a missing button reads as a
 * broken or half-finished product, while a disabled one with a reason tells
 * the user exactly what to ask an administrator for. The server enforces this
 * regardless -- this only decides what to explain.
 *
 * Fails open when `/api/me` is unavailable (see useRoles), so a failed
 * metadata call cannot grey out a console for someone who is fully
 * authorized.
 */
export function RequireWrite({ cluster, children, reason }: RequireWriteProps) {
  const { canWrite } = useRoles();

  if (canWrite(cluster)) return children;

  const control = cloneElement(children, { disabled: true });

  return (
    <Tooltip label={reason ?? `Requires the ${writeRoleFor(cluster)} role`}>
      {/* A disabled control swallows pointer events, so the tooltip needs a
          wrapper that still receives them. */}
      <span style={{ display: 'inline-flex' }}>{control}</span>
    </Tooltip>
  );
}

export default RequireWrite;
