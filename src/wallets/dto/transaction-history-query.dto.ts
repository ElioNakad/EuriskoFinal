import { IsDateString, IsEnum, IsOptional } from 'class-validator';

export enum TransactionHistoryType {
  Deposit = 'deposit',
  Withdrawal = 'withdrawal',
  Buy = 'buy',
  Sell = 'sell',
}

export class TransactionHistoryQueryDto {
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
