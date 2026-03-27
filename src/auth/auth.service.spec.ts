import * as bcrypt from 'bcrypt';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';

import { ActivityService } from '../activity/activity.service';
import { AccountStatus } from '../common/enums/account-status.enum';
import { Platform } from '../common/enums/platform.enum';
import { Role } from '../common/enums/role.enum';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';
import { OtpEmailService } from './otp-email.service';

describe('AuthService', () => {
  let service: AuthService;

  const usersServiceMock = {
    findById: jest.fn(),
    findByIdentifier: jest.fn(),
    findByUsername: jest.fn(),
    findByEmail: jest.fn(),
    findByPhoneNumber: jest.fn(),
    findByEmployeeId: jest.fn(),
    findByNic: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };

  const jwtServiceMock = {
    signAsync: jest.fn(),
  };

  const otpEmailServiceMock = {
    sendOtpEmail: jest.fn(),
  };

  const activityServiceMock = {
    logForUser: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: UsersService,
          useValue: usersServiceMock,
        },
        {
          provide: JwtService,
          useValue: jwtServiceMock,
        },
        {
          provide: OtpEmailService,
          useValue: otpEmailServiceMock,
        },
        {
          provide: ActivityService,
          useValue: activityServiceMock,
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('creates an OTP-required account for mobile public signup', async () => {
    usersServiceMock.findByUsername.mockResolvedValue(null);
    usersServiceMock.findByEmail.mockResolvedValue(null);
    usersServiceMock.findByPhoneNumber.mockResolvedValue(null);
    otpEmailServiceMock.sendOtpEmail.mockResolvedValue({ delivered: true });
    activityServiceMock.logForUser.mockResolvedValue(undefined);
    usersServiceMock.create.mockImplementation(async (payload) => ({
      id: 'user-1',
      publicUserCode: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      otpVerifiedAt: null,
      ...payload,
    }));
    usersServiceMock.save.mockImplementation(async (payload) => payload);

    const result = await service.register({
      firstName: 'Jane',
      lastName: 'Doe',
      username: 'jane_doe',
      email: 'jane@example.com',
      phoneNumber: '+94770000000',
      password: 'Password1',
      confirmPassword: 'Password1',
      role: Role.SHOP_OWNER,
      platformAccess: Platform.MOBILE,
      shopName: 'Jane Stores',
      address: '123 Main Street',
      latitude: 6.9271,
      longitude: 79.8612,
    });

    expect(result.otpRequired).toBe(true);
    expect(result.otpDeliveryMethod).toBe('email');
    expect(result.debugOtpCode).toBeUndefined();
    expect(usersServiceMock.save).toHaveBeenCalled();
    expect(otpEmailServiceMock.sendOtpEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'jane@example.com',
        firstName: 'Jane',
      }),
    );
  });

  it('returns a development OTP when email is not configured locally', async () => {
    usersServiceMock.findByUsername.mockResolvedValue(null);
    usersServiceMock.findByEmail.mockResolvedValue(null);
    usersServiceMock.findByPhoneNumber.mockResolvedValue(null);
    otpEmailServiceMock.sendOtpEmail.mockResolvedValue({
      delivered: false,
      reason: 'SMTP_HOST is not configured',
    });
    activityServiceMock.logForUser.mockResolvedValue(undefined);
    usersServiceMock.create.mockImplementation(async (payload) => ({
      id: 'user-2',
      publicUserCode: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      otpVerifiedAt: null,
      ...payload,
    }));
    usersServiceMock.save.mockImplementation(async (payload) => payload);

    const result = await service.register({
      firstName: 'John',
      lastName: 'Doe',
      username: 'john_doe',
      email: 'john@example.com',
      phoneNumber: '+94771111111',
      password: 'Password1',
      confirmPassword: 'Password1',
      role: Role.SHOP_OWNER,
      platformAccess: Platform.MOBILE,
      shopName: 'John Stores',
      address: '456 Main Street',
      latitude: 6.9,
      longitude: 79.8,
    });

    expect(result.otpRequired).toBe(true);
    expect(result.otpDeliveryMethod).toBe('debug');
    expect(result.debugOtpCode).toMatch(/^\d{6}$/);
  });

  it('allows admin self-signup on the web portal and sends OTP verification', async () => {
    usersServiceMock.findByUsername.mockResolvedValue(null);
    usersServiceMock.findByEmail.mockResolvedValue(null);
    usersServiceMock.findByPhoneNumber.mockResolvedValue(null);
    usersServiceMock.findByEmployeeId.mockResolvedValue(null);
    otpEmailServiceMock.sendOtpEmail.mockResolvedValue({ delivered: true });
    activityServiceMock.logForUser.mockResolvedValue(undefined);
    usersServiceMock.create.mockImplementation(async (payload) => ({
      id: 'user-admin-1',
      publicUserCode: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      otpVerifiedAt: null,
      ...payload,
    }));
    usersServiceMock.save.mockImplementation(async (payload) => payload);

    const result = await service.register({
      firstName: 'Asha',
      lastName: 'Perera',
      username: 'asha_admin',
      email: 'asha.admin@example.com',
      phoneNumber: '+94771231234',
      password: 'Password1',
      confirmPassword: 'Password1',
      role: Role.ADMIN,
      platformAccess: Platform.WEB,
      employeeId: 'ADM-001',
    });

    expect(result.otpRequired).toBe(true);
    expect(result.otpDeliveryMethod).toBe('email');
    expect(usersServiceMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        role: Role.ADMIN,
        platformAccess: Platform.WEB,
      }),
    );
  });

  it('allows web regional manager signup with a territory label and no coordinates', async () => {
    usersServiceMock.findByUsername.mockResolvedValue(null);
    usersServiceMock.findByEmail.mockResolvedValue(null);
    usersServiceMock.findByPhoneNumber.mockResolvedValue(null);
    usersServiceMock.findByEmployeeId.mockResolvedValue(null);
    otpEmailServiceMock.sendOtpEmail.mockResolvedValue({ delivered: true });
    activityServiceMock.logForUser.mockResolvedValue(undefined);
    usersServiceMock.create.mockImplementation(async (payload) => ({
      id: 'user-rm-1',
      publicUserCode: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      otpVerifiedAt: null,
      ...payload,
    }));
    usersServiceMock.save.mockImplementation(async (payload) => payload);

    const result = await service.register({
      firstName: 'Nuwan',
      lastName: 'Silva',
      username: 'nuwan_rm',
      email: 'nuwan.rm@example.com',
      phoneNumber: '+94772345678',
      password: 'Password1',
      confirmPassword: 'Password1',
      role: Role.REGIONAL_MANAGER,
      platformAccess: Platform.WEB,
      employeeId: 'RM-101',
      warehouseName: 'Colombo North Territory',
    });

    expect(result.message).toContain('Waiting for admin approval');
    expect(result.user).toEqual(
      expect.objectContaining({
        role: Role.REGIONAL_MANAGER,
        warehouseName: 'Colombo North Territory',
      }),
    );
  });

  it('rejects web login attempts for mobile-only accounts when WEB access is requested', async () => {
    usersServiceMock.findByIdentifier.mockResolvedValue({
      id: 'user-mobile-1',
      username: 'shop_user',
      email: 'shop@example.com',
      phoneNumber: '+94770001111',
      platformAccess: Platform.MOBILE,
      role: Role.SHOP_OWNER,
      passwordHash: await bcrypt.hash('Password1', 10),
      accountStatus: AccountStatus.ACTIVE,
    });

    await expect(
      service.login({
        identifier: 'shop_user',
        password: 'Password1',
        platformAccess: Platform.WEB,
      }),
    ).rejects.toThrow('this account cannot access the web portal');
  });

  it('returns the current user profile from the database', async () => {
    usersServiceMock.findById.mockResolvedValue({
      id: 'user-3',
      username: 'jane_store',
      firstName: 'Jane',
      lastName: 'Store',
      email: 'jane@store.com',
      phoneNumber: '+94771234567',
      shopName: 'Jane Store',
      address: 'Galle, Sri Lanka',
      role: Role.SHOP_OWNER,
      passwordHash: 'hashed',
    });

    const result = await service.getCurrentUserProfile('user-3');

    expect(result.user).toEqual(
      expect.objectContaining({
        username: 'jane_store',
        shopName: 'Jane Store',
      }),
    );
  });

  it('updates the current user profile and returns a fresh token', async () => {
    const currentUser = {
      id: 'user-4',
      username: 'old_store',
      firstName: 'Old',
      lastName: 'Name',
      email: 'old@store.com',
      phoneNumber: '+94770000001',
      shopName: 'Old Shop',
      role: Role.SHOP_OWNER,
      platformAccess: Platform.MOBILE,
      passwordHash: 'hashed',
    };

    usersServiceMock.findById.mockResolvedValue(currentUser);
    usersServiceMock.findByUsername.mockResolvedValue(null);
    usersServiceMock.findByEmail.mockResolvedValue(null);
    usersServiceMock.findByPhoneNumber.mockResolvedValue(null);
    usersServiceMock.save.mockImplementation(async (payload) => payload);
    jwtServiceMock.signAsync.mockResolvedValue('fresh-token');
    activityServiceMock.logForUser.mockResolvedValue(undefined);

    const result = await service.updateCurrentUserProfile('user-4', {
      username: 'new_store',
      firstName: 'New',
      lastName: 'Owner',
      email: 'new@store.com',
      phoneNumber: '+94770000002',
      shopName: 'New Shop',
    });

    expect(result.message).toBe('Profile updated successfully.');
    expect(result.accessToken).toBe('fresh-token');
    expect(result.user).toEqual(
      expect.objectContaining({
        username: 'new_store',
        firstName: 'New',
        lastName: 'Owner',
        email: 'new@store.com',
        phoneNumber: '+94770000002',
        shopName: 'New Shop',
      }),
    );
  });

  it('changes the password when the current password is correct', async () => {
    const currentPassword = 'Password1';
    const currentPasswordHash = await bcrypt.hash(currentPassword, 10);

    usersServiceMock.findById.mockResolvedValue({
      id: 'user-5',
      username: 'secure_store',
      passwordHash: currentPasswordHash,
    });
    usersServiceMock.save.mockImplementation(async (payload) => payload);
    activityServiceMock.logForUser.mockResolvedValue(undefined);

    const result = await service.changePassword('user-5', {
      currentPassword,
      newPassword: 'Password2',
      confirmNewPassword: 'Password2',
    });

    expect(result.message).toBe('Password changed successfully.');
    expect(usersServiceMock.save).toHaveBeenCalled();
  });
});
