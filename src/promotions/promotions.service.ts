import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';

import { CreatePromotionDto, UpdatePromotionDto } from './dto/promotions.dto';
import { ValidatePromotionDto } from './dto/validate-promotion.dto';
import { PromotionProduct } from './entities/promotion-product.entity';
import { PromotionRedemption } from './entities/promotion-redemption.entity';
import { PromotionTerritory } from './entities/promotion-territory.entity';
import { Promotion } from './entities/promotion.entity';

@Injectable()
export class PromotionsService {
  constructor(
    @InjectRepository(Promotion)
    private readonly promotionRepository: Repository<Promotion>,
    @InjectRepository(PromotionProduct)
    private readonly promotionProductRepository: Repository<PromotionProduct>,
    @InjectRepository(PromotionTerritory)
    private readonly promotionTerritoryRepository: Repository<PromotionTerritory>,
    @InjectRepository(PromotionRedemption)
    private readonly promotionRedemptionRepository: Repository<PromotionRedemption>,
  ) {}

  async create(createPromotionDto: CreatePromotionDto, createdBy?: string) {
    if (!createdBy) {
      throw new UnauthorizedException('Authenticated user not found.');
    }

    const {
      eligibleProductIds,
      eligibleTerritoryIds,
      code,
      ...promotionData
    } = createPromotionDto;
    const normalizedCode = this.normalizePromotionCode(code);

    await this.ensurePromotionCodeIsUnique(normalizedCode);

    const promotion = this.promotionRepository.create({
      ...promotionData,
      code: normalizedCode,
      createdBy,
    });

    try {
      const savedPromotion = await this.promotionRepository.save(promotion);

      if (eligibleProductIds && eligibleProductIds.length > 0) {
        await this.promotionProductRepository.insert(
          eligibleProductIds.map((productId) => ({
            promotionId: savedPromotion.id,
            productId,
          })),
        );
      }

      if (eligibleTerritoryIds && eligibleTerritoryIds.length > 0) {
        await this.promotionTerritoryRepository.insert(
          eligibleTerritoryIds.map((territoryId) => ({
            promotionId: savedPromotion.id,
            territoryId,
          })),
        );
      }

      return this.findOne(savedPromotion.id);
    } catch (error) {
      this.throwIfPromotionCodeConflict(error);
      throw error;
    }
  }

  async findAll(): Promise<Promotion[]> {
    const promotions = await this.promotionRepository.find({
      relations: ['eligibleProducts', 'eligibleProducts.product', 'eligibleTerritories'],
    });
    return promotions.map((p) => this.mapPromotionRelations(p));
  }

  async findActive(territoryId?: string): Promise<Promotion[]> {
    const qb = this.promotionRepository.createQueryBuilder('promotion')
      .leftJoinAndSelect('promotion.eligibleProducts', 'ep')
      .leftJoinAndSelect('ep.product', 'p_prod')
      .leftJoinAndSelect('promotion.eligibleTerritories', 'et')
      .where('promotion.status = :status', { status: 'active' })
      .andWhere('promotion.start_date <= :now', { now: new Date() })
      .andWhere('promotion.end_date >= :now', { now: new Date() });

    if (territoryId) {
      qb.innerJoin(
        PromotionTerritory,
        'pt',
        'pt.promotion_id = promotion.id',
      ).andWhere('pt.territory_id = :territoryId', { territoryId });
    }

    const promotions = await qb.getMany();
    return promotions.map((p) => this.mapPromotionRelations(p));
  }

  async findForTerritory(territoryId: string): Promise<Promotion[]> {
    const qb = this.promotionRepository
      .createQueryBuilder('promotion')
      .leftJoinAndSelect('promotion.eligibleProducts', 'ep')
      .leftJoinAndSelect('ep.product', 'p_prod')
      .leftJoinAndSelect('promotion.eligibleTerritories', 'et')
      .innerJoin(
        PromotionTerritory,
        'pt',
        'pt.promotion_id = promotion.id AND pt.territory_id = :territoryId',
        { territoryId },
      )
      .orderBy('promotion.start_date', 'ASC')
      .addOrderBy('promotion.created_at', 'DESC');

    const promotions = await qb.getMany();
    return promotions.map((promotion) => {
      const mappedPromotion = this.mapPromotionRelations(promotion);
      mappedPromotion.status = this.resolvePromotionStatus(mappedPromotion);
      return mappedPromotion;
    });
  }

  async findOne(id: string): Promise<Promotion | null> {
    const promotion = await this.promotionRepository.findOne({
      where: { id },
      relations: ['eligibleProducts', 'eligibleProducts.product', 'eligibleTerritories'],
    });
    return promotion ? this.mapPromotionRelations(promotion) : null;
  }

  private mapPromotionRelations(promotion: Promotion): Promotion {
    promotion.eligibleProductIds =
      promotion.eligibleProducts?.map((p) => p.productId) || [];
    promotion.eligibleTerritoryIds =
      promotion.eligibleTerritories?.map((t) => t.territoryId) || [];
    promotion.eligibleProductNames = promotion.eligibleProducts
      ?.map((p) => p.product?.productName)
      .filter((name): name is string => !!name) || [];

    promotion.eligibleProductsDetail = promotion.eligibleProducts
      ?.map((p) => ({
        id: p.product?.id,
        productName: p.product?.productName,
        imageUrl: p.product?.imageUrl,
      }))
      .filter((p) => !!p.id) || [];

    return promotion;
  }

  private resolvePromotionStatus(promotion: Promotion): string {
    const rawStatus = (promotion.status ?? '').trim().toLowerCase();
    const now = new Date();

    if (rawStatus == 'disabled') {
      return 'disabled';
    }

    if (rawStatus == 'expired' || now > promotion.endDate) {
      return 'expired';
    }

    if (rawStatus == 'scheduled' || now < promotion.startDate) {
      return 'scheduled';
    }

    if (rawStatus == 'draft') {
      return 'draft';
    }

    return 'active';
  }

  async update(id: string, updateDto: UpdatePromotionDto): Promise<Promotion | null> {
    const {
      eligibleProductIds,
      eligibleTerritoryIds,
      code,
      ...corePromotionData
    } = updateDto;
    const normalizedCode =
      code === undefined ? undefined : this.normalizePromotionCode(code);

    if (normalizedCode !== undefined) {
      await this.ensurePromotionCodeIsUnique(normalizedCode, id);
    }

    if (Object.keys(corePromotionData).length > 0 || normalizedCode !== undefined) {
      try {
        await this.promotionRepository.update(id, {
          ...corePromotionData,
          ...(normalizedCode !== undefined ? { code: normalizedCode } : {}),
        });
      } catch (error) {
        this.throwIfPromotionCodeConflict(error);
        throw error;
      }
    }

    if (eligibleProductIds !== undefined) {
      await this.promotionProductRepository.delete({ promotionId: id });
      if (eligibleProductIds.length > 0) {
        await this.promotionProductRepository.insert(
          eligibleProductIds.map((productId) => ({ promotionId: id, productId })),
        );
      }
    }

    if (eligibleTerritoryIds !== undefined) {
      await this.promotionTerritoryRepository.delete({ promotionId: id });
      if (eligibleTerritoryIds.length > 0) {
        await this.promotionTerritoryRepository.insert(
          eligibleTerritoryIds.map((territoryId) => ({ promotionId: id, territoryId })),
        );
      }
    }

    return this.findOne(id);
  }

  async remove(id: string): Promise<void> {
    await this.promotionProductRepository.delete({ promotionId: id });
    await this.promotionTerritoryRepository.delete({ promotionId: id });
    await this.promotionRedemptionRepository.delete({ promotionId: id });
    await this.promotionRepository.delete(id);
  }

  async validatePromotion(dto: ValidatePromotionDto) {
    const promotion = await this.promotionRepository.findOne({
      where: { code: dto.code, status: 'active' },
      relations: ['eligibleProducts', 'eligibleTerritories'],
    });

    if (!promotion) {
      throw new BadRequestException('Invalid or expired promotion code.');
    }

    const now = new Date();
    if (now < promotion.startDate || now > promotion.endDate) {
      throw new BadRequestException('This promotion is not currently active.');
    }

    if (promotion.eligibleTerritories && promotion.eligibleTerritories.length > 0) {
      const isEligible = promotion.eligibleTerritories.some(
        (t) => t.territoryId === dto.territoryId,
      );
      if (!isEligible) {
        throw new BadRequestException('Promotion not valid for your territory.');
      }
    }

    if (promotion.minOrderValue && dto.cartTotal < Number(promotion.minOrderValue)) {
      throw new BadRequestException(
        `Minimum order value of ${Number(promotion.minOrderValue).toLocaleString()} not met.`,
      );
    }

    if (promotion.eligibleProducts && promotion.eligibleProducts.length > 0) {
      const eligibleIds = promotion.eligibleProducts.map((p) => p.productId);
      const hasEligibleItem = dto.cartItems.some((item) =>
        eligibleIds.includes(item.productId),
      );

      if (!hasEligibleItem) {
        throw new BadRequestException(
          'Cart does not contain products eligible for this promotion.',
        );
      }
    }

    let discountAmount = 0;
    if (promotion.discountType === 'percentage') {
      discountAmount = (dto.cartTotal * Number(promotion.discountValue)) / 100;
    } else {
      discountAmount = Number(promotion.discountValue);
    }

    if (discountAmount > dto.cartTotal) {
      discountAmount = dto.cartTotal;
    }

    return {
      success: true,
      promotionId: promotion.id,
      code: promotion.code,
      discountAmount,
      discountType: promotion.discountType,
      message: 'Promotion applied!',
    };
  }

  async validatePromoCode(
    code: string,
    shopId: string,
    territoryId: string,
    orderTotal: number,
    productIds: string[],
  ): Promise<{ valid: boolean; discount: number; message: string; promotionId?: string }> {
    const promotion = await this.promotionRepository.findOne({
      where: { code, status: 'active' },
    });
    if (!promotion) {
      return { valid: false, discount: 0, message: 'Invalid or inactive promotion code.' };
    }

    const now = new Date();
    if (now < promotion.startDate || now > promotion.endDate) {
      return { valid: false, discount: 0, message: 'Promotion is not currently valid.' };
    }

    if (promotion.minOrderValue && orderTotal < promotion.minOrderValue) {
      return {
        valid: false,
        discount: 0,
        message: `Minimum order value not met (${promotion.minOrderValue}).`,
      };
    }

    const territories = await this.promotionTerritoryRepository.find({
      where: { promotionId: promotion.id },
    });
    if (territories.length > 0) {
      const isEligibleTerritory = territories.some(
        (territory) => territory.territoryId === territoryId,
      );
      if (!isEligibleTerritory) {
        return { valid: false, discount: 0, message: 'Promotion not valid for this territory.' };
      }
    }

    const products = await this.promotionProductRepository.find({
      where: { promotionId: promotion.id },
    });
    if (products.length > 0) {
      const hasEligibleProduct = products.some((product) =>
        productIds.includes(product.productId),
      );
      if (!hasEligibleProduct) {
        return { valid: false, discount: 0, message: 'Cart does not contain eligible products.' };
      }
    }

    if (promotion.usageLimit || promotion.perShopLimit) {
      const redemptions = await this.promotionRedemptionRepository.find({
        where: { promotionId: promotion.id },
      });

      if (promotion.usageLimit && redemptions.length >= promotion.usageLimit) {
        return { valid: false, discount: 0, message: 'Promotion global usage limit reached.' };
      }

      if (promotion.perShopLimit) {
        const shopRedemptions = redemptions.filter((redemption) => redemption.shopId === shopId);
        if (shopRedemptions.length >= promotion.perShopLimit) {
          return { valid: false, discount: 0, message: 'Shop usage limit reached for this promotion.' };
        }
      }
    }

    let discount = 0;
    if (promotion.discountType === 'percentage') {
      discount = (orderTotal * promotion.discountValue) / 100;
      if (discount > orderTotal) {
        discount = orderTotal;
      }
    } else if (promotion.discountType === 'fixed') {
      discount = Number(promotion.discountValue);
      if (discount > orderTotal) {
        discount = orderTotal;
      }
    }

    return {
      valid: true,
      discount,
      message: 'Promotion applied successfully!',
      promotionId: promotion.id,
    };
  }

  private normalizePromotionCode(code?: string | null): string | null {
    if (code === undefined || code === null) {
      return null;
    }

    const normalizedCode = code.trim();
    return normalizedCode.length > 0 ? normalizedCode : null;
  }

  private async ensurePromotionCodeIsUnique(
    code: string | null,
    excludePromotionId?: string,
  ) {
    if (!code) {
      return;
    }

    const existingPromotion = await this.promotionRepository.findOne({
      where: excludePromotionId ? { code, id: Not(excludePromotionId) } : { code },
      select: { id: true },
    });

    if (existingPromotion) {
      throw this.buildPromotionCodeConflictException();
    }
  }

  private throwIfPromotionCodeConflict(error: unknown): void {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === '23505' &&
      'constraint' in error &&
      error.constraint === 'UQ_8ab10e580f70c3d2e2e4b31ebf2'
    ) {
      throw this.buildPromotionCodeConflictException();
    }
  }

  private buildPromotionCodeConflictException() {
    return new ConflictException({
      message: 'A promotion already exists with this code.',
      code: 'PROMOTION_CODE_NOT_UNIQUE',
    });
  }
}
