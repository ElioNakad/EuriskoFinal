import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';

import { UsersService } from '../../users/users.service';

interface JwtPayload {
  sub: string;
  email: string;
  role?: string;
  accountType?: string;
}

type AuthenticatedRequest = Request & {
  user?: {
    userId: string;
    email: string;
    role?: string;
    accountType?: string;
  };
};

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly usersService: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.extractTokenFromHeader(request);

    if (!token) {
      throw new UnauthorizedException();
    }

    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token, {
        secret: process.env.JWT_SECRET,
      });

      if (payload.accountType === 'member') {
        const user = await this.usersService.findById(payload.sub);

        if (!user?.isActive) {
          throw new UnauthorizedException('Account is inactive');
        }
      }

      request.user = {
        userId: payload.sub,
        email: payload.email,
        role: payload.role,
        accountType: payload.accountType,
      };
    } catch {
      throw new UnauthorizedException();
    }

    return true;
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];

    return type === 'Bearer' ? token : undefined;
  }
}
