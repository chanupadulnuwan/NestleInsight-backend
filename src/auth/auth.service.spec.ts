import * as bcrypt from 'bcrypt';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';

import { ActivityService } from '../activity/activity.service';
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
