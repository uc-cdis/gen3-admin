'use client';

import dynamic from 'next/dynamic';
import { Text } from '@mantine/core';

/**
 * Lazy entry points for Monaco (the VS Code editor core).
 *
 * Monaco is large and browser-only, so importing it directly pulls the whole
 * editor into the bundle of every page that touches it -- including pages where
 * it lives behind a tab the user never opens. Routing every call site through
 * this module keeps that cost on-demand and gives us one place to change it.
 */

const loading = () => (
  <Text c="dimmed" size="sm">
    Loading editor…
  </Text>
);

export const MonacoEditor = dynamic(() => import('@monaco-editor/react'), {
  ssr: false,
  loading,
});

export const MonacoDiffEditor = dynamic(
  () => import('@monaco-editor/react').then((m) => m.DiffEditor),
  { ssr: false, loading }
);
