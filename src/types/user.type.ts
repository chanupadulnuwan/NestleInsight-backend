import { AccountStatus } from '../common/enums/account-status.enum';
import { ApprovalStatus } from '../common/enums/approval-status.enum';
import { Platform } from '../common/enums/platform.enum';
import { Role } from '../common/enums/role.enum';

export type UserType = {
  id: string;
  publicUserCode: string;
  firstName: string;
  lastName: string;
  username: string;
  email: string;
  phoneNumber: string;
  passwordHash: string;
  role: Role;
  platformAccess: Platform;
  accountStatus: AccountStatus;
  approvalStatus: ApprovalStatus;
  approvedBy?: string | null;
  approvedAt?: Date | null;
  rejectionReason?: string | null;
  isEmailVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
};
