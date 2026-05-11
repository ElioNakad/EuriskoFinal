import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export const MEMBER_ACCOUNT_STATUS_ACTIONS = ['suspend', 'reinstate'] as const;

export type MemberAccountStatusAction =
  (typeof MEMBER_ACCOUNT_STATUS_ACTIONS)[number];

export type MemberAccountStatusLogDocument = MemberAccountStatusLog & Document;

@Schema({ collection: 'member_account_status_logs', timestamps: true })
export class MemberAccountStatusLog {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  memberId!: Types.ObjectId;

  @Prop({ required: true, type: String, enum: MEMBER_ACCOUNT_STATUS_ACTIONS })
  action!: MemberAccountStatusAction;

  @Prop({ required: true, trim: true })
  reason!: string;

  @Prop({ type: Types.ObjectId, ref: 'CmsAccount', required: true, index: true })
  performedByAdminId!: Types.ObjectId;

  @Prop({ required: true })
  previousIsActive!: boolean;

  @Prop({ required: true })
  newIsActive!: boolean;
}

export const MemberAccountStatusLogSchema = SchemaFactory.createForClass(
  MemberAccountStatusLog,
);
