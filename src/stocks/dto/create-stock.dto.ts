import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class CreateStockDto {
  @IsString()
  ticker!: string;

  @IsString()
  companyName!: string;

  @IsString()
  sector!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  currentPrice!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  availableShares!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  initialShares?: number;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  isListed?: boolean;
}
