import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { User, UserDocument } from './schemas/user.schema';
import {
  MemberAccountStatusAction,
  MemberAccountStatusLog,
  MemberAccountStatusLogDocument,
} from './schemas/member-account-status-log.schema';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(MemberAccountStatusLog.name)
    private readonly memberAccountStatusLogModel: Model<MemberAccountStatusLogDocument>,
  ) {}

  async create(data: Partial<User>): Promise<UserDocument> {
    const existingUser = await this.userModel.findOne({
      $or: [{ email: data.email }, { nationalId: data.nationalId }],
    });

    if (existingUser) {
      throw new ConflictException('Email or national ID already exists');
    }

    return this.userModel.create(data);
  }

  async findByEmail(email: string): Promise<UserDocument | null> {
    return this.userModel.findOne({
      email: email.toLowerCase(),
    });
  }

  async findById(userId: string): Promise<UserDocument | null> {
    return this.userModel.findById(userId);
  }

  async suspendMemberAccount(
    memberId: string,
    reason: string,
    performedByAdminId: string,
  ) {
    return this.setMemberAccountStatus({
      memberId,
      reason,
      performedByAdminId,
      action: 'suspend',
      newIsActive: false,
    });
  }

  async reinstateMemberAccount(
    memberId: string,
    reason: string,
    performedByAdminId: string,
  ) {
    return this.setMemberAccountStatus({
      memberId,
      reason,
      performedByAdminId,
      action: 'reinstate',
      newIsActive: true,
    });
  }

  private async setMemberAccountStatus(data: {
    memberId: string;
    reason: string;
    performedByAdminId: string;
    action: MemberAccountStatusAction;
    newIsActive: boolean;
  }) {
    if (
      !Types.ObjectId.isValid(data.memberId) ||
      !Types.ObjectId.isValid(data.performedByAdminId)
    ) {
      throw new BadRequestException('Invalid account id');
    }

    const reason = data.reason.trim();

    if (!reason) {
      throw new BadRequestException('Reason is required');
    }

    const user = await this.userModel.findById(data.memberId);

    if (!user) {
      throw new NotFoundException('Member account not found');
    }

    const previousIsActive = user.isActive;

    user.isActive = data.newIsActive;
    await user.save();

    const statusLog = await this.memberAccountStatusLogModel.create({
      memberId: user._id,
      action: data.action,
      reason,
      performedByAdminId: new Types.ObjectId(data.performedByAdminId),
      previousIsActive,
      newIsActive: data.newIsActive,
    });
    const statusLogWithTimestamps = statusLog as unknown as
      MemberAccountStatusLogDocument & {
        createdAt: Date;
      };

    return {
      message:
        data.action === 'suspend'
          ? 'Member account suspended successfully'
          : 'Member account reinstated successfully',
      member: {
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        isActive: user.isActive,
      },
      statusLog: {
        id: statusLog._id,
        action: statusLog.action,
        reason: statusLog.reason,
        performedByAdminId: statusLog.performedByAdminId,
        previousIsActive: statusLog.previousIsActive,
        newIsActive: statusLog.newIsActive,
        createdAt: statusLogWithTimestamps.createdAt,
      },
    };
  }
}
