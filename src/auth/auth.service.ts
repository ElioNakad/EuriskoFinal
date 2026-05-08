import { BadRequestException, Injectable } from '@nestjs/common';

import * as bcrypt from 'bcrypt';

import { RedisService } from '../redis/redis.service';
import { UsersService } from '../users/users.service';

import { RegisterDto } from './dto/register.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { SetPasswordDto } from './dto/set-password.dto';
import { MailService } from '../mail/mail.service';
@Injectable()
export class AuthService {
  constructor(
    private readonly redisService: RedisService,
    private readonly usersService: UsersService,
    private readonly mailService: MailService,
  ) {}

  async register(dto: RegisterDto) {
    const age = this.calculateAge(new Date(dto.dateOfBirth));

    if (age < 18) {
      throw new BadRequestException('User must be at least 18 years old');
    }

    const existingUser = await this.usersService.findByEmail(dto.email);

    if (existingUser) {
      throw new BadRequestException('Email already exists');
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    await this.redisService.set(
      `signup:${dto.email.toLowerCase()}`,
      {
        fullName: dto.fullName,
        email: dto.email.toLowerCase(),
        nationalId: dto.nationalId,
        dateOfBirth: dto.dateOfBirth,
        otp,
      },
      600,
    );

    await this.mailService.sendOtp(dto.email, otp);
    console.log('OTP:', otp);

    return {
      message: 'OTP sent successfully',
    };
  }

  async verifyOtp(dto: VerifyOtpDto) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const signupData = await this.redisService.get(
      `signup:${dto.email.toLowerCase()}`,
    );

    if (!signupData) {
      throw new BadRequestException('OTP expired or signup not found');
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    if (signupData.otp !== dto.otp) {
      throw new BadRequestException('Invalid OTP');
    }

    await this.redisService.set(
      `verified:${dto.email.toLowerCase()}`,
      signupData,
      600,
    );

    await this.redisService.delete(`signup:${dto.email.toLowerCase()}`);

    return {
      message: 'OTP verified successfully',
    };
  }

  async setPassword(dto: SetPasswordDto) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const verifiedData = await this.redisService.get(
      `verified:${dto.email.toLowerCase()}`,
    );

    if (!verifiedData) {
      throw new BadRequestException('Verification expired');
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);

    const user = await this.usersService.create({
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
      fullName: verifiedData.fullName,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
      email: verifiedData.email,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
      nationalId: verifiedData.nationalId,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      dateOfBirth: new Date(verifiedData.dateOfBirth),
      password: hashedPassword,
    });

    await this.redisService.delete(`verified:${dto.email.toLowerCase()}`);

    return {
      message: 'Account created successfully',
      userId: user._id,
    };
  }

  private calculateAge(dateOfBirth: Date): number {
    const today = new Date();

    let age = today.getFullYear() - dateOfBirth.getFullYear();

    const monthDiff = today.getMonth() - dateOfBirth.getMonth();

    if (
      monthDiff < 0 ||
      (monthDiff === 0 && today.getDate() < dateOfBirth.getDate())
    ) {
      age--;
    }

    return age;
  }
}
// eslint-disable-next-line @typescript-eslint/no-unused-expressions
('');
