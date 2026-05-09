import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type BuyOrderDocument = HydratedDocument<BuyOrder>;

export enum BuyOrderStatus {
  Filled = 'filled',
}

@Schema({
  collection: 'buy_orders',
  timestamps: true,
})
export class BuyOrder {
  @Prop({
    type: Types.ObjectId,
    ref: 'Stock',
    required: true,
    index: true,
  })
  stock_id!: Types.ObjectId;

  @Prop({
    type: Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  user_id!: Types.ObjectId;

  @Prop({ required: true, min: 1 })
  numberOfShares!: number;

  @Prop({ required: true, min: 0 })
  costPerShare!: number;

  @Prop({ required: true, min: 0 })
  totalCost!: number;

  @Prop({
    enum: BuyOrderStatus,
    default: BuyOrderStatus.Filled,
  })
  status!: BuyOrderStatus;
}

export const BuyOrderSchema = SchemaFactory.createForClass(BuyOrder);
