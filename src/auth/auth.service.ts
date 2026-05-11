import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import * as bcrypt from 'bcrypt';

import { MailService } from '../mail/mail.service';
import { RedisService } from '../redis/redis.service';
import { UsersService } from '../users/users.service';
import { WalletsService } from '../wallets/wallets.service';
import { CmsService } from '../cms/cms.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { SetPasswordDto } from './dto/set-password.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';

interface SignupData {
  fullName: string;
  email: string;
  nationalId: string;
  dateOfBirth: string;
  otp: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly redisService: RedisService,
    private readonly usersService: UsersService,
    private readonly mailService: MailService,
    private readonly jwtService: JwtService,
    private readonly walletService: WalletsService,
    private readonly cmsService: CmsService,
  ) {}

  async register(dto: RegisterDto) {
    const age = this.calculateAge(new Date(dto.dateOfBirth));

    if (age < 18) {
      throw new BadRequestException('User must be at least 18 years old');
    }

    const existingUser = await this.usersService.findByEmail(dto.email);
    const existingCmsAccount = await this.cmsService.findByEmail(dto.email);

    if (existingUser || existingCmsAccount) {
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
    const signupData: unknown = await this.redisService.get(
      `signup:${dto.email.toLowerCase()}`,
    );

    if (!this.isSignupData(signupData)) {
      throw new BadRequestException('OTP expired or signup not found');
    }

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
    const verifiedData: unknown = await this.redisService.get(
      `verified:${dto.email.toLowerCase()}`,
    );

    if (!this.isSignupData(verifiedData)) {
      throw new BadRequestException('Verification expired');
    }

    const existingCmsAccount = await this.cmsService.findByEmail(dto.email);

    if (existingCmsAccount) {
      throw new BadRequestException('Email already exists');
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);

    const user = await this.usersService.create({
      fullName: verifiedData.fullName,
      email: verifiedData.email,
      nationalId: verifiedData.nationalId,
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

  private isSignupData(value: unknown): value is SignupData {
    if (!value || typeof value !== 'object') {
      return false;
    }

    const data = value as Record<keyof SignupData, unknown>;

    return (
      typeof data.fullName === 'string' &&
      typeof data.email === 'string' &&
      typeof data.nationalId === 'string' &&
      typeof data.dateOfBirth === 'string' &&
      typeof data.otp === 'string'
    );
  }

  async login(dto: LoginDto) {
    const user = await this.usersService.findByEmail(dto.email);

    if (user) {
      const passwordMatch = await bcrypt.compare(dto.password, user.password);

      if (!passwordMatch) {
        throw new UnauthorizedException('Invalid credentials');
      }

      const payload = {
        sub: user._id,
        email: user.email,
        role: user.role,
        accountType: 'member',
      };

      const accessToken = await this.jwtService.signAsync(payload);

      const hasWallet = await this.walletService.hasWallet(user._id.toString());
      return {
        message: 'Login successful',
        accessToken,
        requiresWalletFunding: !hasWallet,
        accountType: 'member',
        user: {
          id: user._id,
          fullName: user.fullName,
          email: user.email,
          role: user.role,
        },
      };
    }

    const cmsAccount = await this.cmsService.findByEmail(dto.email);

    if (!cmsAccount || !cmsAccount.isActive) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordMatch = await bcrypt.compare(
      dto.password,
      cmsAccount.password,
    );

    if (!passwordMatch) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const payload = {
      sub: cmsAccount._id,
      email: cmsAccount.email,
      role: cmsAccount.role,
      accountType: 'cms',
    };

    const accessToken = await this.jwtService.signAsync(payload);

    return {
      message: 'Login successful',
      accessToken,
      accountType: 'cms',
      user: {
        id: cmsAccount._id,
        fullName: cmsAccount.fullName,
        email: cmsAccount.email,
        role: cmsAccount.role,
        mustChangePassword: cmsAccount.mustChangePassword,
      },
    };
  }
}
