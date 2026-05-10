import { ArgumentMetadata, PipeTransform } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { WsValidationException } from '../filters/ws-exception.filter';

type DtoClass<T extends object> = new () => T;

export class WsValidationPipe<T extends object> implements PipeTransform {
  constructor(
    private readonly dtoClass: DtoClass<T>,
    private readonly errorMessage: string,
    private readonly errorEventName = 'order_rejected',
  ) {}

  async transform(value: unknown, metadata: ArgumentMetadata): Promise<T> {
    void metadata;

    const dto = plainToInstance(this.dtoClass, value);
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    if (errors.length > 0) {
      throw new WsValidationException(this.errorMessage, this.errorEventName);
    }

    return dto;
  }
}
