import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AccountStatus } from '../../common/enums/account-status.enum';
import { ApprovalStatus } from '../../common/enums/approval-status.enum';
import { Role } from '../../common/enums/role.enum';
import { User } from '../../users/entities/user.entity';

@Injectable()
export class PortalApprovalGuard implements CanActivate {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const sessionUser = request.user;

    if (!sessionUser?.userId) {
      throw new ForbiddenException('user not found in request');
    }

    // 1. Admins bypass the approval guard
    if (sessionUser.role === Role.ADMIN) {
      return true;
    }

    // 2. Only enforce the strict portal approval check for management roles.
    // Other roles (Sales Reps, Shop Owners, etc.) are handled by their respective RolesGuard checks.
    const isManagerRole =
      sessionUser.role === Role.REGIONAL_MANAGER ||
      sessionUser.role === Role.TERRITORY_DISTRIBUTOR;

    if (!isManagerRole) {
      return true;
    }

    // 3. For Management roles, ensure they are both ACTIVE and APPROVED by an admin.
    const user = await this.usersRepository.findOne({
      where: {
        id: sessionUser.userId,
      },
    });

    if (
      !user ||
      user.accountStatus !== AccountStatus.ACTIVE ||
      user.approvalStatus !== ApprovalStatus.APPROVED
    ) {
      throw new ForbiddenException(
        'territory manager access is waiting for admin approval',
      );
    }

    return true;
  }
}
