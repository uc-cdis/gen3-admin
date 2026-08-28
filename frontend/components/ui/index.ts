/**
 * Shared UI primitives. Import from '@/components/ui' rather than reaching into
 * individual files, so adoption is a one-line change per page.
 */

export { PageHeader } from './PageHeader';
export type { PageHeaderProps } from './PageHeader';

export { ReplicaBadge, StatusBadge } from './StatusBadge';
export type { ReplicaBadgeProps, StatusBadgeProps } from './StatusBadge';

export { EmptyState, ErrorState, LoadingState, QueryState } from './QueryState';
export type {
  EmptyStateProps,
  ErrorStateProps,
  LoadingStateProps,
  QueryStateProps,
  SkeletonKind,
} from './QueryState';
