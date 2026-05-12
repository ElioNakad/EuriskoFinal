import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type SellOrderDocument = HydratedDocument<SellOrder>;

export enum SellOrderStatus {
  Filled = 'filled',
}

@Schema({
  collection: 'sell_orders',
  timestamps: true,
})
export class SellOrder {
  @Prop({
    type: Types.ObjectId,
    ref: 'BuyOrder',
    required: true,
    index: true,
  })
  buy_order_id!: Types.ObjectId;

  @Prop({
    type: Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  user_id!: Types.ObjectId;

  @Prop({
    type: Types.ObjectId,
    ref: 'Stock',
    required: true,
    index: true,
  })
  stock_id!: Types.ObjectId;

  @Prop({ required: true, min: 1 })
  numberOfShares!: number;

  @Prop({ required: true, min: 0 })
  purchasePricePerShare!: number;

  @Prop({ required: true, min: 0 })
  sellPricePerShare!: number;

  @Prop({ required: true, min: 0 })
  costBasis!: number;

  @Prop({ required: true, min: 0 })
  proceeds!: number;

  @Prop({ required: true })
  profitLoss!: number;

  @Prop({
    enum: SellOrderStatus,
    default: SellOrderStatus.Filled,
  })
  status!: SellOrderStatus;

  @Prop({ required: true })
  soldAt!: Date;
}

export const SellOrderSchema = SchemaFactory.createForClass(SellOrder);

SellOrderSchema.index({ user_id: 1, soldAt: -1 });
