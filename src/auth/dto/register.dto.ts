import { IsDateString, IsEmail, IsString } from 'class-validator';

export class RegisterDto {
  @IsString()
  fullName!: string;

  @IsEmail()
  email!: string;

  @IsString()
  nationalId!: string;

  @IsDateString()
  dateOfBirth!: string;
}
