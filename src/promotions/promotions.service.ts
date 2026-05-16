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

type PromotionValidationItem = {
  productId: string;
  quantity: number;
};

type PromotionEligibilityOptions = {
  promotionId?: string | null;
  code?: string | null;
  territoryId: string;
  shopId?: string | null;
  cartTotal: number;
  cartItems: PromotionValidationItem[];
};

type PromotionEligibilityResult = {
  promotion: Promotion;
  discountAmount: number;
};

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

    const { eligibleProductIds, eligibleTerritoryIds, code, ...promotionData } =
      createPromotionDto;
    const normalizedCode = this.normalizePromotionCode(code);
    const { startDate, endDate } = this.normalizePromotionDateRange(
      createPromotionDto.startDate,
      createPromotionDto.endDate,
    );

    await this.ensurePromotionCodeIsUnique(normalizedCode);

    const promotion = this.promotionRepository.create({
      ...promotionData,
      code: normalizedCode,
      startDate,
      endDate,
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
      relations: [
        'eligibleProducts',
        'eligibleProducts.product',
        'eligibleTerritories',
      ],
      order: {
        createdAt: 'DESC',
      },
    });
    return promotions.map((p) => this.mapPromotionRelations(p));
  }

  async findActive(territoryId?: string): Promise<Promotion[]> {
    const qb = this.promotionRepository
      .createQueryBuilder('promotion')
      .leftJoinAndSelect('promotion.eligibleProducts', 'ep')
      .leftJoinAndSelect('ep.product', 'p_prod')
      .leftJoinAndSelect('promotion.eligibleTerritories', 'et')
      .orderBy('promotion.start_date', 'ASC')
      .addOrderBy('promotion.created_at', 'DESC')
      .distinct(true);

    if (territoryId) {
      qb.leftJoin(
        PromotionTerritory,
        'territory_scope',
        'territory_scope.promotion_id = promotion.id',
      ).andWhere(
        '(territory_scope.territory_id = :territoryId OR territory_scope.id IS NULL)',
        { territoryId },
      );
    }

    const promotions = await qb.getMany();
    return promotions
      .map((promotion) => this.mapPromotionRelations(promotion))
      .filter((promotion) => promotion.status === 'active');
  }

  async findForTerritory(territoryId: string): Promise<Promotion[]> {
    const qb = this.promotionRepository
      .createQueryBuilder('promotion')
      .leftJoinAndSelect('promotion.eligibleProducts', 'ep')
      .leftJoinAndSelect('ep.product', 'p_prod')
      .leftJoinAndSelect('promotion.eligibleTerritories', 'et')
      .leftJoin(
        PromotionTerritory,
        'territory_scope',
        'territory_scope.promotion_id = promotion.id AND territory_scope.territory_id = :territoryId',
        { territoryId },
      )
      .where('(territory_scope.id IS NOT NULL OR et.id IS NULL)')
      .orderBy('promotion.start_date', 'ASC')
      .addOrderBy('promotion.created_at', 'DESC')
      .distinct(true);

    const promotions = await qb.getMany();
    return promotions.map((promotion) => this.mapPromotionRelations(promotion));
  }

  async findOne(id: string): Promise<Promotion | null> {
    const promotion = await this.promotionRepository.findOne({
      where: { id },
      relations: [
        'eligibleProducts',
        'eligibleProducts.product',
        'eligibleTerritories',
      ],
    });
    return promotion ? this.mapPromotionRelations(promotion) : null;
  }

  private mapPromotionRelations(promotion: Promotion): Promotion {
    promotion.eligibleProductIds =
      promotion.eligibleProducts?.map((p) => p.productId) || [];
    promotion.eligibleTerritoryIds =
      promotion.eligibleTerritories?.map((t) => t.territoryId) || [];
    promotion.eligibleProductNames =
      promotion.eligibleProducts
        ?.map((p) => p.product?.productName)
        .filter((name): name is string => !!name) || [];

    promotion.eligibleProductsDetail =
      promotion.eligibleProducts
        ?.map((p) => ({
          id: p.product?.id,
          productName: p.product?.productName,
          imageUrl: p.product?.imageUrl,
        }))
        .filter((p) => !!p.id) || [];
    promotion.status = this.resolvePromotionStatus(promotion);

    return promotion;
  }

  private resolvePromotionStatus(promotion: Promotion): string {
    const rawStatus = (promotion.status ?? '').trim().toLowerCase();
    const now = new Date();

    if (rawStatus === 'disabled') {
      return 'disabled';
    }

    if (rawStatus === 'draft') {
      return 'draft';
    }

    const startDate = this.startOfDay(promotion.startDate);
    const endDate = this.endOfDay(promotion.endDate);

    if (now < startDate) {
      return 'scheduled';
    }

    if (now > endDate) {
      return 'expired';
    }

    return 'active';
  }

  async update(
    id: string,
    updateDto: UpdatePromotionDto,
  ): Promise<Promotion | null> {
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

    if (
      Object.keys(corePromotionData).length > 0 ||
      normalizedCode !== undefined
    ) {
      const promotionUpdateData: Record<string, unknown> = {
        ...corePromotionData,
      };

      if (updateDto.startDate !== undefined || updateDto.endDate !== undefined) {
        const existingPromotion = await this.promotionRepository.findOne({
          where: { id },
          select: { id: true, startDate: true, endDate: true },
        });

        if (!existingPromotion) {
          throw new BadRequestException('Promotion not found.');
        }

        const { startDate, endDate } = this.normalizePromotionDateRange(
          updateDto.startDate ?? existingPromotion.startDate,
          updateDto.endDate ?? existingPromotion.endDate,
        );

        promotionUpdateData.startDate = startDate;
        promotionUpdateData.endDate = endDate;
      }

      try {
        await this.promotionRepository.update(id, {
          ...promotionUpdateData,
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
          eligibleProductIds.map((productId) => ({
            promotionId: id,
            productId,
          })),
        );
      }
    }

    if (eligibleTerritoryIds !== undefined) {
      await this.promotionTerritoryRepository.delete({ promotionId: id });
      if (eligibleTerritoryIds.length > 0) {
        await this.promotionTerritoryRepository.insert(
          eligibleTerritoryIds.map((territoryId) => ({
            promotionId: id,
            territoryId,
          })),
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
    const { promotion, discountAmount } =
      await this.evaluatePromotionEligibility({
        promotionId: dto.promotionId,
        code: dto.code,
        territoryId: dto.territoryId,
        shopId: dto.shopId,
        cartTotal: dto.cartTotal,
        cartItems: dto.cartItems.map((item) => ({
          productId: item.productId,
          quantity: Number(item.quantity) || 0,
        })),
      });

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
  ): Promise<{
    valid: boolean;
    discount: number;
    message: string;
    promotionId?: string;
  }> {
    try {
      const { promotion, discountAmount } =
        await this.evaluatePromotionEligibility({
          code,
          territoryId,
          shopId,
          cartTotal: orderTotal,
          cartItems: productIds.map((productId) => ({
            productId,
            quantity: 1,
          })),
        });

      return {
        valid: true,
        discount: discountAmount,
        message: 'Promotion applied successfully!',
        promotionId: promotion.id,
      };
    } catch (error) {
      return {
        valid: false,
        discount: 0,
        message:
          error instanceof BadRequestException
            ? this.readBadRequestMessage(error)
            : 'Invalid or inactive promotion code.',
      };
    }
  }

  async evaluatePromotionEligibility(
    options: PromotionEligibilityOptions,
  ): Promise<PromotionEligibilityResult> {
    const normalizedCode = this.normalizePromotionCode(options.code);

    if (!options.promotionId && !normalizedCode) {
      throw new BadRequestException(
        'Select a promotion before applying it to the cart.',
      );
    }

    const promotion = await this.findPromotionForEligibility(
      options.promotionId,
      normalizedCode,
    );

    if (!promotion) {
      throw new BadRequestException('Invalid or expired promotion code.');
    }

    if (
      normalizedCode &&
      this.normalizePromotionCode(promotion.code) !== normalizedCode
    ) {
      throw new BadRequestException(
        'The selected promotion code no longer matches this promotion.',
      );
    }

    if (this.resolvePromotionStatus(promotion) !== 'active') {
      throw new BadRequestException('This promotion is not currently active.');
    }

    if (
      promotion.eligibleTerritories &&
      promotion.eligibleTerritories.length > 0
    ) {
      const isEligibleTerritory = promotion.eligibleTerritories.some(
        (territory) => territory.territoryId === options.territoryId,
      );

      if (!isEligibleTerritory) {
        throw new BadRequestException(
          'Promotion not valid for your territory.',
        );
      }
    }

    if (
      promotion.minOrderValue &&
      options.cartTotal < Number(promotion.minOrderValue)
    ) {
      throw new BadRequestException(
        `Minimum order value of ${Number(promotion.minOrderValue).toLocaleString()} not met.`,
      );
    }

    const eligibleProductIds = new Set(
      promotion.eligibleProducts?.map((product) => product.productId) ?? [],
    );
    const applicableItems =
      eligibleProductIds.size > 0
        ? options.cartItems.filter((item) => eligibleProductIds.has(item.productId))
        : options.cartItems;

    if (eligibleProductIds.size > 0 && applicableItems.length === 0) {
      throw new BadRequestException(
        'Cart does not contain products eligible for this promotion.',
      );
    }

    const applicableQuantity = applicableItems.reduce(
      (sum, item) => sum + Math.max(0, Number(item.quantity) || 0),
      0,
    );

    if (
      promotion.minQuantity &&
      applicableQuantity < Number(promotion.minQuantity)
    ) {
      throw new BadRequestException(
        `Minimum quantity of ${Number(promotion.minQuantity)} item(s) not met.`,
      );
    }

    await this.assertUsageLimitAvailability(promotion, options.shopId);

    return {
      promotion,
      discountAmount: this.calculateDiscountAmount(
        promotion,
        options.cartTotal,
      ),
    };
  }

  async recordPromotionRedemption(
    promotionId: string,
    orderId: string,
    shopId: string,
    userId: string,
    discountAmount: number,
  ) {
    await this.promotionRedemptionRepository.insert({
      promotionId,
      orderId,
      shopId,
      userId,
      discountAmount: Number(discountAmount.toFixed(2)),
    });
  }

  private normalizePromotionCode(code?: string | null): string | null {
    if (code === undefined || code === null) {
      return null;
    }

    const normalizedCode = code.trim();
    return normalizedCode.length > 0 ? normalizedCode : null;
  }

  private normalizePromotionDateRange(startDate: Date, endDate: Date) {
    const normalizedStartDate = this.startOfDay(startDate);
    const normalizedEndDate = this.endOfDay(endDate);

    if (normalizedEndDate < normalizedStartDate) {
      throw new BadRequestException(
        'Promotion end date must be on or after the start date.',
      );
    }

    return {
      startDate: normalizedStartDate,
      endDate: normalizedEndDate,
    };
  }

  private startOfDay(value: Date) {
    return new Date(
      value.getFullYear(),
      value.getMonth(),
      value.getDate(),
      0,
      0,
      0,
      0,
    );
  }

  private endOfDay(value: Date) {
    return new Date(
      value.getFullYear(),
      value.getMonth(),
      value.getDate(),
      23,
      59,
      59,
      999,
    );
  }

  private async findPromotionForEligibility(
    promotionId?: string | null,
    code?: string | null,
  ) {
    if (promotionId) {
      return this.promotionRepository.findOne({
        where: { id: promotionId },
        relations: ['eligibleProducts', 'eligibleTerritories'],
      });
    }

    if (!code) {
      return null;
    }

    return this.promotionRepository.findOne({
      where: { code },
      relations: ['eligibleProducts', 'eligibleTerritories'],
    });
  }

  private async assertUsageLimitAvailability(
    promotion: Promotion,
    shopId?: string | null,
  ) {
    if (!promotion.usageLimit && !promotion.perShopLimit) {
      return;
    }

    const redemptions = await this.promotionRedemptionRepository.find({
      where: { promotionId: promotion.id },
    });

    if (
      promotion.usageLimit &&
      redemptions.length >= Number(promotion.usageLimit)
    ) {
      throw new BadRequestException('Promotion global usage limit reached.');
    }

    if (promotion.perShopLimit) {
      if (!shopId) {
        throw new BadRequestException(
          'This promotion requires a valid shop account.',
        );
      }

      const shopRedemptions = redemptions.filter(
        (redemption) => redemption.shopId === shopId,
      );

      if (shopRedemptions.length >= Number(promotion.perShopLimit)) {
        throw new BadRequestException(
          'Shop usage limit reached for this promotion.',
        );
      }
    }
  }

  private calculateDiscountAmount(promotion: Promotion, cartTotal: number) {
    let discountAmount = 0;

    if (promotion.discountType === 'percentage') {
      discountAmount = (cartTotal * Number(promotion.discountValue)) / 100;
    } else {
      discountAmount = Number(promotion.discountValue);
    }

    if (discountAmount > cartTotal) {
      discountAmount = cartTotal;
    }

    return Number(discountAmount.toFixed(2));
  }

  private readBadRequestMessage(error: BadRequestException) {
    const response = error.getResponse();

    if (typeof response === 'string') {
      return response;
    }

    if (
      typeof response === 'object' &&
      response !== null &&
      'message' in response
    ) {
      const message = response.message;
      if (typeof message === 'string') {
        return message;
      }
      if (Array.isArray(message) && typeof message[0] === 'string') {
        return message[0];
      }
    }

    return error.message;
  }

  private async ensurePromotionCodeIsUnique(
    code: string | null,
    excludePromotionId?: string,
  ) {
    if (!code) {
      return;
    }

    const existingPromotion = await this.promotionRepository.findOne({
      where: excludePromotionId
        ? { code, id: Not(excludePromotionId) }
        : { code },
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
