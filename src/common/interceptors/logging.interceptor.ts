import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable, catchError, tap, throwError } from 'rxjs';

import { REQUEST_ID_HEADER } from '../middleware/request-id.middleware';

type AuthenticatedRequest = Request & {
  user?: {
    id?: string;
    sub?: string;
    email?: string;
  };
};

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(LoggingInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const httpContext = context.switchToHttp();
    const request = httpContext.getRequest<AuthenticatedRequest>();
    const response = httpContext.getResponse<Response>();
    const startedAt = Date.now();

    return next.handle().pipe(
      tap(() => {
        this.logRequest(request, response, startedAt);
      }),
      catchError((error: unknown) => {
        this.logRequest(request, response, startedAt, error);

        return throwError(() => error);
      }),
    );
  }

  private logRequest(
    request: AuthenticatedRequest,
    response: Response,
    startedAt: number,
    error?: unknown,
  ): void {
    const durationMs = Date.now() - startedAt;
    const statusCode = response.statusCode;
    const requestId = request.header(REQUEST_ID_HEADER);
    const userId = request.user?.id || request.user?.sub || request.user?.email;
    const baseLog = {
      requestId,
      method: request.method,
      url: request.originalUrl,
      statusCode,
      durationMs,
      userId,
    };

    if (error) {
      this.logger.error({
        ...baseLog,
        error: error instanceof Error ? error.message : String(error),
      });

      return;
    }

    this.logger.log(baseLog);
  }
}
