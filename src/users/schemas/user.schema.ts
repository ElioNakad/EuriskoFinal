import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type UserDocument = User & Document;

@Schema({ timestamps: true })
export class User {
  @Prop({ required: true })
  fullName!: string;

  @Prop({
    required: true,
    unique: true,
    lowercase: true,
  })
  email!: string;

  @Prop({
    required: true,
    unique: true,
  })
  nationalId!: string;

  @Prop({ required: true })
  dateOfBirth!: Date;

  @Prop({ required: true })
  password!: string;

  @Prop({ default: 'member' })
  role!: string;

  @Prop({ default: true })
  isActive!: boolean;

  @Prop()
  lastTradingActivityAt?: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);

UserSchema.index({ email: 1 });
UserSchema.index({ nationalId: 1 });
