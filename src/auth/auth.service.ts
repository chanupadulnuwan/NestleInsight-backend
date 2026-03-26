import {
  BadRequestException,
  InternalServerErrorException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';

import { ActivityService } from '../activity/activity.service';
import { AccountStatus } from '../common/enums/account-status.enum';
import { ApprovalStatus } from '../common/enums/approval-status.enum';
import { Platform } from '../common/enums/platform.enum';
import { Role } from '../common/enums/role.enum';
import { User } from '../users/entities/user.entity';
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
  ) {}

  async login(loginDto: LoginDto) {
    const { identifier, password } = loginDto;
    const user = await this.findUserByIdentifier(identifier);

    if (!user) {
      throw new UnauthorizedException('invalid credentials');
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

    const accessToken = await this.createAccessToken(user);

    await this.activityService.logForUser({
      userId: user.id,
      type: 'LOGIN',
      title: 'Logged in',
      message: 'You signed in to the mobile app successfully.',
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
      address: address ?? null,
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
      otpCodeHash: null,
      otpExpiresAt: null,
      otpLastSentAt: null,
      otpVerifiedAt: null,
    });

    await this.activityService.logForUser({
      userId: user.id,
      type: 'ACCOUNT_CREATED',
      title: 'Account created',
      message: needsAdminApproval
        ? 'Your account was created and is waiting for admin approval.'
        : 'Your account was created and is waiting for OTP verification.',
      metadata: {
        accountStatus: user.accountStatus,
        approvalStatus: user.approvalStatus,
      },
    });

    if (needsAdminApproval) {
      return {
        message:
          'Registration submitted successfully. Waiting for admin approval.',
        user: this.sanitizeUser(user),
      };
    }

    const otpCode = await this.issueOtp(user);

    return this.buildOtpResponse(user, 'Registration successful.', otpCode);
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

    user.accountStatus = AccountStatus.ACTIVE;
    user.approvalStatus = ApprovalStatus.APPROVED;
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
      message: 'Your account moved from OTP pending to active.',
      metadata: {
        accountStatus: savedUser.accountStatus,
        approvalStatus: savedUser.approvalStatus,
      },
    });

    return {
      message: 'OTP verified successfully. You can log in now.',
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
      message: 'You logged out of the mobile app.',
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
      address,
      warehouseName,
      latitude,
      longitude,
    } = registerDto;

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
    return process.env.NODE_ENV !== 'production';
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
    };

    return this.jwtService.signAsync(payload);
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
      ...safeUser
    } = user;

    return safeUser;
  }

  private generateOtpCode() {
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
}
