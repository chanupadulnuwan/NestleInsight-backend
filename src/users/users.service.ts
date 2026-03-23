import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AccountStatus } from '../common/enums/account-status.enum';
import { ApprovalStatus } from '../common/enums/approval-status.enum';
import { Role } from '../common/enums/role.enum';
import { User } from './entities/user.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
  ) {}

  async create(userData: Partial<User>): Promise<User> {
    const user = this.usersRepository.create(userData);
    return this.usersRepository.save(user);
  }

  async findById(id: string): Promise<User | null> {
    return this.usersRepository.findOne({ where: { id } });
  }

  async findByUsername(username: string): Promise<User | null> {
    return this.usersRepository.findOne({ where: { username } });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.usersRepository.findOne({ where: { email } });
  }

  async findByPhoneNumber(phoneNumber: string): Promise<User | null> {
    return this.usersRepository.findOne({ where: { phoneNumber } });
  }

  async findByEmployeeId(employeeId: string): Promise<User | null> {
    return this.usersRepository.findOne({ where: { employeeId } });
  }

  async findByNic(nic: string): Promise<User | null> {
    return this.usersRepository.findOne({ where: { nic } });
  }

  async findByIdentifier(identifier: string): Promise<User | null> {
    return this.usersRepository
      .createQueryBuilder('user')
      .where('user.username = :identifier', { identifier })
      .orWhere('user.email = :identifier', { identifier })
      .getOne();
  }

  async findPendingUsersSafe() {
    const users = await this.usersRepository.find({
      where: {
        accountStatus: AccountStatus.PENDING,
        approvalStatus: ApprovalStatus.PENDING,
      },
      order: {
        createdAt: 'DESC',
      },
    });

    return {
      message: 'pending users fetched successfully',
      users: users.map((user) => this.sanitizeUser(user)),
    };
  }

  async approveUser(userId: string, adminUsername: string) {
    const user = await this.findById(userId);

    if (!user) {
      throw new NotFoundException('user not found');
    }

    if (
      user.accountStatus !== AccountStatus.PENDING ||
      user.approvalStatus !== ApprovalStatus.PENDING
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

    user.approvalStatus = ApprovalStatus.APPROVED;
    user.accountStatus = AccountStatus.OTP_PENDING;
    user.approvedBy = adminUsername;
    user.approvedAt = new Date();
    user.rejectionReason = null;

    if (!user.publicUserCode) {
      user.publicUserCode = this.generatePublicUserCode(user.role);
    }

    const savedUser = await this.usersRepository.save(user);

    return {
      message: 'user approved successfully. OTP verification is the next step.',
      user: this.sanitizeUser(savedUser),
    };
  }

  async rejectUser(userId: string, rejectionReason: string) {
    const user = await this.findById(userId);

    if (!user) {
      throw new NotFoundException('user not found');
    }

    if (
      user.accountStatus !== AccountStatus.PENDING ||
      user.approvalStatus !== ApprovalStatus.PENDING
    ) {
      throw new BadRequestException('only pending users can be rejected');
    }

    user.approvalStatus = ApprovalStatus.REJECTED;
    user.accountStatus = AccountStatus.REJECTED;
    user.rejectionReason = rejectionReason;
    user.approvedBy = null;
    user.approvedAt = null;

    const savedUser = await this.usersRepository.save(user);

    return {
      message: 'user rejected successfully',
      user: this.sanitizeUser(savedUser),
    };
  }

  private sanitizeUser(user: User) {
    const { passwordHash, ...safeUser } = user;
    return safeUser;
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