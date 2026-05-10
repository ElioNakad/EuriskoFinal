import { IsBoolean, IsEnum, IsNumber, IsString, Min } from 'class-validator';

export enum StockAlertDirection {
  Above = 'above',
  Below = 'below',
}

export class CreateStockAlertDto {
  @IsString()
  ticker!: string;

  @IsEnum(StockAlertDirection)
  direction!: StockAlertDirection;

  @IsNumber()
  @Min(0)
  thresholdPrice!: number;

  @IsBoolean()
  pushEnabled!: boolean;
}
