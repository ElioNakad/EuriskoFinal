import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type PortfolioPositionDocument = HydratedDocument<PortfolioPosition>;

export enum PortfolioPositionStatus {
  Open = 'open',
}

@Schema({
  collection: 'portfolio_positions',
  timestamps: true,
})
export class PortfolioPosition {
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

  @Prop({ required: true, min: 1 })
  numberOfShares!: number;

  @Prop({ required: true, min: 0 })
  costPerShare!: number;

  @Prop({ required: true, min: 0 })
  totalCost!: number;

  @Prop({
    enum: PortfolioPositionStatus,
    default: PortfolioPositionStatus.Open,
    index: true,
  })
  status!: PortfolioPositionStatus;
}

export const PortfolioPositionSchema =
  SchemaFactory.createForClass(PortfolioPosition);
