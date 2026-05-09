import { Type } from 'class-transformer';
import { IsInt, IsMongoId, Min } from 'class-validator';

export class PlaceMarketBuyOrderDto {
  @IsMongoId()
  stockId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  numberOfShares!: number;
}
