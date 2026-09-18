import { isForbiddenError } from './QueryState';

/**
 * A 403 must be told apart from any other failure, because it is the one
 * error a Retry button can never fix. `ApiError.isForbidden` existed from the
 * start and had no callers, so every permission denial rendered as a generic
 * red "Something went wrong" with a retry that looped forever.
 */
describe('isForbiddenError', () => {
  it('recognises the ApiError flag', () => {
    expect(isForbiddenError({ isForbidden: true })).toBe(true);
  });

  it('recognises a bare 403 status', () => {
    expect(isForbiddenError({ status: 403 })).toBe(true);
  });

  it('rejects other failures, which may well succeed on retry', () => {
    expect(isForbiddenError({ status: 500 })).toBe(false);
    expect(isForbiddenError({ status: 404 })).toBe(false);
    expect(isForbiddenError({ status: 401 })).toBe(false);
    expect(isForbiddenError({ isForbidden: false })).toBe(false);
  });

  it('tolerates the shapes an error can actually arrive as', () => {
    expect(isForbiddenError(undefined)).toBe(false);
    expect(isForbiddenError(null)).toBe(false);
    expect(isForbiddenError('Forbidden')).toBe(false);
    expect(isForbiddenError(new Error('boom'))).toBe(false);
  });

  // 401 is a session problem, handled by re-authenticating; conflating it
  // with 403 would tell the user to request a role they may already hold.
  it('does not treat unauthenticated as forbidden', () => {
    expect(isForbiddenError({ status: 401, isForbidden: false })).toBe(false);
  });
});
