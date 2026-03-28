import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { ActivityService } from '../activity/activity.service';
import { AccountStatus } from '../common/enums/account-status.enum';
import { ApprovalStatus } from '../common/enums/approval-status.enum';
import { Role } from '../common/enums/role.enum';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import { User } from './entities/user.entity';

type AdminActor = {
  userId?: string | null;
  username?: string | null;
};

const MANAGEABLE_ROLES = [
  Role.SHOP_OWNER,
  Role.TERRITORY_DISTRIBUTOR,
  Role.REGIONAL_MANAGER,
];

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    private readonly activityService: ActivityService,
  ) {}

  async create(userData: Partial<User>): Promise<User> {
    const user = this.usersRepository.create(userData);
    return this.usersRepository.save(user);
  }

  async save(user: User): Promise<User> {
    return this.usersRepository.save(user);
  }

  async findById(id: string): Promise<User | null> {
    return this.usersRepository.findOne({
      where: { id },
      relations: {
        territory: true,
        warehouse: true,
      },
    });
  }

  async findByUsername(username: string): Promise<User | null> {
    return this.usersRepository.findOne({
      where: { username },
      relations: {
        territory: true,
        warehouse: true,
      },
    });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.usersRepository.findOne({
      where: { email },
      relations: {
        territory: true,
        warehouse: true,
      },
    });
  }

  async findByPhoneNumber(phoneNumber: string): Promise<User | null> {
    return this.usersRepository.findOne({
      where: { phoneNumber },
      relations: {
        territory: true,
        warehouse: true,
      },
    });
  }

  async findByEmployeeId(employeeId: string): Promise<User | null> {
    return this.usersRepository.findOne({
      where: { employeeId },
      relations: {
        territory: true,
        warehouse: true,
      },
    });
  }

  async findByNic(nic: string): Promise<User | null> {
    return this.usersRepository.findOne({
      where: { nic },
      relations: {
        territory: true,
        warehouse: true,
      },
    });
  }

  async findTmsByWarehouseId(warehouseId: string): Promise<User[]> {
    return this.usersRepository.find({
      where: { warehouseId, role: Role.REGIONAL_MANAGER },
      select: ['id'],
    });
  }

  async findByIdentifier(identifier: string): Promise<User | null> {
    return this.usersRepository
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.territory', 'territory')
      .leftJoinAndSelect('user.warehouse', 'warehouse')
      .where('user.username = :identifier', { identifier })
      .orWhere('user.email = :identifier', { identifier })
      .orWhere('user.phoneNumber = :identifier', { identifier })
      .getOne();
  }

  async findPendingUsersSafe() {
    const users = await this.usersRepository
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.territory', 'territory')
      .leftJoinAndSelect('user.warehouse', 'warehouse')
      .where('user.approvalStatus = :approvalStatus', {
        approvalStatus: ApprovalStatus.PENDING,
      })
      .andWhere('user.accountStatus IN (:...accountStatuses)', {
        accountStatuses: [AccountStatus.PENDING, AccountStatus.ACTIVE],
      })
      .orderBy('user.createdAt', 'DESC')
      .getMany();

    return {
      message: 'pending users fetched successfully',
      users: users.map((user) => this.sanitizeUser(user)),
    };
  }

  async findManageableUsersSafe() {
    const users = await this.usersRepository.find({
      where: {
        role: In(MANAGEABLE_ROLES),
      },
      relations: {
        territory: true,
        warehouse: true,
      },
      order: {
        role: 'ASC',
        firstName: 'ASC',
        lastName: 'ASC',
      },
    });

    return {
      message: 'manageable users fetched successfully',
      users: users.map((user) => this.sanitizeUser(user)),
    };
  }

  async approveUser(userId: string, adminActor: AdminActor) {
    const user = await this.findById(userId);

    if (!user) {
      throw new NotFoundException('user not found');
    }

    if (user.approvalStatus !== ApprovalStatus.PENDING) {
      throw new BadRequestException('only pending users can be approved');
    }

    if (
      ![AccountStatus.PENDING, AccountStatus.ACTIVE].includes(
        user.accountStatus,
      )
    ) {
      throw new BadRequestException('only pending users can be approved');
    }

    if (
      ![
        Role.SALES_REP,
        Role.TERRITORY_DISTRIBUTOR,
        Role.DEMAND_PLANNER,
        Role.REGIONAL_MANAGER,
      ].includes(user.role)
    ) {
      throw new BadRequestException(
        'this user type does not require admin approval',
      );
    }

    const needsOtpAfterApproval = user.accountStatus === AccountStatus.PENDING;

    user.approvalStatus = ApprovalStatus.APPROVED;
    user.accountStatus = needsOtpAfterApproval
      ? AccountStatus.OTP_PENDING
      : AccountStatus.ACTIVE;
    user.approvedBy = adminActor.username ?? 'admin';
    user.approvedAt = new Date();
    user.rejectionReason = null;

    if (!user.publicUserCode) {
      user.publicUserCode = this.generatePublicUserCode(user.role);
    }

    const savedUser = await this.usersRepository.save(user);

    await this.activityService.logForUser({
      userId: savedUser.id,
      type: 'ACCOUNT_APPROVED',
      title: 'Account approved',
      message: needsOtpAfterApproval
        ? 'Your account moved from pending approval to OTP verification.'
        : 'Your account has been approved and is now fully active.',
      metadata: {
        accountStatus: savedUser.accountStatus,
        approvalStatus: savedUser.approvalStatus,
      },
    });
    await this.logAdminAudit(savedUser, adminActor, 'approved', {
      nextStatus: savedUser.accountStatus,
      approvalStatus: savedUser.approvalStatus,
    });

    return {
      message: needsOtpAfterApproval
        ? 'user approved successfully. OTP verification is the next step.'
        : 'user approved successfully. Full web portal access is now active.',
      user: this.sanitizeUser(savedUser),
    };
  }

  async rejectUser(
    userId: string,
    rejectionReason: string,
    adminActor?: AdminActor,
  ) {
    const user = await this.findById(userId);

    if (!user) {
      throw new NotFoundException('user not found');
    }

    if (user.approvalStatus !== ApprovalStatus.PENDING) {
      throw new BadRequestException('only pending users can be rejected');
    }

    if (
      ![
        AccountStatus.PENDING,
        AccountStatus.OTP_PENDING,
        AccountStatus.ACTIVE,
      ].includes(user.accountStatus)
    ) {
      throw new BadRequestException('only pending users can be rejected');
    }

    user.approvalStatus = ApprovalStatus.REJECTED;
    user.accountStatus = AccountStatus.REJECTED;
    user.rejectionReason = rejectionReason;
    user.approvedBy = null;
    user.approvedAt = null;

    const savedUser = await this.usersRepository.save(user);

    await this.activityService.logForUser({
      userId: savedUser.id,
      type: 'ACCOUNT_REJECTED',
      title: 'Account rejected',
      message: 'Your registration was rejected by an administrator.',
      metadata: {
        rejectionReason: savedUser.rejectionReason,
      },
    });
    await this.logAdminAudit(savedUser, adminActor, 'rejected', {
      nextStatus: savedUser.accountStatus,
      rejectionReason: savedUser.rejectionReason,
    });

    return {
      message: 'user rejected successfully',
      user: this.sanitizeUser(savedUser),
    };
  }

  async updateUserStatus(
    userId: string,
    updateUserStatusDto: UpdateUserStatusDto,
    adminActor: AdminActor,
  ) {
    const user = await this.findById(userId);

    if (!user) {
      throw new NotFoundException('user not found');
    }

    this.ensureManageableUser(user);

    if (user.accountStatus === AccountStatus.PENDING) {
      throw new BadRequestException(
        'pending users must be handled from the approval panel',
      );
    }

    if (
      ![
        AccountStatus.ACTIVE,
        AccountStatus.SUSPENDED,
        AccountStatus.REJECTED,
      ].includes(updateUserStatusDto.status)
    ) {
      throw new BadRequestException('unsupported status update request');
    }

    if (user.accountStatus === updateUserStatusDto.status) {
      throw new BadRequestException('user already has this status');
    }

    const reason = updateUserStatusDto.reason?.trim() ?? '';
    const requiresReason =
      updateUserStatusDto.status === AccountStatus.SUSPENDED ||
      updateUserStatusDto.status === AccountStatus.REJECTED;

    if (requiresReason && !reason) {
      throw new BadRequestException(
        'a reason is required when rejecting or deactivating a user',
      );
    }

    if (updateUserStatusDto.status === AccountStatus.ACTIVE) {
      user.accountStatus = AccountStatus.ACTIVE;
      user.approvalStatus = ApprovalStatus.APPROVED;
      user.rejectionReason = null;
      user.approvedBy = user.approvedBy ?? adminActor.username ?? 'admin';
      user.approvedAt = user.approvedAt ?? new Date();

      if (!user.publicUserCode) {
        user.publicUserCode = this.generatePublicUserCode(user.role);
      }
    }

    if (updateUserStatusDto.status === AccountStatus.SUSPENDED) {
      user.accountStatus = AccountStatus.SUSPENDED;
      user.rejectionReason = reason;
    }

    if (updateUserStatusDto.status === AccountStatus.REJECTED) {
      user.accountStatus = AccountStatus.REJECTED;
      user.approvalStatus = ApprovalStatus.REJECTED;
      user.rejectionReason = reason;
    }

    const savedUser = await this.usersRepository.save(user);
    const activityCopy = this.getStatusActivityCopy(savedUser.accountStatus);

    await this.activityService.logForUser({
      userId: savedUser.id,
      type: activityCopy.type,
      title: activityCopy.title,
      message: activityCopy.message,
      metadata: {
        accountStatus: savedUser.accountStatus,
        approvalStatus: savedUser.approvalStatus,
        reason: requiresReason ? reason : null,
      },
    });

    await this.logAdminAudit(savedUser, adminActor, activityCopy.auditVerb, {
      nextStatus: savedUser.accountStatus,
      approvalStatus: savedUser.approvalStatus,
      reason: requiresReason ? reason : null,
    });

    return {
      message: `user status updated to ${savedUser.accountStatus.toLowerCase()}`,
      user: this.sanitizeUser(savedUser),
    };
  }

  private sanitizeUser(user: User) {
    const {
      passwordHash: _passwordHash,
      otpCodeHash: _otpCodeHash,
      otpExpiresAt: _otpExpiresAt,
      otpLastSentAt: _otpLastSentAt,
      territory,
      warehouse,
      ...safeUser
    } = user;

    return {
      ...safeUser,
      territoryId: user.territoryId,
      territoryName: territory?.name ?? null,
      territory: territory?.name ?? null,
      warehouseId: user.warehouseId,
      warehouseName: warehouse?.name ?? user.warehouseName,
    };
  }

  private ensureManageableUser(user: User) {
    if (!MANAGEABLE_ROLES.includes(user.role)) {
      throw new BadRequestException(
        'this user is not available in user management',
      );
    }
  }

  private getStatusActivityCopy(nextStatus: AccountStatus) {
    if (nextStatus === AccountStatus.ACTIVE) {
      return {
        type: 'ACCOUNT_ACTIVATED',
        title: 'Account activated',
        message: 'An administrator activated your account.',
        auditVerb: 'activated',
      };
    }

    if (nextStatus === AccountStatus.SUSPENDED) {
      return {
        type: 'ACCOUNT_DEACTIVATED',
        title: 'Account deactivated',
        message: 'An administrator deactivated your account.',
        auditVerb: 'deactivated',
      };
    }

    return {
      type: 'ACCOUNT_REJECTED',
      title: 'Account rejected',
      message: 'An administrator rejected your account.',
      auditVerb: 'rejected',
    };
  }

  private async logAdminAudit(
    user: User,
    adminActor: AdminActor | undefined,
    action: string,
    metadata?: Record<string, unknown>,
  ) {
    if (!adminActor?.userId) {
      return;
    }

    await this.activityService.logForUser({
      userId: adminActor.userId,
      type: 'USER_STATUS_CHANGED',
      title: 'User updated',
      message: `${user.firstName} ${user.lastName} was ${action}.`,
      metadata: {
        targetUserId: user.id,
        targetUsername: user.username,
        targetRole: user.role,
        ...metadata,
      },
    });
  }

  private generatePublicUserCode(role: Role): string {
    const prefixMap: Record<Role, string> = {
      [Role.ADMIN]: 'ADM',
      [Role.SALES_REP]: 'SR',
      [Role.TERRITORY_DISTRIBUTOR]: 'TD',
      [Role.SHOP_OWNER]: 'SO',
      [Role.DEMAND_PLANNER]: 'DP',
      [Role.REGIONAL_MANAGER]: 'RM',
    };

    const prefix = prefixMap[role] ?? 'USR';
    const timePart = Date.now().toString().slice(-6);
    const randomPart = Math.floor(1000 + Math.random() * 9000);

    return `${prefix}-${timePart}${randomPart}`;
  }
}
