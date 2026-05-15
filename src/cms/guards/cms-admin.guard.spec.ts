import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { CmsAdminGuard } from './cms-admin.guard';

const createContext = (user?: { accountType?: string; role?: string }) =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  }) as ExecutionContext;

describe('CmsAdminGuard', () => {
  let guard: CmsAdminGuard;

  beforeEach(() => {
    guard = new CmsAdminGuard();
  });

  it('allows cms administrators', () => {
    expect(
      guard.canActivate(
        createContext({ accountType: 'cms', role: 'administrator' }),
      ),
    ).toBe(true);
  });

  it('allows cms super administrators', () => {
    expect(
      guard.canActivate(
        createContext({ accountType: 'cms', role: 'super-admin' }),
      ),
    ).toBe(true);
  });

  it('rejects specialized cms roles', () => {
    expect(() =>
      guard.canActivate(createContext({ accountType: 'cms', role: 'analyst' })),
    ).toThrow(ForbiddenException);
  });

  it('rejects non-cms accounts', () => {
    expect(() =>
      guard.canActivate(
        createContext({ accountType: 'member', role: 'administrator' }),
      ),
    ).toThrow(ForbiddenException);
  });
});
