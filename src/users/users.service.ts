import { ConflictException, Injectable } from '@nestjs/common';

import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { User, UserDocument } from './schemas/user.schema';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
  ) {}

  async create(data: Partial<User>) {
    const existingUser = await this.userModel.findOne({
      $or: [{ email: data.email }, { nationalId: data.nationalId }],
    });

    if (existingUser) {
      throw new ConflictException('Email or national ID already exists');
    }

    return this.userModel.create(data);
  }

  async findByEmail(email: string) {
    return this.userModel.findOne({
      email: email.toLowerCase(),
    });
  }
}
