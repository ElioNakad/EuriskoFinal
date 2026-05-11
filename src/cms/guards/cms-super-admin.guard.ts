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
export class CmsSuperAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<CmsRequest>();

    if (
      request.user?.accountType !== 'cms' ||
      request.user.role !== 'super-admin'
    ) {
      throw new ForbiddenException('Super administrator access required');
    }

    return true;
  }
}
