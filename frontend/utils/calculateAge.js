import { formatAge } from '@/lib/resourceHighlights';

/**
 * Relative age of a timestamp.
 *
 * Delegates to `formatAge`, which is the better implementation: it handles
 * seconds and years (this one bucketed everything into m/h/d, so a two-second
 * pod read "1m" and a two-year-old resource read "730d"), clamps negatives
 * rather than taking the absolute value of a future timestamp, and returns
 * '-' instead of "NaNd" for unparseable input.
 *
 * Kept as a shim because ~28 pages outside the workload views still import
 * it. New code should call `formatAge` directly.
 */
export default function calculateAge(created) {
  return formatAge(created);
}
