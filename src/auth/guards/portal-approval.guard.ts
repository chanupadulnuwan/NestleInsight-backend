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

    if (sessionUser.role === Role.ADMIN) {
      return true;
    }

    if (sessionUser.role !== Role.REGIONAL_MANAGER) {
      throw new ForbiddenException(
        'you do not have permission to access this resource',
      );
    }

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
