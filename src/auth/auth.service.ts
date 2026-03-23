import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';

import { AccountStatus } from '../common/enums/account-status.enum';
import { ApprovalStatus } from '../common/enums/approval-status.enum';
import { Platform } from '../common/enums/platform.enum';
import { Role } from '../common/enums/role.enum';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) { }

  async login(loginDto: LoginDto) {
    const { identifier, password } = loginDto;

    const user =
      (await this.usersService.findByEmail(identifier)) ||
      (await this.usersService.findByUsername(identifier)) ||
      (await this.usersService.findByPhoneNumber(identifier));

    if (!user) {
      throw new UnauthorizedException('invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);

    if (!isPasswordValid) {
      throw new UnauthorizedException('invalid credentials');
    }

    if (user.accountStatus === AccountStatus.PENDING) {
      throw new BadRequestException('account is still waiting for admin approval');
    }

    if (user.accountStatus === AccountStatus.REJECTED) {
      throw new BadRequestException('account registration was rejected');
    }

    if (user.accountStatus === AccountStatus.SUSPENDED) {
      throw new BadRequestException('account is suspended');
    }

    if (user.accountStatus === AccountStatus.OTP_PENDING) {
      throw new BadRequestException('account requires OTP verification');
    }

    if (user.accountStatus !== AccountStatus.ACTIVE) {
      throw new BadRequestException('account is not active');
    }

    const payload = {
      sub: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      platformAccess: user.platformAccess,
    };

    const accessToken = await this.jwtService.signAsync(payload);

    const { passwordHash: _, ...safeUser } = user;

    return {
      message: 'login successful',
      accessToken,
      user: safeUser,
    };
  }

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
      throw new BadRequestException(
        'password and confirmPassword do not match',
      );
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

    const existingPhone =
      await this.usersService.findByPhoneNumber(phoneNumber);
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
      [
        Role.SALES_REP,
        Role.TERRITORY_DISTRIBUTOR,
        Role.DEMAND_PLANNER,
      ].includes(role) &&
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