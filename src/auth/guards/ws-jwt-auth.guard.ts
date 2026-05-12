import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import { UsersService } from '../../users/users.service';
import { AuthenticatedSocket } from '../types/authenticated-socket.type';

interface JwtPayload {
  sub: string;
  email: string;
  role?: string;
  accountType?: string;
}

@Injectable()
export class WsJwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly usersService: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const client = context.switchToWs().getClient<AuthenticatedSocket>();
    const isAuthenticated = await this.authenticateClient(client);

    if (!isAuthenticated) {
      this.emitUnauthorized(client, context.getHandler().name);
    }

    return isAuthenticated;
  }

  async authenticateClient(client: AuthenticatedSocket): Promise<boolean> {
    const token = this.extractToken(client);

    if (!token) {
      return false;
    }

    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token, {
        secret: process.env.JWT_SECRET,
      });

      if (payload.accountType === 'member') {
        const user = await this.usersService.findById(payload.sub);

        if (!user?.isActive) {
          return false;
        }
      }

      client.user = {
        userId: payload.sub,
        email: payload.email,
        role: payload.role,
        accountType: payload.accountType,
      };

      return true;
    } catch {
      return false;
    }
  }

  private emitUnauthorized(
    client: AuthenticatedSocket,
    handlerName: string,
  ): void {
    const eventName =
      handlerName === 'handlePortfolioSummary'
        ? 'portfolio_summary_error'
        : 'order_rejected';

    client.emit(eventName, {
      message: 'Unauthorized',
    });
  }

  private extractToken(client: AuthenticatedSocket): string | undefined {
    const authToken: unknown = client.handshake.auth?.token;

    if (typeof authToken === 'string') {
      return authToken.replace(/^Bearer\s+/i, '');
    }

    const authorization = client.handshake.headers.authorization;

    if (!authorization) {
      return undefined;
    }

    const [type, token] = authorization.split(' ');

    return type === 'Bearer' ? token : undefined;
  }
}
