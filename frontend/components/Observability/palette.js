/**
 * Chart palette.
 *
 * Categorical slots are assigned in fixed order and never cycled -- a series
 * keeps its hue when a filter changes the series count, so colour tracks the
 * entity rather than its rank. Both columns were checked with the palette
 * validator against their own surface (light #fcfcfb / dark #1a1a19): all six
 * checks pass, with one caveat carried below.
 */
export const CATEGORICAL = {
  light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'],
  dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
};

/**
 * On the light surface aqua (2.74:1) and yellow (2.11:1) fall below 3:1, so the
 * validator raises a contrast WARN. That is not dismissable: every chart using
 * these slots must carry visible labels or a table view, which is why the charts
 * below are direct-labelled rather than relying on the legend swatch alone.
 */
export const LIGHT_CONTRAST_RELIEF_REQUIRED = true;

/**
 * Status colours are reserved for state and never reused as a series hue. They
 * always ship with an icon or text label -- on the light surface warning and
 * serious are deliberately sub-3:1, so colour must not carry the meaning alone.
 */
export const STATUS = {
  good: '#0ca30c',
  warning: '#fab219',
  serious: '#ec835a',
  critical: '#d03b3b',
};

export const palette = (isDark) => (isDark ? CATEGORICAL.dark : CATEGORICAL.light);

/** Health colour for a ratio where 1 is fully healthy. */
export const healthColor = (ratio) => {
  if (ratio >= 0.999) return STATUS.good;
  if (ratio >= 0.9) return STATUS.warning;
  if (ratio >= 0.5) return STATUS.serious;
  return STATUS.critical;
};
