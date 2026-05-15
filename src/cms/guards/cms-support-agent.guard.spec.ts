import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { CmsSupportAgentGuard } from './cms-support-agent.guard';

const createContext = (user?: { accountType?: string; role?: string }) =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  }) as ExecutionContext;

describe('CmsSupportAgentGuard', () => {
  let guard: CmsSupportAgentGuard;

  beforeEach(() => {
    guard = new CmsSupportAgentGuard();
  });

  it('allows cms support agents', () => {
    expect(
      guard.canActivate(
        createContext({ accountType: 'cms', role: 'support-agent' }),
      ),
    ).toBe(true);
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

  it('rejects analysts', () => {
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
