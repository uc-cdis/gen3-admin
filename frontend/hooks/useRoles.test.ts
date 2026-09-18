import { permissionPredicates, readRoleFor, writeRoleFor, type Me } from './useRoles';

/**
 * Covers the real predicates from the hook rather than a copy, so the tests
 * cannot pass while the shipped logic drifts.
 */
function me(overrides: Partial<Me> = {}): Me {
  return {
    username: 'jdoe',
    email: 'jdoe@example.com',
    name: 'J Doe',
    roles: [],
    readableAgents: [],
    writableAgents: [],
    isSuperAdmin: false,
    ...overrides,
  };
}

const predicates = permissionPredicates;

describe('role predicates', () => {
  const user = me({ readableAgents: ['dev0', 'perf'], writableAgents: ['perf'] });

  it('allows reads on readable agents only', () => {
    const { canRead } = predicates(user);
    expect(canRead('dev0')).toBe(true);
    expect(canRead('perf')).toBe(true);
    expect(canRead('prod')).toBe(false);
  });

  it('allows writes on writable agents only', () => {
    const { canWrite } = predicates(user);
    expect(canWrite('perf')).toBe(true);
    // Readable but not writable -- the case that must disable a scale button.
    expect(canWrite('dev0')).toBe(false);
    expect(canWrite('prod')).toBe(false);
  });

  it('grants everything to a superadmin, including unlisted agents', () => {
    const { canRead, canWrite } = predicates(me({ isSuperAdmin: true }));
    expect(canRead('anything')).toBe(true);
    expect(canWrite('registered-later')).toBe(true);
  });

  // Disabling every control because a metadata call failed would make the
  // console look broken for users who are in fact authorized. The server
  // still rejects anything they may not do.
  it('fails open when /api/me is unavailable', () => {
    const { canRead, canWrite } = predicates(undefined);
    expect(canRead('dev0')).toBe(true);
    expect(canWrite('dev0')).toBe(true);
  });

  it('denies when no agent is named and the user is not a superadmin', () => {
    const { canRead, canWrite } = predicates(user);
    expect(canRead(null)).toBe(false);
    expect(canWrite(undefined)).toBe(false);
  });
});

describe('role name helpers', () => {
  it('mirrors the naming the Go middleware checks', () => {
    expect(writeRoleFor('dev0')).toBe('dev0-write or superadmin');
    expect(readRoleFor('dev0')).toBe('dev0-read or superadmin');
  });

  it('degrades to readable prose without an agent', () => {
    expect(writeRoleFor(null)).toBe('write access');
    expect(readRoleFor(undefined)).toBe('read access');
  });
});
