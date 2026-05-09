import { Type } from 'class-transformer';
import { IsInt, IsMongoId, IsOptional, Min } from 'class-validator';

export class CloseMarketSellOrderDto {
  @IsMongoId()
  orderId!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  numberOfShares?: number;
}
