import { Injectable, InternalServerErrorException } from '@nestjs/common';

import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

@Injectable()
export class MailService {
  private readonly transporter: Transporter;

  constructor() {
    this.transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL,
        pass: process.env.EMAIL_PASS,
      },
    });
  }

  async sendOtp(email: string, otp: string): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: process.env.EMAIL,
        to: email,
        subject: 'Your OTP Code',
        text: `Your OTP is ${otp}`,
      });
    } catch (error) {
      throw new InternalServerErrorException('Failed to send OTP email', {
        cause: error,
      });
    }
  }

  async sendPaymentSuccess(email: string, amount: number): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: process.env.EMAIL,
        to: email,
        subject: 'Wallet Payment Successful',
        text: `Your wallet payment was completed successfully with the amount of $${amount}.`,
      });
    } catch (error) {
      throw new InternalServerErrorException(
        'Failed to send payment success email',
        {
          cause: error,
        },
      );
    }
  }

  async sendTradeConfirmation(
    email: string,
    side: 'buy' | 'sell',
    ticker: string,
    numberOfShares: number,
    pricePerShare: number,
    totalAmount: number,
  ): Promise<void> {
    const tradeSide = side === 'buy' ? 'Buy' : 'Sell';

    try {
      await this.transporter.sendMail({
        from: process.env.EMAIL,
        to: email,
        subject: `${tradeSide} Trade Confirmation - ${ticker}`,
        text: `Your ${side} order for ${numberOfShares} share(s) of ${ticker} was filled at $${pricePerShare} per share for a total of $${totalAmount}.`,
      });
    } catch (error) {
      throw new InternalServerErrorException(
        'Failed to send trade confirmation email',
        {
          cause: error,
        },
      );
    }
  }

  async sendWithdrawalApproved(email: string, amount: number): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: process.env.EMAIL,
        to: email,
        subject: 'Withdrawal Approved',
        text: `We transferred $${amount} to your bank account.`,
      });
    } catch (error) {
      throw new InternalServerErrorException(
        'Failed to send withdrawal approval email',
        {
          cause: error,
        },
      );
    }
  }

  async sendWithdrawalRejected(email: string, amount: number): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: process.env.EMAIL,
        to: email,
        subject: 'Withdrawal Not Accepted',
        text: `Your withdrawal request for $${amount} was not accepted.`,
      });
    } catch (error) {
      throw new InternalServerErrorException(
        'Failed to send withdrawal rejection email',
        {
          cause: error,
        },
      );
    }
  }

  async sendStockAlertTriggered(
    email: string,
    ticker: string,
    direction: string,
    thresholdPrice: number,
    triggeredPrice: number,
  ): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: process.env.EMAIL,
        to: email,
        subject: `Stock alert triggered for ${ticker}`,
        text: `${ticker} crossed ${direction} your $${thresholdPrice} alert. Current price: $${triggeredPrice}.`,
      });
    } catch (error) {
      throw new InternalServerErrorException(
        'Failed to send stock alert email',
        {
          cause: error,
        },
      );
    }
  }

  async sendCmsTemporaryPassword(
    email: string,
    fullName: string,
    temporaryPassword: string,
  ): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: process.env.EMAIL,
        to: email,
        subject: 'Your CMS account temporary password',
        text: `Hello ${fullName}, your CMS account has been created. Your temporary password is ${temporaryPassword}`,
      });
    } catch (error) {
      throw new InternalServerErrorException(
        'Failed to send CMS temporary password email',
        {
          cause: error,
        },
      );
    }
  }
}
