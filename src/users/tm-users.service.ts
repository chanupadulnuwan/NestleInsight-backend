import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { ActivityService } from '../activity/activity.service';
import { AccountStatus } from '../common/enums/account-status.enum';
import { ApprovalStatus } from '../common/enums/approval-status.enum';
import { Role } from '../common/enums/role.enum';
import { User } from './entities/user.entity';

const TM_APPROVABLE_ROLES = [Role.TERRITORY_DISTRIBUTOR, Role.SHOP_OWNER];

@Injectable()
export class TmUsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    private readonly activityService: ActivityService,
  ) {}

  async listPendingUsers(tmUserId: string) {
    const tm = await this.requireTm(tmUserId);

    const users = await this.usersRepo.find({
      where: {
        warehouseId: tm.warehouseId!,
        role: In(TM_APPROVABLE_ROLES),
        approvalStatus: ApprovalStatus.PENDING,
      },
      order: { createdAt: 'DESC' },
    });

    return {
      message: 'Pending users fetched.',
      users: users.map(this.serializeUser),
    };
  }

  async approveUser(tmUserId: string, targetUserId: string) {
    const tm = await this.requireTm(tmUserId);
    const user = await this.requireTargetUser(targetUserId, tm.warehouseId!);

    if (user.approvalStatus !== ApprovalStatus.PENDING) {
      throw new BadRequestException('Only pending users can be approved.');
    }

    const needsOtpAfterApproval = user.accountStatus === AccountStatus.OTP_PENDING;

    await this.usersRepo.update(targetUserId, {
      approvalStatus: ApprovalStatus.APPROVED,
      accountStatus: needsOtpAfterApproval ? AccountStatus.OTP_PENDING : AccountStatus.ACTIVE,
      approvedBy: tm.username,
      approvedAt: new Date(),
      rejectionReason: null,
    });

    await this.activityService.logForUser({
      userId: targetUserId,
      type: 'ACCOUNT_APPROVED',
      title: 'Account approved',
      message: needsOtpAfterApproval
        ? 'Your account has been approved by the territory manager. Verify your OTP to finish activation.'
        : 'Your account has been approved by the territory manager.',
      metadata: {
        approvedBy: tm.username,
        accountStatus: needsOtpAfterApproval
          ? AccountStatus.OTP_PENDING
          : AccountStatus.ACTIVE,
      },
    });

    return {
      message: needsOtpAfterApproval
        ? 'User approved. OTP verification is still required before login.'
        : 'User approved.',
    };
  }

  async rejectUser(tmUserId: string, targetUserId: string, reason: string) {
    const tm = await this.requireTm(tmUserId);
    const user = await this.requireTargetUser(targetUserId, tm.warehouseId!);

    if (user.approvalStatus === ApprovalStatus.REJECTED) {
      throw new BadRequestException('User is already rejected.');
    }

    await this.usersRepo.update(targetUserId, {
      approvalStatus: ApprovalStatus.REJECTED,
      accountStatus: AccountStatus.REJECTED,
      approvedBy: null,
      approvedAt: null,
      rejectionReason: reason,
    });

    await this.activityService.logForUser({
      userId: targetUserId,
      type: 'ACCOUNT_REJECTED',
      title: 'Account rejected',
      message: `Your account application has been rejected. Reason: ${reason}`,
      metadata: { reason },
    });

    return { message: 'User rejected.' };
  }

  private async requireTm(tmUserId: string) {
    const tm = await this.usersRepo.findOne({ where: { id: tmUserId } });
    if (!tm?.warehouseId) {
      throw new BadRequestException('You are not assigned to a warehouse.');
    }
    return tm;
  }

  private async requireTargetUser(targetUserId: string, warehouseId: string) {
    const user = await this.usersRepo.findOne({ where: { id: targetUserId } });
    if (!user) throw new NotFoundException('User not found.');

    if (!TM_APPROVABLE_ROLES.includes(user.role)) {
      throw new BadRequestException(
        'You can only approve/reject distributors and shop owners.',
      );
    }
    if (user.warehouseId !== warehouseId) {
      throw new BadRequestException('This user is not assigned to your warehouse.');
    }
    return user;
  }

  private serializeUser(u: User) {
    return {
      id: u.id,
      publicUserCode: u.publicUserCode,
      firstName: u.firstName,
      lastName: u.lastName,
      username: u.username,
      email: u.email,
      phoneNumber: u.phoneNumber,
      role: u.role,
      accountStatus: u.accountStatus,
      approvalStatus: u.approvalStatus,
      shopName: u.shopName,
      address: u.address,
      createdAt: u.createdAt,
    };
  }
}
