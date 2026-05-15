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
export class CmsWithdrawalReviewGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<CmsRequest>();
    const allowedRoles = ['administrator', 'support-agent', 'super-admin'];

    if (
      request.user?.accountType !== 'cms' ||
      !allowedRoles.includes(request.user.role ?? '')
    ) {
      throw new ForbiddenException('Withdrawal review access required');
    }

    return true;
  }
}
