import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { CmsSuperAdminGuard } from './cms-super-admin.guard';

const createContext = (user?: { accountType?: string; role?: string }) =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  }) as ExecutionContext;

describe('CmsSuperAdminGuard', () => {
  let guard: CmsSuperAdminGuard;

  beforeEach(() => {
    guard = new CmsSuperAdminGuard();
  });

  it('allows cms super administrators', () => {
    expect(
      guard.canActivate(
        createContext({ accountType: 'cms', role: 'super-admin' }),
      ),
    ).toBe(true);
  });

  it('rejects cms administrators', () => {
    expect(() =>
      guard.canActivate(
        createContext({ accountType: 'cms', role: 'administrator' }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('rejects non-cms accounts', () => {
    expect(() =>
      guard.canActivate(
        createContext({ accountType: 'member', role: 'super-admin' }),
      ),
    ).toThrow(ForbiddenException);
  });
});
