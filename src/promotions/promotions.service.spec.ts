import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { Repository } from 'typeorm';

import { CreatePromotionDto, UpdatePromotionDto } from './dto/promotions.dto';
import { PromotionProduct } from './entities/promotion-product.entity';
import { PromotionRedemption } from './entities/promotion-redemption.entity';
import { PromotionTerritory } from './entities/promotion-territory.entity';
import { Promotion } from './entities/promotion.entity';
import { PromotionsService } from './promotions.service';

type MockRepository<T extends object> = Partial<
  Record<keyof Repository<T>, jest.Mock>
>;

const asRepository = <T extends object>(
  repository: MockRepository<T>,
): Repository<T> => repository as unknown as Repository<T>;

describe('PromotionsService', () => {
  let service: PromotionsService;
  let promotionRepository: MockRepository<Promotion>;
  let promotionProductRepository: MockRepository<PromotionProduct>;
  let promotionTerritoryRepository: MockRepository<PromotionTerritory>;
  let promotionRedemptionRepository: MockRepository<PromotionRedemption>;

  beforeEach(() => {
    promotionRepository = {
      create: jest.fn(),
      save: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      find: jest.fn(),
    };
    promotionProductRepository = {
      delete: jest.fn(),
      insert: jest.fn(),
      find: jest.fn(),
    };
    promotionTerritoryRepository = {
      delete: jest.fn(),
      insert: jest.fn(),
      find: jest.fn(),
    };
    promotionRedemptionRepository = {
      delete: jest.fn(),
      find: jest.fn(),
    };

    service = new PromotionsService(
      asRepository(promotionRepository),
      asRepository(promotionProductRepository),
      asRepository(promotionTerritoryRepository),
      asRepository(promotionRedemptionRepository),
    );
  });

  it('rejects create when the promotion code already exists', async () => {
    (promotionRepository.findOne as jest.Mock).mockResolvedValue({ id: 'existing-id' });

    await expect(
      service.create({ code: 'SAVE20' } as CreatePromotionDto, 'user-1'),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(promotionRepository.save).not.toHaveBeenCalled();
  });

  it('normalizes the code and uses the authenticated user as createdBy', async () => {
    const now = new Date('2026-04-18T00:00:00.000Z');
    const dto = {
      name: 'Sunday Sale',
      code: '  SAVE20  ',
      startDate: now,
      endDate: now,
      promotionType: 'auto_applied',
      discountType: 'percentage',
      discountValue: 10,
    } as CreatePromotionDto;
    const createdPromotion = {
      id: 'promotion-1',
      ...dto,
      code: 'SAVE20',
      createdBy: 'user-1',
    } as Promotion;

    (promotionRepository.findOne as jest.Mock).mockResolvedValue(null);
    (promotionRepository.create as jest.Mock).mockReturnValue(createdPromotion);
    (promotionRepository.save as jest.Mock).mockResolvedValue(createdPromotion);
    (promotionRepository.findOne as jest.Mock)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(createdPromotion);

    const result = await service.create(dto, 'user-1');

    expect(promotionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'SAVE20',
        createdBy: 'user-1',
      }),
    );
    expect(promotionProductRepository.insert).not.toHaveBeenCalled();
    expect(promotionTerritoryRepository.insert).not.toHaveBeenCalled();
    expect(result).toEqual(createdPromotion);
  });

  it('persists selected product and territory relations when creating a promotion', async () => {
    const dto = {
      name: 'Territory Promo',
      code: 'SAVE30',
      startDate: new Date('2026-04-18T00:00:00.000Z'),
      endDate: new Date('2026-04-28T00:00:00.000Z'),
      promotionType: 'auto_applied',
      discountType: 'percentage',
      discountValue: 30,
      eligibleProductIds: ['product-1', 'product-2'],
      eligibleTerritoryIds: ['territory-1'],
    } as CreatePromotionDto;
    const savedPromotion = {
      id: 'promotion-1',
      ...dto,
      code: 'SAVE30',
      createdBy: 'user-1',
    } as Promotion;

    (promotionRepository.findOne as jest.Mock)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(savedPromotion);
    (promotionRepository.create as jest.Mock).mockReturnValue(savedPromotion);
    (promotionRepository.save as jest.Mock).mockResolvedValue(savedPromotion);

    await service.create(dto, 'user-1');

    expect(promotionProductRepository.insert).toHaveBeenCalledWith([
      { promotionId: 'promotion-1', productId: 'product-1' },
      { promotionId: 'promotion-1', productId: 'product-2' },
    ]);
    expect(promotionTerritoryRepository.insert).toHaveBeenCalledWith([
      { promotionId: 'promotion-1', territoryId: 'territory-1' },
    ]);
  });

  it('translates a database unique violation into a conflict error', async () => {
    const dto = {
      name: 'Sunday Sale',
      code: 'SAVE20',
      startDate: new Date('2026-04-18T00:00:00.000Z'),
      endDate: new Date('2026-04-28T00:00:00.000Z'),
      promotionType: 'auto_applied',
      discountType: 'percentage',
      discountValue: 10,
    } as CreatePromotionDto;

    (promotionRepository.findOne as jest.Mock).mockResolvedValue(null);
    (promotionRepository.create as jest.Mock).mockReturnValue(dto);
    (promotionRepository.save as jest.Mock).mockRejectedValue({
      code: '23505',
      constraint: 'UQ_8ab10e580f70c3d2e2e4b31ebf2',
    });

    await expect(service.create(dto, 'user-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('rejects update when another promotion already uses the code', async () => {
    (promotionRepository.findOne as jest.Mock).mockResolvedValue({ id: 'other-promotion' });

    await expect(
      service.update(
        'current-promotion',
        { code: 'SAVE20' } as UpdatePromotionDto,
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(promotionRepository.update).not.toHaveBeenCalled();
  });

  it('requires an authenticated user for create', async () => {
    await expect(
      service.create({ code: 'SAVE20' } as CreatePromotionDto),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('removes related records before deleting a promotion', async () => {
    await service.remove('promotion-1');

    expect(promotionProductRepository.delete).toHaveBeenCalledWith({
      promotionId: 'promotion-1',
    });
    expect(promotionTerritoryRepository.delete).toHaveBeenCalledWith({
      promotionId: 'promotion-1',
    });
    expect(promotionRedemptionRepository.delete).toHaveBeenCalledWith({
      promotionId: 'promotion-1',
    });
    expect(promotionRepository.delete).toHaveBeenCalledWith('promotion-1');
  });
});
