import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Request } from 'express';

type CmsRequest = Request & {
  user?: {
    accountType?: string;
    role?: string;
  };
};

@Injectable()
export class CmsAnalystGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<CmsRequest>();

    if (
      request.user?.accountType !== 'cms' ||
      request.user.role !== 'analyst'
    ) {
      throw new ForbiddenException('Analyst access required');
    }

    return true;
  }
}
