import { IsEmail, IsIn, IsString } from 'class-validator';

import { CMS_ROLES, CmsRole } from '../schemas/cms-account.schema';

const CREATABLE_CMS_ROLES = CMS_ROLES.filter((role) => role !== 'super-admin');

export class CreateCmsAccountDto {
  @IsEmail()
  email!: string;

  @IsString()
  fullName!: string;

  @IsIn(CREATABLE_CMS_ROLES)
  role!: Exclude<CmsRole, 'super-admin'>;
}
