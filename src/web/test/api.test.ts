import { describe, it, expect, beforeEach } from 'vitest';
import { setToken, clearToken, isLoggedIn } from '../src/lib/api';

describe('auth helpers', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('isLoggedIn returns false when no token', () => {
    expect(isLoggedIn()).toBe(false);
  });

  it('isLoggedIn returns true after setToken', () => {
    setToken('test-token');
    expect(isLoggedIn()).toBe(true);
  });

  it('clearToken removes the token', () => {
    setToken('test-token');
    expect(isLoggedIn()).toBe(true);
    clearToken();
    expect(isLoggedIn()).toBe(false);
  });

  it('stores token in localStorage', () => {
    setToken('my-jwt');
    expect(localStorage.getItem('daisy_token')).toBe('my-jwt');
  });
});
