import { IsDateString, IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export enum TransactionHistoryType {
  Deposit = 'deposit',
  Withdrawal = 'withdrawal',
  Buy = 'buy',
  Sell = 'sell',
}

export class TransactionHistoryQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(TransactionHistoryType)
  type?: TransactionHistoryType;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
