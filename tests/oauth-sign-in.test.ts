import { describe, expect, test } from 'vitest';

import { AUTHORIZE_PATH, authorizeCallbackFromQuery } from '@/lib/oauth-sign-in';

describe('authorizeCallbackFromQuery', () => {
  test('a signed authorization request goes back to the authorize endpoint, unsigned', () => {
    const signed = new URLSearchParams(
      'response_type=code&client_id=abc&redirect_uri=https%3A%2F%2Fapp.example%2Fcb&scope=read+races' +
        '&state=s1&code_challenge=xyz&code_challenge_method=S256&exp=1&ba_iat=2&ba_param=client_id&ba_param=scope&sig=zzz',
    );
    const back = authorizeCallbackFromQuery(signed)!;
    const url = new URL(back, 'http://x');
    expect(url.pathname).toBe(AUTHORIZE_PATH);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: 'code',
      client_id: 'abc',
      redirect_uri: 'https://app.example/cb',
      scope: 'read races',
      state: 's1',
      code_challenge: 'xyz',
      code_challenge_method: 'S256',
    });
  });

  test('the sign-in page’s own parameters are not carried along', () => {
    const back = authorizeCallbackFromQuery(new URLSearchParams('client_id=abc&sig=zzz&callbackURL=%2F&error=X'))!;
    expect(new URL(back, 'http://x').searchParams.has('callbackURL')).toBe(false);
    expect(new URL(back, 'http://x').searchParams.has('error')).toBe(false);
  });

  test('anything else is not an authorization request', () => {
    expect(authorizeCallbackFromQuery(new URLSearchParams('callbackURL=%2Fseries'))).toBeNull();
    expect(authorizeCallbackFromQuery(new URLSearchParams('client_id=abc'))).toBeNull();
    expect(authorizeCallbackFromQuery(new URLSearchParams('sig=zzz'))).toBeNull();
  });
});
