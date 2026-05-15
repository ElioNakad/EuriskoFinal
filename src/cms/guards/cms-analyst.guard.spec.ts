import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { CmsAnalystGuard } from './cms-analyst.guard';

const createContext = (user?: { accountType?: string; role?: string }) =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  }) as ExecutionContext;

describe('CmsAnalystGuard', () => {
  let guard: CmsAnalystGuard;

  beforeEach(() => {
    guard = new CmsAnalystGuard();
  });

  it('allows cms analysts', () => {
    expect(
      guard.canActivate(createContext({ accountType: 'cms', role: 'analyst' })),
    ).toBe(true);
  });

  it('allows cms super administrators', () => {
    expect(
      guard.canActivate(
        createContext({ accountType: 'cms', role: 'super-admin' }),
      ),
    ).toBe(true);
  });

  it('rejects other cms roles', () => {
    expect(() =>
      guard.canActivate(createContext({ accountType: 'cms', role: 'trader' })),
    ).toThrow(ForbiddenException);
  });

  it('rejects non-cms accounts', () => {
    expect(() =>
      guard.canActivate(
        createContext({ accountType: 'member', role: 'analyst' }),
      ),
    ).toThrow(ForbiddenException);
  });
});
