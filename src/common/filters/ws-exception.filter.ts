import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import { Socket } from 'socket.io';

export class WsValidationException extends WsException {
  constructor(
    message: string,
    readonly eventName: string,
  ) {
    super(message);
  }
}

@Catch(WsValidationException)
export class WsExceptionFilter implements ExceptionFilter {
  catch(exception: WsValidationException, host: ArgumentsHost) {
    const client = host.switchToWs().getClient<Socket>();

    client.emit(exception.eventName, {
      message: exception.message,
    });
  }
}
