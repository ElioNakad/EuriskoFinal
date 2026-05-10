import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

import { StockAlertDirection } from '../dto/create-stock-alert.dto';

export enum StockAlertStatus {
  Active = 'active',
  Triggered = 'triggered',
  Cancelled = 'cancelled',
}

export type StockAlertDocument = StockAlert & Document;

@Schema({ timestamps: true })
export class StockAlert {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  memberId!: Types.ObjectId;

  @Prop({ required: true, uppercase: true, trim: true })
  ticker!: string;

  @Prop({ enum: StockAlertDirection, required: true })
  direction!: StockAlertDirection;

  @Prop({ required: true, min: 0 })
  thresholdPrice!: number;

  @Prop({ enum: StockAlertStatus, default: StockAlertStatus.Active })
  status!: StockAlertStatus;

  @Prop({ default: true })
  emailEnabled!: boolean;

  @Prop({ default: false })
  pushEnabled!: boolean;

  @Prop()
  triggeredAt?: Date;

  @Prop()
  triggeredPrice?: number;
}

export const StockAlertSchema = SchemaFactory.createForClass(StockAlert);

StockAlertSchema.index({
  ticker: 1,
  status: 1,
  direction: 1,
  thresholdPrice: 1,
});
