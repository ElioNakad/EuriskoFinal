import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export enum AuditTrailAction {
  WalletManualAdjustment = 'wallet.manual_adjustment',
}

export type AuditTrailDocument = HydratedDocument<AuditTrail>;

@Schema({
  collection: 'audit_trail',
  timestamps: true,
})
export class AuditTrail {
  @Prop({
    type: Types.ObjectId,
    ref: 'CmsAccount',
    required: true,
    index: true,
  })
  actor_id!: Types.ObjectId;

  @Prop({ required: true, type: String, enum: AuditTrailAction, index: true })
  action!: AuditTrailAction;

  @Prop({ required: true, type: String, index: true })
  target_type!: string;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  target_id!: Types.ObjectId;

  @Prop({
    type: Types.ObjectId,
    ref: 'WalletTransaction',
    required: true,
    index: true,
  })
  wallet_transaction_id!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  reason!: string;

  @Prop({ type: Object, default: {} })
  metadata!: Record<string, unknown>;
}

export const AuditTrailSchema = SchemaFactory.createForClass(AuditTrail);
