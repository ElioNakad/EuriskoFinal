import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Model, Query, Types } from 'mongoose';

export type StockDocument = Stock & Document;

@Schema({ timestamps: true })
export class Stock {
  @Prop({
    required: true,
    unique: true,
  })
  ticker!: string;

  @Prop({ required: true })
  companyName!: string;

  @Prop({ required: true })
  sector!: string;

  @Prop({ required: true })
  currentPrice!: number;

  @Prop({ required: true, default: 100, min: 0 })
  availableShares!: number;

  @Prop()
  description!: string;

  @Prop({ default: true })
  isListed!: boolean;
}

export const StockSchema = SchemaFactory.createForClass(Stock);

const STOCK_HISTORY_COLLECTION = 'stock_history';
const HISTORY_SINGLE_DOCUMENT_OPERATIONS = [
  'findOneAndUpdate',
  'replaceOne',
  'updateOne',
] as const;

type StockSnapshot = Record<string, unknown> & {
  _id: Types.ObjectId;
};

async function saveStockHistory(
  model: Model<Stock>,
  stocks: StockSnapshot[],
  operation: string,
) {
  if (!stocks.length) {
    return;
  }

  const changedAt = new Date();
  const history = stocks.map((stock) => ({
    stockId: stock._id,
    before: stock,
    changedAt,
    operation,
  }));

  await model.db.collection(STOCK_HISTORY_COLLECTION).insertMany(history);
}

StockSchema.pre('save', async function () {
  if (this.isNew) {
    return;
  }

  const model = this.constructor as Model<Stock>;
  const previousStock = await model.findById(this._id).lean<StockSnapshot>();

  if (previousStock) {
    await saveStockHistory(model, [previousStock], 'save');
  }
});

HISTORY_SINGLE_DOCUMENT_OPERATIONS.forEach((operation) => {
  StockSchema.pre(operation, async function () {
    const query = this as Query<unknown, Stock>;
    const previousStock = await query.model
      .findOne(query.getFilter())
      .sort(query.getOptions().sort ?? {})
      .lean<StockSnapshot>();

    if (previousStock) {
      await saveStockHistory(query.model, [previousStock], operation);
    }
  });
});

StockSchema.pre('updateMany', async function () {
  const query = this as Query<unknown, Stock>;
  const previousStocks = await query.model
    .find(query.getFilter())
    .lean<StockSnapshot[]>();

  await saveStockHistory(query.model, previousStocks, 'updateMany');
});
