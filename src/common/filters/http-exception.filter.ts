import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';

import { REQUEST_ID_HEADER } from '../middleware/request-id.middleware';

type ExceptionResponse = {
  message?: string | string[];
  error?: string;
  statusCode?: number;
};

function isExceptionResponse(value: unknown): value is ExceptionResponse {
  return typeof value === 'object' && value !== null;
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') {
      throw exception;
    }

    const httpContext = host.switchToHttp();
    const request = httpContext.getRequest<Request>();
    const response = httpContext.getResponse<Response>();
    const statusCode =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const exceptionResponse =
      exception instanceof HttpException ? exception.getResponse() : undefined;
    const responseBody = isExceptionResponse(exceptionResponse)
      ? exceptionResponse
      : undefined;
    const message =
      responseBody?.message ||
      (typeof exceptionResponse === 'string' ? exceptionResponse : undefined) ||
      (exception instanceof Error
        ? exception.message
        : 'Internal server error');
    const error =
      responseBody?.error ||
      (exception instanceof HttpException
        ? exception.name
        : 'Internal Server Error');

    response.status(statusCode).json({
      success: false,
      statusCode,
      timestamp: new Date().toISOString(),
      path: request.originalUrl,
      method: request.method,
      requestId: request.header(REQUEST_ID_HEADER),
      message,
      error,
    });
  }
}
