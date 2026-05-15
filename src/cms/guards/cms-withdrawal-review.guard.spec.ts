import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { CmsWithdrawalReviewGuard } from './cms-withdrawal-review.guard';

const createContext = (user?: { accountType?: string; role?: string }) =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  }) as ExecutionContext;

describe('CmsWithdrawalReviewGuard', () => {
  let guard: CmsWithdrawalReviewGuard;

  beforeEach(() => {
    guard = new CmsWithdrawalReviewGuard();
  });

  it('allows cms support agents', () => {
    expect(
      guard.canActivate(
        createContext({ accountType: 'cms', role: 'support-agent' }),
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

  it('rejects other cms roles', () => {
    expect(() =>
      guard.canActivate(createContext({ accountType: 'cms', role: 'analyst' })),
    ).toThrow(ForbiddenException);
  });

  it('rejects non-cms accounts', () => {
    expect(() =>
      guard.canActivate(
        createContext({ accountType: 'member', role: 'support-agent' }),
      ),
    ).toThrow(ForbiddenException);
  });
});
