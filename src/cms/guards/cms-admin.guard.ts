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
export class CmsAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<CmsRequest>();
    const allowedRoles = ['administrator', 'super-admin'];

    if (
      request.user?.accountType !== 'cms' ||
      !allowedRoles.includes(request.user.role ?? '')
    ) {
      throw new ForbiddenException('CMS administrator access required');
    }

    return true;
  }
}
