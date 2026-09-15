import type { ReactNode } from 'react';

import { ActionIcon, Group, Stack, Text, Title, Tooltip } from '@mantine/core';
import { IconArrowLeft } from '@tabler/icons-react';
import Link from 'next/link';

export type PageHeaderProps = {
  title: ReactNode;
  /** One line of context under the title. */
  subtitle?: ReactNode;
  /** Status badges rendered inline after the title. */
  badges?: ReactNode;
  /** Buttons, right-aligned. */
  actions?: ReactNode;
  /** Shows a back arrow linking here. */
  backHref?: string;
  backLabel?: string;
  /** Optional icon before the title. */
  icon?: ReactNode;
};

/**
 * Standard page header.
 *
 * Exists because page titles were previously a mix of raw <h1>, `Title order={1}`,
 * `order={2}` and no order at all -- one page even had an <h1> immediately
 * followed by a `Title order={2}`. Always renders order={1} so heading levels are
 * consistent and the document outline is correct for screen readers.
 */
export function PageHeader({
  title,
  subtitle,
  badges,
  actions,
  backHref,
  backLabel = 'Back',
  icon,
}: PageHeaderProps) {
  return (
    <Group justify="space-between" align="flex-start" wrap="nowrap" mb="lg">
      <Group gap="sm" align="flex-start" wrap="nowrap" style={{ minWidth: 0 }}>
        {backHref && (
          <Tooltip label={backLabel}>
            <ActionIcon
              component={Link}
              href={backHref}
              variant="subtle"
              size="lg"
              aria-label={backLabel}
              mt={2}
            >
              <IconArrowLeft size={18} />
            </ActionIcon>
          </Tooltip>
        )}

        <Stack gap={4} style={{ minWidth: 0 }}>
          <Group gap="sm" wrap="wrap" style={{ minWidth: 0 }}>
            {icon}
            <Title order={1} style={{ wordBreak: 'break-word' }}>
              {title}
            </Title>
            {badges}
          </Group>

          {subtitle && (
            <Text c="dimmed" size="sm">
              {subtitle}
            </Text>
          )}
        </Stack>
      </Group>

      {actions && (
        <Group gap="xs" wrap="nowrap">
          {actions}
        </Group>
      )}
    </Group>
  );
}
