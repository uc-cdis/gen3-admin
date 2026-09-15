import { Badge, type BadgeProps, Tooltip } from '@mantine/core';

import {
  type ResolveOptions,
  type StatusDomain,
  resolveReplicaStatus,
  resolveStatus,
} from '@/lib/status';

export type StatusBadgeProps = Omit<BadgeProps, 'color' | 'children'> & {
  /** Which set of semantics `value` belongs to. */
  domain: StatusDomain;
  value: string | number | boolean | null | undefined;
  /** Container waiting/terminated reason; overrides a bland phase. */
  reason?: string;
  /** Whether all containers are ready (pods). */
  ready?: boolean;
  restarts?: number;
  /** Override the derived label; the tone still comes from `value`. */
  label?: string;
  /** Show the tooltip description when one exists. Default true. */
  withTooltip?: boolean;
};

/**
 * Renders a status as a consistently-coloured badge.
 *
 * There is deliberately no `color` prop: colour is derived from `domain` +
 * `value` through lib/status.ts. That is the whole point -- it is what keeps a
 * Degraded app red on every page instead of red here and orange there.
 */
export function StatusBadge({
  domain,
  value,
  reason,
  ready,
  restarts,
  label,
  withTooltip = true,
  ...badgeProps
}: StatusBadgeProps) {
  const opts: ResolveOptions = { reason, ready, restarts };
  const status = resolveStatus(domain, value, opts);

  const badge = (
    <Badge color={status.color} {...badgeProps}>
      {label ?? status.label}
    </Badge>
  );

  if (withTooltip && status.description) {
    return <Tooltip label={status.description}>{badge}</Tooltip>;
  }
  return badge;
}

export type ReplicaBadgeProps = Omit<BadgeProps, 'color' | 'children'> & {
  ready: number | undefined;
  desired: number | undefined;
  reason?: string;
  withTooltip?: boolean;
};

/**
 * "N/M ready" badge for Deployments, StatefulSets and DaemonSets, where a single
 * phase string cannot express partial readiness.
 */
export function ReplicaBadge({
  ready,
  desired,
  reason,
  withTooltip = true,
  ...badgeProps
}: ReplicaBadgeProps) {
  const status = resolveReplicaStatus(ready, desired, { reason });

  const badge = (
    <Badge color={status.color} {...badgeProps}>
      {status.label}
    </Badge>
  );

  if (withTooltip && status.description) {
    return <Tooltip label={status.description}>{badge}</Tooltip>;
  }
  return badge;
}
