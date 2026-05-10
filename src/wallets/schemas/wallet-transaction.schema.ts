import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export enum WalletTransactionType {
  Deposit = 'deposit',
  Withdrawal = 'withdrawal',
}

export enum WalletTransactionStatus {
  Completed = 'completed',
}

export type WalletTransactionDocument = HydratedDocument<WalletTransaction>;

@Schema({
  collection: 'wallet_transactions',
  timestamps: true,
})
export class WalletTransaction {
  @Prop({
    type: Types.ObjectId,
    ref: 'Wallet',
    required: true,
    index: true,
  })
  wallet_id!: Types.ObjectId;

  @Prop({
    type: String,
    enum: WalletTransactionType,
    required: true,
    index: true,
  })
  transaction_type!: WalletTransactionType;

  @Prop({
    type: Number,
    required: true,
    min: 0.01,
  })
  amount!: number;

  @Prop({
    type: String,
    enum: WalletTransactionStatus,
    default: WalletTransactionStatus.Completed,
    required: true,
    index: true,
  })
  status!: WalletTransactionStatus;

  @Prop({
    type: String,
    default: null,
    unique: true,
    sparse: true,
  })
  reference_id?: string | null;
}

export const WalletTransactionSchema =
  SchemaFactory.createForClass(WalletTransaction);
