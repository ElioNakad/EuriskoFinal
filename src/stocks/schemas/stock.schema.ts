import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type StockDocument = Stock & Document;

@Schema({ timestamps: true })
export class Stock {
  @Prop({ required: true })
  ticker!: string;

  @Prop({ required: true })
  companyName!: string;

  @Prop({ required: true })
  sector!: string;

  @Prop({ required: true })
  currentPrice!: number;

  @Prop()
  description!: string;

  @Prop({ default: true })
  isListed!: boolean;
}

export const StockSchema = SchemaFactory.createForClass(Stock);
