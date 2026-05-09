import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type StockHistoryDocument = StockHistory & Document;

@Schema({ collection: 'stock_history', versionKey: false })
export class StockHistory {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  stockId!: Types.ObjectId;

  @Prop({ type: Object, required: true })
  before!: Record<string, unknown>;

  @Prop({ required: true })
  changedAt!: Date;

  @Prop({ required: true })
  operation!: string;
}

export const StockHistorySchema = SchemaFactory.createForClass(StockHistory);
