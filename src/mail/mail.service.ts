/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Injectable } from '@nestjs/common';

import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private transporter;

  constructor() {
    this.transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL,
        pass: process.env.EMAIL_PASS,
      },
    });
    console.log(process.env.EMAIL);
    console.log(process.env.EMAIL_PASS);
  }

  async sendOtp(email: string, otp: string) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      const info = await this.transporter.sendMail({
        from: process.env.EMAIL,
        to: email,
        subject: 'Your OTP Code',
        text: `Your OTP is ${otp}`,
      });

      console.log(info);
    } catch (error) {
      console.log(error);
    }
  }
}
