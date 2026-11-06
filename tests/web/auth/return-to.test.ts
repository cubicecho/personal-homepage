import { isSafeReturnPath, rememberReturnTo, type StorageLike, takeReturnTo } from '../../../web/src/auth/return-to.ts';

/**
 * Builds an in-memory storage.
 *
 * @returns The storage.
 */
function memoryStorage(): StorageLike {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

describe('isSafeReturnPath', () => {
  it.each([
    ['/add?url=https%3A%2F%2Fexample.com&title=Example', true],
    ['/pages/media', true],
    ['/', true],
    ['//evil.example', false],
    ['/\\evil.example', false],
    ['https://evil.example/', false],
    ['/login', false],
    ['/login?error=x', false],
    ['/auth/sso?token=abc', false],
  ])('%s is %s', (path, expected) => {
    expect(isSafeReturnPath(path)).toBe(expected);
  });
});

describe('return-to', () => {
  it('keeps the query string through a sign-in, and is read once', () => {
    const storage = memoryStorage();
    rememberReturnTo('/add?url=https%3A%2F%2Fexample.com&title=Example%20%26%20Co', storage);
    expect(takeReturnTo(storage)).toBe('/add?url=https%3A%2F%2Fexample.com&title=Example%20%26%20Co');
    expect(takeReturnTo(storage)).toBeNull();
  });

  it('refuses to remember or return a path off this app', () => {
    const storage = memoryStorage();
    rememberReturnTo('//evil.example/add', storage);
    expect(takeReturnTo(storage)).toBeNull();
    storage.setItem('homepage.return-to', 'https://evil.example');
    expect(takeReturnTo(storage)).toBeNull();
  });

  it('does nothing without storage', () => {
    expect(() => rememberReturnTo('/add', null)).not.toThrow();
    expect(takeReturnTo(null)).toBeNull();
  });
});
