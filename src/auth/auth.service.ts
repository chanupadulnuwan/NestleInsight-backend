import {
  BadRequestException,
  InternalServerErrorException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';

import { ActivityService } from '../activity/activity.service';
import { AccountStatus } from '../common/enums/account-status.enum';
import { ApprovalStatus } from '../common/enums/approval-status.enum';
import { Platform } from '../common/enums/platform.enum';
import { Role } from '../common/enums/role.enum';
import { findNearestLocation } from '../common/utils/location-assignment.util';
import { Territory } from '../territories/entities/territory.entity';
import { User } from '../users/entities/user.entity';
import { Warehouse } from '../warehouses/entities/warehouse.entity';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
import { OtpDeliveryMethod, OtpEmailService } from './otp-email.service';
import { RequestOtpDto } from './dto/request-otp.dto';
import { RegisterDto } from './dto/register.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';

@Injectable()
export class AuthService {
  private static readonly otpTtlMs = 10 * 60 * 1000;

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly otpEmailService: OtpEmailService,
    private readonly activityService: ActivityService,
    @InjectRepository(Territory)
    private readonly territoriesRepository: Repository<Territory>,
    @InjectRepository(Warehouse)
    private readonly warehousesRepository: Repository<Warehouse>,
  ) { }

  async login(loginDto: LoginDto) {
    const { identifier, password, platformAccess } = loginDto;
    const user = await this.findUserByIdentifier(identifier);

    if (!user) {
      throw new UnauthorizedException('invalid credentials');
    }

    // Website portal update: when the web client sends WEB access, block accounts that only belong on the mobile app.
    if (platformAccess && user.platformAccess !== platformAccess) {
      throw new BadRequestException(
        platformAccess === Platform.WEB
          ? 'this account cannot access the web portal'
          : 'this account cannot access the mobile app',
      );
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);

    if (!isPasswordValid) {
      throw new UnauthorizedException('invalid credentials');
    }

    if (user.accountStatus === AccountStatus.PENDING) {
      throw new BadRequestException(
        'account is still waiting for admin approval',
      );
    }

    if (user.accountStatus === AccountStatus.REJECTED) {
      throw new BadRequestException('account registration was rejected');
    }

    if (user.accountStatus === AccountStatus.SUSPENDED) {
      throw new BadRequestException('account is suspended');
    }

    if (user.accountStatus === AccountStatus.OTP_PENDING) {
      throw new BadRequestException({
        message: 'account requires OTP verification',
        code: 'OTP_REQUIRED',
      });
    }

    if (user.accountStatus !== AccountStatus.ACTIVE) {
      throw new BadRequestException('account is not active');
    }

    if (user.approvalStatus === ApprovalStatus.PENDING) {
      throw new BadRequestException(this.getPendingApprovalMessage(user));
    }

    const accessToken = await this.createAccessToken(user);

    await this.activityService.logForUser({
      userId: user.id,
      type: 'LOGIN',
      title: 'Logged in',
      // Website portal update: keep activity text accurate for both web and mobile logins.
      message:
        user.platformAccess === Platform.WEB
          ? 'You signed in to the web portal successfully.'
          : 'You signed in to the mobile app successfully.',
    });

    return {
      message: 'login successful',
      accessToken,
      user: this.sanitizeUser(user),
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
      address,
      warehouseName,
      latitude,
      longitude,
    } = registerDto;

    if (password !== confirmPassword) {
      throw new BadRequestException(
        'password and confirmPassword do not match',
      );
    }

    this.validateRolePlatform(role, platformAccess);
    this.validateRoleSpecificFields(registerDto);

    const assignment =
      role === Role.SHOP_OWNER
        ? await this.resolveNearestAssignment(latitude, longitude)
        : [Role.REGIONAL_MANAGER, Role.TERRITORY_DISTRIBUTOR, Role.SALES_REP].includes(
          role,
        )
          ? await this.resolveWarehouseAssignment(warehouseName)
          : null;

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

    const needsPreOtpAdminApproval = role === Role.DEMAND_PLANNER;
    const needsPostOtpAdminApproval = role === Role.REGIONAL_MANAGER || role === Role.SALES_REP;
    const needsTerritoryManagerApproval = this.requiresTerritoryManagerApproval(
      role,
      assignment?.warehouse.id ?? null,
    );
    const needsPostOtpApproval =
      needsPostOtpAdminApproval || needsTerritoryManagerApproval;

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
      address: address ?? null,
      territoryId: assignment?.territory.id ?? null,
      territory: assignment?.territory ?? null,
      warehouseId: assignment?.warehouse.id ?? null,
      warehouse: assignment?.warehouse ?? null,
      warehouseName: assignment?.warehouse.name ?? warehouseName ?? null,
      latitude: latitude ?? null,
      longitude: longitude ?? null,
      role,
      platformAccess,
      accountStatus: needsPreOtpAdminApproval
        ? AccountStatus.PENDING
        : AccountStatus.OTP_PENDING,
      approvalStatus:
        needsPreOtpAdminApproval || needsPostOtpApproval
          ? ApprovalStatus.PENDING
          : ApprovalStatus.APPROVED,
      publicUserCode: null,
      approvedBy: null,
      approvedAt: null,
      rejectionReason: null,
      isEmailVerified: false,
      otpCodeHash: null,
      otpExpiresAt: null,
      otpLastSentAt: null,
      otpVerifiedAt: null,
    });

    await this.activityService.logForUser({
      userId: user.id,
      type: 'ACCOUNT_CREATED',
      title: 'Account created',
      message: needsPreOtpAdminApproval
        ? 'Your account was created and is waiting for admin approval.'
        : needsTerritoryManagerApproval
          ? 'Your account was created and is waiting for OTP verification before territory manager approval.'
          : needsPostOtpAdminApproval
            ? 'Your account was created and is waiting for OTP verification before admin approval.'
            : 'Your account was created and is waiting for OTP verification.',
      metadata: {
        accountStatus: user.accountStatus,
        approvalStatus: user.approvalStatus,
      },
    });

    if (needsTerritoryManagerApproval) {
      await this.notifyWarehouseManagerOfPendingApproval(user);
    }

    if (needsPreOtpAdminApproval) {
      return {
        message:
          'Registration submitted successfully. Waiting for admin approval.',
        user: this.sanitizeUser(user),
      };
    }

    const otpCode = await this.issueOtp(user);

    return this.buildOtpResponse(
      user,
      needsPostOtpAdminApproval
        ? 'Registration successful. Verify OTP to move your request into admin approval.'
        : 'Registration successful.',
      otpCode,
    );
  }

  async resendOtp(requestOtpDto: RequestOtpDto) {
    const user = await this.requireOtpPendingUser(requestOtpDto.identifier);
    const otpCode = await this.issueOtp(user);

    return this.buildOtpResponse(
      user,
      'A new OTP has been generated.',
      otpCode,
    );
  }

  async verifyOtp(verifyOtpDto: VerifyOtpDto) {
    const user = await this.requireOtpPendingUser(verifyOtpDto.identifier);

    if (!user.otpCodeHash || !user.otpExpiresAt) {
      throw new BadRequestException(
        'No OTP is available for this account. Request a new code.',
      );
    }

    if (user.otpExpiresAt.getTime() < Date.now()) {
      throw new BadRequestException('OTP expired. Request a new code.');
    }

    const isOtpValid = await bcrypt.compare(verifyOtpDto.otp, user.otpCodeHash);

    if (!isOtpValid) {
      throw new BadRequestException('Invalid OTP.');
    }

    const needsPostOtpApproval =
      user.approvalStatus === ApprovalStatus.PENDING &&
      (user.role === Role.REGIONAL_MANAGER ||
        user.role === Role.SALES_REP ||
        this.requiresTerritoryManagerApproval(user.role, user.warehouseId));

    user.accountStatus = AccountStatus.ACTIVE;
    user.approvalStatus = needsPostOtpApproval
      ? ApprovalStatus.PENDING
      : ApprovalStatus.APPROVED;
    user.isEmailVerified = true;
    user.otpCodeHash = null;
    user.otpExpiresAt = null;
    user.otpVerifiedAt = new Date();

    if (!user.publicUserCode) {
      user.publicUserCode = this.generatePublicUserCode(user.role);
    }

    const savedUser = await this.usersService.save(user);

    await this.activityService.logForUser({
      userId: savedUser.id,
      type: 'ACCOUNT_ACTIVATED',
      title: 'Account activated',
      message: needsPostOtpApproval
        ? this.getPostOtpApprovalMessage(savedUser)
        : 'Your account moved from OTP pending to active.',
      metadata: {
        accountStatus: savedUser.accountStatus,
        approvalStatus: savedUser.approvalStatus,
      },
    });

    if (
      needsPostOtpApproval &&
      this.requiresTerritoryManagerApproval(savedUser.role, savedUser.warehouseId)
    ) {
      await this.notifyWarehouseManagerOfPendingApproval(savedUser);
    }

    return {
      message: needsPostOtpApproval
        ? `OTP verified successfully. ${this.getPendingApprovalFollowUp(savedUser)}`
        : 'OTP verified successfully. You can log in now.',
      user: this.sanitizeUser(savedUser),
    };
  }

  async getCurrentUserProfile(userId: string) {
    const user = await this.requireCurrentUser(userId);

    return {
      message: 'profile fetched successfully',
      user: this.sanitizeUser(user),
    };
  }

  /**
   * GET /auth/status?email=<email>
   *
   * Public endpoint — no JWT required.
   * Returns the minimal status fields the Flutter PendingApprovalScreen
   * needs to poll every 10 seconds. Deliberately avoids exposing sensitive
   * user data (password hash, OTP hash, etc.).
   */
  async getAccountStatus(email: string) {
    if (!email?.trim()) {
      throw new BadRequestException('email is required');
    }

    const user = await this.usersService.findByEmail(email.trim().toLowerCase());

    if (!user) {
      throw new NotFoundException('account not found');
    }

    return {
      message: 'status fetched successfully',
      accountStatus: user.accountStatus,
      approvalStatus: user.approvalStatus,
      rejectionReason: user.rejectionReason ?? null,
    };
  }

  async updateCurrentUserProfile(
    userId: string,
    updateProfileDto: UpdateProfileDto,
  ) {
    const user = await this.requireCurrentUser(userId);

    if (updateProfileDto.username !== undefined) {
      const username = this.normalizeRequiredProfileField(
        updateProfileDto.username,
        'username',
      );

      if (username !== user.username) {
        const existingUser = await this.usersService.findByUsername(username);
        if (existingUser && existingUser.id !== user.id) {
          throw new BadRequestException('username is already taken');
        }
      }

      user.username = username;
    }

    if (updateProfileDto.firstName !== undefined) {
      user.firstName = this.normalizeRequiredProfileField(
        updateProfileDto.firstName,
        'firstName',
      );
    }

    if (updateProfileDto.lastName !== undefined) {
      user.lastName = this.normalizeRequiredProfileField(
        updateProfileDto.lastName,
        'lastName',
      );
    }

    if (updateProfileDto.phoneNumber !== undefined) {
      const phoneNumber = this.normalizeRequiredProfileField(
        updateProfileDto.phoneNumber,
        'phoneNumber',
      );

      if (phoneNumber !== user.phoneNumber) {
        const existingUser =
          await this.usersService.findByPhoneNumber(phoneNumber);
        if (existingUser && existingUser.id !== user.id) {
          throw new BadRequestException('phone number is already registered');
        }
      }

      user.phoneNumber = phoneNumber;
    }

    if (updateProfileDto.email !== undefined) {
      const email = this.normalizeRequiredProfileField(
        updateProfileDto.email,
        'email',
      ).toLowerCase();

      if (email !== user.email.toLowerCase()) {
        const existingUser = await this.usersService.findByEmail(email);
        if (existingUser && existingUser.id !== user.id) {
          throw new BadRequestException('email is already registered');
        }
      }

      user.email = email;
    }

    if (updateProfileDto.shopName !== undefined) {
      if (user.role !== Role.SHOP_OWNER) {
        throw new BadRequestException(
          'shopName can only be updated for shop owner accounts',
        );
      }

      user.shopName = this.normalizeRequiredProfileField(
        updateProfileDto.shopName,
        'shopName',
      );
    }

    const savedUser = await this.usersService.save(user);
    const accessToken = await this.createAccessToken(savedUser);

    await this.activityService.logForUser({
      userId: savedUser.id,
      type: 'PROFILE_UPDATED',
      title: 'Profile updated',
      message: 'Your profile details were updated successfully.',
    });

    return {
      message: 'Profile updated successfully.',
      accessToken,
      user: this.sanitizeUser(savedUser),
    };
  }

  async logout(userId: string) {
    const user = await this.requireCurrentUser(userId);

    await this.activityService.logForUser({
      userId: user.id,
      type: 'LOGOUT',
      title: 'Logged out',
      // Website portal update: keep logout activity text accurate for both client surfaces.
      message:
        user.platformAccess === Platform.WEB
          ? 'You logged out of the web portal.'
          : 'You logged out of the mobile app.',
    });

    return {
      message: 'logout successful',
    };
  }

  async changePassword(userId: string, changePasswordDto: ChangePasswordDto) {
    const user = await this.requireCurrentUser(userId);
    const { currentPassword, newPassword, confirmNewPassword } =
      changePasswordDto;

    if (newPassword !== confirmNewPassword) {
      throw new BadRequestException(
        'newPassword and confirmNewPassword do not match',
      );
    }

    const isCurrentPasswordValid = await bcrypt.compare(
      currentPassword,
      user.passwordHash,
    );

    if (!isCurrentPasswordValid) {
      throw new BadRequestException('current password is incorrect');
    }

    const isSamePassword = await bcrypt.compare(newPassword, user.passwordHash);
    if (isSamePassword) {
      throw new BadRequestException(
        'new password must be different from the current password',
      );
    }

    user.passwordHash = await bcrypt.hash(newPassword, 10);
    await this.usersService.save(user);

    await this.activityService.logForUser({
      userId: user.id,
      type: 'PASSWORD_CHANGED',
      title: 'Password changed',
      message: 'Your account password was changed successfully.',
    });

    return {
      message: 'Password changed successfully.',
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
      // Website portal update: ADMIN is now allowed to self-register on WEB for the requested admin portal flow.
      [Role.ADMIN, Role.DEMAND_PLANNER, Role.REGIONAL_MANAGER].includes(role) &&
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
      address,
      warehouseName,
      latitude,
      longitude,
    } = registerDto;

    if (role === Role.ADMIN && !employeeId && !nic) {
      throw new BadRequestException('employeeId or nic is required for admin');
    }

    if (role === Role.DEMAND_PLANNER && !employeeId && !nic) {
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
          'warehouse name is required for territory manager',
        );
      }
    }

    if (
      [Role.TERRITORY_DISTRIBUTOR, Role.SALES_REP].includes(role) &&
      !warehouseName
    ) {
      throw new BadRequestException('warehouse name is required for this role');
    }

    if (role === Role.SHOP_OWNER) {
      if (!shopName) {
        throw new BadRequestException('shopName is required for shop owner');
      }

      if (!address) {
        throw new BadRequestException('address is required for shop owner');
      }

      if (latitude === undefined || longitude === undefined) {
        throw new BadRequestException(
          'shop location is required for shop owner',
        );
      }
    }
  }

  private async findUserByIdentifier(identifier: string) {
    return this.usersService.findByIdentifier(identifier.trim());
  }

  private async requireCurrentUser(userId: string) {
    const user = await this.usersService.findById(userId);

    if (!user) {
      throw new UnauthorizedException('session is invalid');
    }

    return user;
  }

  private async requireOtpPendingUser(identifier: string) {
    const user = await this.findUserByIdentifier(identifier);

    if (!user) {
      throw new BadRequestException('account was not found');
    }

    if (user.accountStatus === AccountStatus.PENDING) {
      throw new BadRequestException(
        'account is still waiting for admin approval',
      );
    }

    if (user.accountStatus === AccountStatus.REJECTED) {
      throw new BadRequestException('account registration was rejected');
    }

    if (user.accountStatus === AccountStatus.ACTIVE) {
      throw new BadRequestException('account is already verified');
    }

    if (user.accountStatus !== AccountStatus.OTP_PENDING) {
      throw new BadRequestException(
        'account is not waiting for OTP verification',
      );
    }

    return user;
  }

  private async issueOtp(user: User) {
    const otpCode = this.generateOtpCode();

    user.otpCodeHash = await bcrypt.hash(otpCode, 10);
    user.otpExpiresAt = new Date(Date.now() + AuthService.otpTtlMs);
    user.otpLastSentAt = new Date();

    await this.usersService.save(user);

    return otpCode;
  }

  private async buildOtpResponse(
    user: User,
    baseMessage: string,
    otpCode: string,
  ) {
    const delivery = await this.deliverOtp(user, otpCode);

    return {
      message: `${baseMessage} ${delivery.detailMessage}`.trim(),
      otpRequired: true,
      otpDeliveryMethod: delivery.method,
      user: this.sanitizeUser(user),
      ...(delivery.debugOtpCode ? { debugOtpCode: delivery.debugOtpCode } : {}),
    };
  }

  private get isDebugOtpEnabled() {
    return (
      process.env.NODE_ENV !== 'production' ||
      !!process.env.OTP_DEBUG_CODE?.trim()
    );
  }

  private async deliverOtp(
    user: User,
    otpCode: string,
  ): Promise<{
    method: OtpDeliveryMethod;
    detailMessage: string;
    debugOtpCode?: string;
  }> {
    try {
      const emailResult = await this.otpEmailService.sendOtpEmail({
        email: user.email,
        firstName: user.firstName,
        otpCode,
        expiresInMinutes: AuthService.otpTtlMs / (60 * 1000),
      });

      if (emailResult.delivered) {
        return {
          method: 'email',
          detailMessage: `We sent a 6-digit OTP to ${user.email}. Enter it to continue.`,
        };
      }

      if (this.isDebugOtpEnabled) {
        return {
          method: 'debug',
          detailMessage:
            'Email sending is not configured on the backend yet, so the development OTP is shown below.',
          debugOtpCode: otpCode,
        };
      }

      throw new InternalServerErrorException(
        'OTP email delivery is not configured on the server.',
      );
    } catch (error) {
      if (this.isDebugOtpEnabled) {
        return {
          method: 'debug',
          detailMessage:
            'The backend could not send the OTP email, so the development OTP is shown below for local testing.',
          debugOtpCode: otpCode,
        };
      }

      if (error instanceof InternalServerErrorException) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Unable to send the OTP email right now. Please try again in a moment.',
      );
    }
  }

  private async createAccessToken(user: User) {
    const payload = {
      sub: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      platformAccess: user.platformAccess,
      territoryId: user.territoryId ?? null,
    };

    return this.jwtService.signAsync(payload);
  }

  private requiresTerritoryManagerApproval(
    role: Role,
    warehouseId?: string | null,
  ) {
    return (
      !!warehouseId &&
      [Role.TERRITORY_DISTRIBUTOR, Role.SHOP_OWNER].includes(role)
    );
  }

  private getPendingApprovalMessage(user: User) {
    if (user.role === Role.REGIONAL_MANAGER) {
      return 'account is waiting for admin approval';
    }

    if (this.requiresTerritoryManagerApproval(user.role, user.warehouseId)) {
      return 'account is waiting for territory manager approval';
    }

    return 'account is waiting for approval';
  }

  private getPostOtpApprovalMessage(user: User) {
    if (user.role === Role.REGIONAL_MANAGER) {
      return 'Your account moved from OTP pending to active and is waiting for admin approval.';
    }

    if (this.requiresTerritoryManagerApproval(user.role, user.warehouseId)) {
      return 'Your account moved from OTP pending to active and is waiting for territory manager approval.';
    }

    return 'Your account moved from OTP pending to active.';
  }

  private getPendingApprovalFollowUp(user: User) {
    if (user.role === Role.REGIONAL_MANAGER) {
      return 'Your account is now waiting for admin approval.';
    }

    if (this.requiresTerritoryManagerApproval(user.role, user.warehouseId)) {
      return 'Your account is now waiting for territory manager approval.';
    }

    return 'Your account is now waiting for approval.';
  }

  private async notifyWarehouseManagerOfPendingApproval(user: User) {
    if (!user.warehouseId) {
      return;
    }

    const tms = await this.usersService.findTmsByWarehouseId(user.warehouseId);
    if (tms.length === 0) {
      return;
    }

    const fullName = `${user.firstName} ${user.lastName}`.trim();
    const warehouseName = user.warehouseName ?? user.warehouse?.name ?? 'your warehouse';

    await Promise.all(
      tms.map((tm) =>
        this.activityService.logForUser({
          userId: tm.id,
          type: 'WAREHOUSE_APPROVAL_PENDING',
          title: 'New approval pending',
          message: `${fullName} is waiting for approval as a ${this.formatRoleLabel(user.role)} under ${warehouseName}.`,
          metadata: {
            pendingUserId: user.id,
            pendingUserRole: user.role,
            warehouseId: user.warehouseId,
            warehouseName,
          },
        }),
      ),
    );
  }

  private formatRoleLabel(role: Role) {
    return role
      .toLowerCase()
      .split('_')
      .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
      .join(' ');
  }

  private normalizeRequiredProfileField(value: string, fieldName: string) {
    const normalizedValue = value.trim();

    if (!normalizedValue) {
      throw new BadRequestException(`${fieldName} cannot be empty`);
    }

    return normalizedValue;
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

  private async resolveWarehouseAssignment(warehouseName?: string | null) {
    const normalizedWarehouseName = warehouseName?.trim();
    if (!normalizedWarehouseName) {
      return null;
    }

    const warehouse =
      (await this.warehousesRepository.findOne({
        where: [
          { name: ILike(normalizedWarehouseName) },
          { slug: this.toSlug(normalizedWarehouseName) },
        ],
        relations: {
          territory: true,
        },
      })) ?? null;

    if (!warehouse?.territory) {
      throw new BadRequestException({
        message: 'Warehouse name did not match a registered warehouse.',
        code: 'WAREHOUSE_ASSIGNMENT_NOT_FOUND',
      });
    }

    return {
      territory: warehouse.territory,
      warehouse,
    };
  }

  private async resolveNearestAssignment(
    latitude?: number,
    longitude?: number,
  ) {
    if (latitude === undefined || longitude === undefined) {
      return null;
    }

    const [territories, warehouses] = await Promise.all([
      this.territoriesRepository.find({
        order: {
          name: 'ASC',
        },
      }),
      this.warehousesRepository.find({
        relations: {
          territory: true,
        },
        order: {
          name: 'ASC',
        },
      }),
    ]);

    const nearestWarehouse = findNearestLocation(
      latitude,
      longitude,
      warehouses.filter(
        (warehouse) =>
          warehouse.latitude !== null && warehouse.longitude !== null,
      ) as Array<
        Warehouse & {
          latitude: number;
          longitude: number;
        }
      >,
    );
    const nearestTerritory = findNearestLocation(latitude, longitude, territories);

    const territory =
      nearestWarehouse?.item.territory ?? nearestTerritory?.item ?? null;
    const warehouse = nearestWarehouse?.item ?? null;

    if (!territory || !warehouse) {
      throw new BadRequestException({
        message:
          'The system could not match the selected location to a territory and warehouse yet.',
        code: 'LOCATION_ASSIGNMENT_NOT_AVAILABLE',
      });
    }

    return {
      territory,
      warehouse,
    };
  }

  private generateOtpCode() {
    const debugCode = process.env.OTP_DEBUG_CODE?.trim();
    if (debugCode && /^\d{6}$/.test(debugCode)) {
      return debugCode;
    }
    return (100000 + Math.floor(Math.random() * 900000)).toString();
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

  private toSlug(value: string) {
    return value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }
}
