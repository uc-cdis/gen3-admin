import { parseEnvKey, hasEnvSelection } from './envKey';

describe('parseEnvKey', () => {
  it('splits the three-segment key useEnvironments produces', () => {
    expect(parseEnvKey('dev0/gen3/gen3-release')).toEqual({
      cluster: 'dev0',
      namespace: 'gen3',
      appName: 'gen3-release',
    });
  });

  // The value is restored from localStorage, so it may predate any given
  // format. Missing segments must read as '' rather than undefined.
  it('fills missing segments with empty strings', () => {
    expect(parseEnvKey('dev0/gen3')).toEqual({
      cluster: 'dev0',
      namespace: 'gen3',
      appName: '',
    });
    expect(parseEnvKey('dev0')).toEqual({
      cluster: 'dev0',
      namespace: '',
      appName: '',
    });
  });

  it('treats empty and nullish input as no selection', () => {
    const empty = { cluster: '', namespace: '', appName: '' };
    expect(parseEnvKey('')).toEqual(empty);
    expect(parseEnvKey(null)).toEqual(empty);
    expect(parseEnvKey(undefined)).toEqual(empty);
  });

  // ''.split('/') is [''], which is why the old inline destructuring happened
  // to work. Guard it explicitly so that stays true.
  it('does not report a cluster for the empty string', () => {
    expect(parseEnvKey('').cluster).toBe('');
  });
});

describe('hasEnvSelection', () => {
  it('is true only when a cluster is named', () => {
    expect(hasEnvSelection('dev0/gen3/release')).toBe(true);
    expect(hasEnvSelection('dev0')).toBe(true);
    expect(hasEnvSelection('')).toBe(false);
    expect(hasEnvSelection(null)).toBe(false);
    expect(hasEnvSelection(undefined)).toBe(false);
  });

  it('is false for a key that is only separators', () => {
    expect(hasEnvSelection('/')).toBe(false);
    expect(hasEnvSelection('//')).toBe(false);
  });
});
