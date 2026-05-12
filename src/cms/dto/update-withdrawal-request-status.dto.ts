import { IsIn } from 'class-validator';

import { WithdrawalRequestStatus } from '../../wallets/schemas/withdrawal-request.schema';

export class UpdateWithdrawalRequestStatusDto {
  @IsIn([WithdrawalRequestStatus.Approved, WithdrawalRequestStatus.Rejected])
  status!: WithdrawalRequestStatus;
}
