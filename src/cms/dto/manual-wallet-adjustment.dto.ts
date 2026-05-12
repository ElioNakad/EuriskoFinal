import { Type } from 'class-transformer';
import { IsEnum, IsNumber, IsString, Min, MinLength } from 'class-validator';

export enum ManualWalletAdjustmentDirection {
  Credit = 'credit',
  Debit = 'debit',
}

export class ManualWalletAdjustmentDto {
  @IsEnum(ManualWalletAdjustmentDirection)
  direction!: ManualWalletAdjustmentDirection;

  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  amount!: number;

  @IsString()
  @MinLength(1)
  reason!: string;
}
