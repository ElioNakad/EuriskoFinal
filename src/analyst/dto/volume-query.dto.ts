import { IsDateString, IsEnum, IsMongoId } from 'class-validator';

export enum VolumeGranularity {
  Day = 'day',
  Month = 'month',
}

export class VolumeQueryDto {
  @IsMongoId()
  stock_id!: string;

  @IsEnum(VolumeGranularity)
  granularity!: VolumeGranularity;

  @IsDateString()
  from!: string;

  @IsDateString()
  to!: string;
}
