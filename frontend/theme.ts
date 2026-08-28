import {
  Badge,
  Button,
  Card,
  type MantineColorsTuple,
  Paper,
  Table,
  Title,
  Tooltip,
  createTheme,
  rem,
} from '@mantine/core';

/**
 * Design tokens for the CSOC console.
 *
 * Two rules keep this coherent as the app grows:
 *
 *  1. Pages should not name raw colors. Status colors come from `lib/status.ts`
 *     via <StatusBadge>, which maps a domain + value onto one of the semantic
 *     ramps below. That is what stops the same k8s phase from being green here
 *     and teal there.
 *  2. Component defaults live in `components` below rather than being repeated
 *     at call sites, so a page that passes no props already looks right.
 */

// Semantic status ramps. Named by meaning, not hue, so a page cannot reach for
// "green" and accidentally imply "healthy" for something that is merely done.
// Each is a full 10-shade Mantine scale so `light`/`filled` variants and both
// color schemes have shades to draw from.
const statusOk: MantineColorsTuple = [
  '#e6f8ef', '#d0f0e0', '#a1e0c1', '#6fcf9f', '#4abd84',
  '#33b273', '#26ad6c', '#18985b', '#0c874f', '#007341',
];

const statusWarn: MantineColorsTuple = [
  '#fff5e6', '#ffe9cc', '#ffd199', '#ffb762', '#ffa134',
  '#ff9417', '#ff8c07', '#e47a00', '#cb6c00', '#b15c00',
];

const statusError: MantineColorsTuple = [
  '#ffe9e9', '#ffd1d1', '#fba0a1', '#f76d6d', '#f34141',
  '#f22625', '#f21616', '#d80c0b', '#c10008', '#a90003',
];

const statusInfo: MantineColorsTuple = [
  '#e5f4ff', '#cde2ff', '#9bc2ff', '#64a0ff', '#3984fc',
  '#1d72fc', '#0969fd', '#0058e2', '#004ecb', '#0043b5',
];

// Distinct from statusWarn on purpose: a k8s pod that is Pending is normal and
// transient, while CrashLoopBackOff is a problem. Collapsing both onto orange
// (as the pages do today) hides that difference.
const statusPending: MantineColorsTuple = [
  '#e7f9fb', '#d5eff2', '#aedee5', '#83cbd7', '#61bccb',
  '#4cb3c4', '#3caec1', '#2a99aa', '#1a8998', '#007786',
];

const statusNeutral: MantineColorsTuple = [
  '#f5f5f5', '#e7e7e7', '#cdcdcd', '#b2b2b2', '#9a9a9a',
  '#8b8b8b', '#848484', '#717171', '#656565', '#575757',
];

// Brand accent. Kept close to the blue the app already reads as "primary" so
// this is a formalisation rather than a visual redesign.
const gen3Blue: MantineColorsTuple = [
  '#eef3ff', '#dee2f2', '#bdc2de', '#98a0ca', '#7a84b9',
  '#6672af', '#5c69ac', '#4c5897', '#424e88', '#364379',
];

export const theme = createTheme({
  primaryColor: 'gen3Blue',
  // Lighter shade in dark mode so primary surfaces keep enough contrast.
  primaryShade: { light: 6, dark: 4 },
  defaultRadius: 'md',

  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  // Wired up so `ff="monospace"` works. Several pages currently use a no-op
  // Tailwind `font-mono` class for IPs, ports and hostnames.
  fontFamilyMonospace:
    'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',

  headings: {
    fontWeight: '600',
    sizes: {
      h1: { fontSize: rem(28), lineHeight: '1.3' },
      h2: { fontSize: rem(22), lineHeight: '1.35' },
      h3: { fontSize: rem(18), lineHeight: '1.4' },
      h4: { fontSize: rem(16), lineHeight: '1.45' },
    },
  },

  colors: {
    gen3Blue,
    statusOk,
    statusWarn,
    statusError,
    statusInfo,
    statusPending,
    statusNeutral,
  },

  components: {
    // `light` is the only badge variant that holds up in both color schemes, and
    // making it the default collapses most of the per-page badge divergence
    // (filled/outline/light with assorted radius and size) without touching
    // those call sites.
    Badge: Badge.extend({
      defaultProps: { variant: 'light', radius: 'sm' },
    }),
    Button: Button.extend({
      defaultProps: { radius: 'md' },
    }),
    Card: Card.extend({
      defaultProps: { withBorder: true, radius: 'md', padding: 'lg' },
    }),
    Paper: Paper.extend({
      defaultProps: { withBorder: true, radius: 'md' },
    }),
    Table: Table.extend({
      defaultProps: { striped: true, highlightOnHover: true, withTableBorder: true },
    }),
    Title: Title.extend({
      defaultProps: { fw: 600 },
    }),
    Tooltip: Tooltip.extend({
      defaultProps: { withArrow: true, openDelay: 300 },
    }),
  },
});
