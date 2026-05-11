import { ConflictException, Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { randomBytes } from 'crypto';
import { Model } from 'mongoose';

import * as bcrypt from 'bcrypt';

import { MailService } from '../mail/mail.service';
import { UsersService } from '../users/users.service';
import { CreateCmsAccountDto } from './dto/create-cms-account.dto';
import { CmsAccount, CmsAccountDocument } from './schemas/cms-account.schema';

@Injectable()
export class CmsService implements OnModuleInit {
  constructor(
    @InjectModel(CmsAccount.name)
    private readonly cmsAccountModel: Model<CmsAccountDocument>,
    private readonly mailService: MailService,
    private readonly usersService: UsersService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.seedSuperAdmin();
  }

  async findByEmail(email: string): Promise<CmsAccountDocument | null> {
    return this.cmsAccountModel.findOne({
      email: email.toLowerCase(),
    });
  }

  async createCmsUser(dto: CreateCmsAccountDto) {
    const email = dto.email.toLowerCase();
    const existingCmsAccount = await this.findByEmail(email);
    const existingMember = await this.usersService.findByEmail(email);

    if (existingCmsAccount || existingMember) {
      throw new ConflictException('Email already exists');
    }

    const temporaryPassword = this.generateTemporaryPassword();
    const hashedPassword = await bcrypt.hash(temporaryPassword, 10);

    const cmsAccount = await this.cmsAccountModel.create({
      email,
      fullName: dto.fullName,
      role: dto.role,
      password: hashedPassword,
      mustChangePassword: true,
    });

    await this.mailService.sendCmsTemporaryPassword(
      email,
      dto.fullName,
      temporaryPassword,
    );

    return {
      message: 'CMS account created successfully',
      cmsUser: {
        id: cmsAccount._id,
        fullName: cmsAccount.fullName,
        email: cmsAccount.email,
        role: cmsAccount.role,
        mustChangePassword: cmsAccount.mustChangePassword,
      },
    };
  }

  private async seedSuperAdmin(): Promise<void> {
    const email = 'omar@gmail.com';
    const existingAccount = await this.findByEmail(email);

    if (existingAccount) {
      return;
    }

    const hashedPassword = await bcrypt.hash('Pass1234', 10);

    await this.cmsAccountModel.create({
      fullName: 'Omar',
      email,
      password: hashedPassword,
      role: 'super-admin',
      mustChangePassword: false,
    });
  }

  private generateTemporaryPassword(): string {
    return randomBytes(9).toString('base64url');
  }
}
