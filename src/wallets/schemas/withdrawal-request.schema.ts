import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export enum WithdrawalRequestStatus {
  Pending = 'pending',
  Seen = 'seen',
  Approved = 'approved',
  Rejected = 'rejected',
}

export type WithdrawalRequestDocument = HydratedDocument<WithdrawalRequest>;

@Schema({
  collection: 'withdrawals_requests',
  timestamps: true,
})
export class WithdrawalRequest {
  @Prop({
    type: Types.ObjectId,
    ref: 'Wallet',
    required: true,
    index: true,
  })
  wallet_id: Types.ObjectId | undefined;

  @Prop({
    type: Number,
    required: true,
    min: 1,
  })
  amount: number | undefined;

  @Prop({
    type: String,
    enum: WithdrawalRequestStatus,
    default: WithdrawalRequestStatus.Pending,
    required: true,
    index: true,
  })
  status: WithdrawalRequestStatus | undefined;
}

export const WithdrawalRequestSchema =
  SchemaFactory.createForClass(WithdrawalRequest);
