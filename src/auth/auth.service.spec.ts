import { BadRequestException, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

import { AccountStatus } from '../common/enums/account-status.enum';
import { ApprovalStatus } from '../common/enums/approval-status.enum';
import { Platform } from '../common/enums/platform.enum';
import { Role } from '../common/enums/role.enum';
import { UsersService } from '../users/users.service';
import { RegisterDto } from './dto/register.dto';

@Injectable()
export class AuthService {
  constructor(private readonly usersService: UsersService) {}

  async register(registerDto: RegisterDto) {
    const {
      firstName,
      lastName,
      username,
      email,
      phoneNumber,
      password,
      confirmPassword,
      role,
      platformAccess,
      employeeId,
      nic,
      shopName,
      warehouseName,
      latitude,
      longitude,
    } = registerDto;

    if (password !== confirmPassword) {
      throw new BadRequestException('password and confirmPassword do not match');
    }

    if (role === Role.ADMIN) {
      throw new BadRequestException('admin cannot register from public signup');
    }

    this.validateRolePlatform(role, platformAccess);
    this.validateRoleSpecificFields(registerDto);

    const existingUsername = await this.usersService.findByUsername(username);
    if (existingUsername) {
      throw new BadRequestException('username is already taken');
    }

    const existingEmail = await this.usersService.findByEmail(email);
    if (existingEmail) {
      throw new BadRequestException('email is already registered');
    }

    const existingPhone = await this.usersService.findByPhoneNumber(phoneNumber);
    if (existingPhone) {
      throw new BadRequestException('phone number is already registered');
    }

    if (employeeId) {
      const existingEmployeeId =
        await this.usersService.findByEmployeeId(employeeId);
      if (existingEmployeeId) {
        throw new BadRequestException('employee ID is already assigned');
      }
    }

    if (nic) {
      const existingNic = await this.usersService.findByNic(nic);
      if (existingNic) {
        throw new BadRequestException('NIC is already assigned');
      }
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const needsAdminApproval = [
      Role.SALES_REP,
      Role.TERRITORY_DISTRIBUTOR,
      Role.DEMAND_PLANNER,
      Role.REGIONAL_MANAGER,
    ].includes(role);

    const user = await this.usersService.create({
      firstName,
      lastName,
      username,
      email,
      phoneNumber,
      passwordHash,
      employeeId: employeeId ?? null,
      nic: nic ?? null,
      shopName: shopName ?? null,
      warehouseName: warehouseName ?? null,
      latitude: latitude ?? null,
      longitude: longitude ?? null,
      role,
      platformAccess,
      accountStatus: needsAdminApproval
        ? AccountStatus.PENDING
        : AccountStatus.OTP_PENDING,
      approvalStatus: needsAdminApproval
        ? ApprovalStatus.PENDING
        : ApprovalStatus.APPROVED,
      publicUserCode: null,
      approvedBy: null,
      approvedAt: null,
      rejectionReason: null,
      isEmailVerified: false,
    });

    const { passwordHash: _, ...safeUser } = user;

    return {
      message: needsAdminApproval
        ? 'Registration submitted successfully. Waiting for admin approval.'
        : 'Registration successful. OTP verification will be required next.',
      user: safeUser,
    };
  }

  private validateRolePlatform(role: Role, platformAccess: Platform): void {
    if (
      [Role.SALES_REP, Role.TERRITORY_DISTRIBUTOR, Role.SHOP_OWNER].includes(
        role,
      ) &&
      platformAccess !== Platform.MOBILE
    ) {
      throw new BadRequestException('this role can only access the mobile app');
    }

    if (
      [Role.DEMAND_PLANNER, Role.REGIONAL_MANAGER].includes(role) &&
      platformAccess !== Platform.WEB
    ) {
      throw new BadRequestException('this role can only access the web system');
    }
  }

  private validateRoleSpecificFields(registerDto: RegisterDto): void {
    const {
      role,
      employeeId,
      nic,
      shopName,
      warehouseName,
      latitude,
      longitude,
    } = registerDto;

    if (
      [Role.SALES_REP, Role.TERRITORY_DISTRIBUTOR, Role.DEMAND_PLANNER].includes(
        role,
      ) &&
      !employeeId &&
      !nic
    ) {
      throw new BadRequestException(
        'employeeId or nic is required for this role',
      );
    }

    if (role === Role.REGIONAL_MANAGER) {
      if (!employeeId && !nic) {
        throw new BadRequestException(
          'employeeId or nic is required for regional manager',
        );
      }

      if (!warehouseName) {
        throw new BadRequestException(
          'warehouseName is required for regional manager',
        );
      }

      if (latitude === undefined || longitude === undefined) {
        throw new BadRequestException(
          'warehouse location is required for regional manager',
        );
      }
    }

    if (role === Role.SHOP_OWNER) {
      if (!shopName) {
        throw new BadRequestException('shopName is required for shop owner');
      }

      if (latitude === undefined || longitude === undefined) {
        throw new BadRequestException(
          'shop location is required for shop owner',
        );
      }
    }
  }
}