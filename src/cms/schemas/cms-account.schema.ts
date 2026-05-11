import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export const CMS_ROLES = [
  'super-admin',
  'administrator',
  'analyst',
  'support-agent',
] as const;

export type CmsRole = (typeof CMS_ROLES)[number];
export type CmsAccountDocument = CmsAccount & Document;

@Schema({ collection: 'cms_accounts', timestamps: true })
export class CmsAccount {
  @Prop({ required: true })
  fullName!: string;

  @Prop({
    required: true,
    unique: true,
    lowercase: true,
  })
  email!: string;

  @Prop({ required: true })
  password!: string;

  @Prop({ required: true, type: String, enum: CMS_ROLES })
  role!: CmsRole;

  @Prop({ default: true })
  isActive!: boolean;

  @Prop({ default: false })
  mustChangePassword!: boolean;
}

export const CmsAccountSchema = SchemaFactory.createForClass(CmsAccount);

CmsAccountSchema.index({ email: 1 });
