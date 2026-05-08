import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type WalletDocument = HydratedDocument<Wallet>;

@Schema({
  timestamps: true,
})
export class Wallet {
  @Prop({
    type: Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
    index: true,
  })
  userId: Types.ObjectId | undefined;

  @Prop({
    type: Number,
    required: true,
    default: 0,
    min: 0,
  })
  balance: number | undefined;

  @Prop({
    type: Date,
    default: null,
  })
  lastDepositAt: Date | null | undefined;
}

export const WalletSchema = SchemaFactory.createForClass(Wallet);
