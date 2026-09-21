import { isSuspended } from './useSuspendCronJob';

/**
 * The Kubernetes field is `spec.suspend`. Three call sites read
 * `spec.suspended`, which does not exist on the object, so it was always
 * undefined: a suspended CronJob rendered as active, the card showed a
 * schedule it was not following, and the Active/Suspended filter matched
 * everything as active.
 */
describe('isSuspended', () => {
  it('reads spec.suspend', () => {
    expect(isSuspended({ spec: { suspend: true } })).toBe(true);
    expect(isSuspended({ spec: { suspend: false } })).toBe(false);
  });

  // The exact bug: guard against the typo coming back.
  it('is not fooled by the misspelled spec.suspended', () => {
    expect(isSuspended({ spec: { suspended: true } })).toBe(false);
  });

  // Kubernetes omits the field entirely when it has never been set, which
  // means not suspended.
  it('treats an absent field as not suspended', () => {
    expect(isSuspended({ spec: {} })).toBe(false);
    expect(isSuspended({})).toBe(false);
    expect(isSuspended(undefined)).toBe(false);
    expect(isSuspended(null)).toBe(false);
  });

  // Only a real boolean true counts; a truthy string must not.
  it('requires a boolean true', () => {
    expect(isSuspended({ spec: { suspend: 'true' } })).toBe(false);
    expect(isSuspended({ spec: { suspend: 1 } })).toBe(false);
  });
});
