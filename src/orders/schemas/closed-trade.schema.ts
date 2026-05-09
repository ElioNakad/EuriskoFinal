import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ClosedTradeDocument = HydratedDocument<ClosedTrade>;

@Schema({
  collection: 'closed_trades',
  timestamps: true,
})
export class ClosedTrade {
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

  @Prop({
    type: Types.ObjectId,
    ref: 'BuyOrder',
    required: true,
    index: true,
  })
  buy_order_id!: Types.ObjectId;

  @Prop({
    type: Types.ObjectId,
    ref: 'PortfolioPosition',
    required: true,
    index: true,
  })
  portfolio_position_id!: Types.ObjectId;

  @Prop({ required: true, min: 1 })
  numberOfShares!: number;

  @Prop({ required: true, min: 0 })
  averagePurchasePrice!: number;

  @Prop({ required: true, min: 0 })
  marketPrice!: number;

  @Prop({ required: true, min: 0 })
  costBasis!: number;

  @Prop({ required: true, min: 0 })
  proceeds!: number;

  @Prop({ required: true })
  profitLoss!: number;

  @Prop({ required: true })
  closedAt!: Date;
}

export const ClosedTradeSchema = SchemaFactory.createForClass(ClosedTrade);
