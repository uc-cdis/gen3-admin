import type { ReactNode } from 'react';

import {
  Alert,
  Button,
  Center,
  Group,
  Loader,
  Paper,
  Skeleton,
  Stack,
  Text,
} from '@mantine/core';
import { IconAlertTriangle, IconInbox, IconRefresh } from '@tabler/icons-react';

export type SkeletonKind = 'spinner' | 'table' | 'cards';

export type LoadingStateProps = {
  label?: string;
  /** Shape of the placeholder. `table`/`cards` reduce layout shift. */
  skeleton?: SkeletonKind;
  rows?: number;
};

/**
 * Loading placeholder.
 *
 * Replaces four competing idioms across the app (bare <Loader>, Skeleton,
 * LoadingOverlay, and a hand-rolled CSS spinner with a hardcoded #09f that was
 * invisible in dark mode).
 */
export function LoadingState({ label, skeleton = 'spinner', rows = 5 }: LoadingStateProps) {
  if (skeleton === 'table') {
    return (
      <Stack gap="xs" aria-busy="true" aria-live="polite">
        {label && (
          <Text c="dimmed" size="sm">
            {label}
          </Text>
        )}
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} height={36} radius="sm" />
        ))}
      </Stack>
    );
  }

  if (skeleton === 'cards') {
    return (
      <Group gap="md" aria-busy="true" aria-live="polite">
        {Array.from({ length: Math.min(rows, 4) }).map((_, i) => (
          <Skeleton key={i} height={104} radius="md" style={{ flex: '1 1 200px' }} />
        ))}
      </Group>
    );
  }

  return (
    <Center py="xl" aria-busy="true" aria-live="polite">
      <Stack align="center" gap="sm">
        <Loader />
        {label && (
          <Text c="dimmed" size="sm">
            {label}
          </Text>
        )}
      </Stack>
    </Center>
  );
}

export type ErrorStateProps = {
  error: unknown;
  title?: string;
  onRetry?: () => void;
  /** Extra context, e.g. which cluster or namespace was being read. */
  hint?: ReactNode;
};

function errorMessage(error: unknown): string {
  if (!error) return 'Unknown error';
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && 'message' in (error as any)) {
    return String((error as any).message);
  }
  return String(error);
}

/**
 * Error state with a retry affordance.
 *
 * Distinguishing this from EmptyState matters: several pages used
 * `.catch(() => setItems([]))`, which rendered "no results" during an outage and
 * made a broken API indistinguishable from an empty one.
 */
export function ErrorState({ error, title = 'Something went wrong', onRetry, hint }: ErrorStateProps) {
  return (
    <Alert
      variant="light"
      color="statusError"
      icon={<IconAlertTriangle size={18} />}
      title={title}
      role="alert"
    >
      <Stack gap="sm" align="flex-start">
        <Text size="sm">{errorMessage(error)}</Text>
        {hint && (
          <Text size="xs" c="dimmed">
            {hint}
          </Text>
        )}
        {onRetry && (
          <Button
            size="xs"
            variant="light"
            color="statusError"
            leftSection={<IconRefresh size={14} />}
            onClick={onRetry}
          >
            Retry
          </Button>
        )}
      </Stack>
    </Alert>
  );
}

export type EmptyStateProps = {
  title?: string;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
};

export function EmptyState({
  title = 'Nothing here yet',
  description,
  action,
  icon,
}: EmptyStateProps) {
  return (
    <Paper withBorder={false} p="xl">
      <Center>
        <Stack align="center" gap="xs" maw={420}>
          {icon ?? <IconInbox size={32} opacity={0.4} />}
          <Text fw={600}>{title}</Text>
          {description && (
            <Text c="dimmed" size="sm" ta="center">
              {description}
            </Text>
          )}
          {action}
        </Stack>
      </Center>
    </Paper>
  );
}

export type QueryStateProps<T> = {
  loading?: boolean;
  error?: unknown;
  data: T | undefined;
  onRetry?: () => void;
  loadingLabel?: string;
  skeleton?: SkeletonKind;
  errorTitle?: string;
  errorHint?: ReactNode;
  emptyTitle?: string;
  emptyDescription?: ReactNode;
  emptyAction?: ReactNode;
  /** Treat an empty array / null as empty. Default true. */
  detectEmpty?: boolean;
  children: (data: T) => ReactNode;
};

function isEmpty(data: unknown): boolean {
  if (data == null) return true;
  if (Array.isArray(data)) return data.length === 0;
  if (typeof data === 'object') return Object.keys(data as object).length === 0;
  return false;
}

/**
 * The loading -> error -> empty -> content ladder, in the order that avoids the
 * usual bugs: errors win over stale data, and empty is only reported once we
 * know the request succeeded.
 *
 *   <QueryState loading={r.isLoading} error={r.error} data={r.data} onRetry={r.refresh}>
 *     {(items) => <Table … />}
 *   </QueryState>
 */
export function QueryState<T>({
  loading,
  error,
  data,
  onRetry,
  loadingLabel,
  skeleton = 'spinner',
  errorTitle,
  errorHint,
  emptyTitle,
  emptyDescription,
  emptyAction,
  detectEmpty = true,
  children,
}: QueryStateProps<T>) {
  // Only block on the first load; a background refresh keeps showing content.
  if (loading && data === undefined) {
    return <LoadingState label={loadingLabel} skeleton={skeleton} />;
  }

  if (error) {
    return <ErrorState error={error} title={errorTitle} onRetry={onRetry} hint={errorHint} />;
  }

  if (data === undefined) {
    return <LoadingState label={loadingLabel} skeleton={skeleton} />;
  }

  if (detectEmpty && isEmpty(data)) {
    return (
      <EmptyState title={emptyTitle} description={emptyDescription} action={emptyAction} />
    );
  }

  return <>{children(data)}</>;
}
