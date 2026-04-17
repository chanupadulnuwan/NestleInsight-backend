import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Promotion } from './entities/promotion.entity';
import { PromotionProduct } from './entities/promotion-product.entity';
import { PromotionTerritory } from './entities/promotion-territory.entity';
import { PromotionRedemption } from './entities/promotion-redemption.entity';
import { CreatePromotionDto, UpdatePromotionDto } from './dto/promotions.dto';
import { ValidatePromotionDto } from './dto/validate-promotion.dto';

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

  async create(createPromotionDto: CreatePromotionDto) {
    // 1. Create the base object from the DTO
    const promotion = this.promotionRepository.create(createPromotionDto);
    
    // 2. FORCE the admin ID onto the object. 
    // ⚠️ CRITICAL: Change "createdBy" to "created_by" if that is what your Entity uses!
    promotion.createdBy = '2ea3fb82-c6c2-4049-a9c0-d18da6221d45'; 
    
    // 3. Save to the database
    return await this.promotionRepository.save(promotion);
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
        'pt.promotion_id = promotion.id'
      ).andWhere('pt.territory_id = :territoryId', { territoryId });
    }

    const promotions = await qb.getMany();
    return promotions.map((p) => this.mapPromotionRelations(p));
  }

  async findOne(id: string): Promise<Promotion | null> {
    const promotion = await this.promotionRepository.findOne({
      where: { id },
      relations: ['eligibleProducts', 'eligibleProducts.product', 'eligibleTerritories'],
    });
    return promotion ? this.mapPromotionRelations(promotion) : null;
  }

  private mapPromotionRelations(promotion: Promotion): Promotion {
    promotion.eligibleProductIds = promotion.eligibleProducts?.map((p) => p.productId) || [];
    promotion.eligibleTerritoryIds = promotion.eligibleTerritories?.map((t) => t.territoryId) || [];
    promotion.eligibleProductNames = promotion.eligibleProducts
      ?.map((p) => p.product?.productName)
      .filter((name): name is string => !!name) || [];
    
    // Detailed objects for UI
    promotion.eligibleProductsDetail = promotion.eligibleProducts
      ?.map((p) => ({
        id: p.product?.id,
        productName: p.product?.productName,
        imageUrl: p.product?.imageUrl,
      }))
      .filter((p) => !!p.id) || [];

    return promotion;
  }

  async update(id: string, updateDto: UpdatePromotionDto): Promise<Promotion | null> {
    // 1. Destructure the relational arrays OUT of the DTO so they are never
    //    passed to .update(), which only handles flat scalar columns.
    const { eligibleProductIds, eligibleTerritoryIds, ...corePromotionData } = updateDto;

    // 2. Update only the flat columns (skip if nothing scalar was sent).
    if (Object.keys(corePromotionData).length > 0) {
      await this.promotionRepository.update(id, corePromotionData);
    }

    // 3. Sync eligible products (if provided in this request).
    if (eligibleProductIds !== undefined) {
      await this.promotionProductRepository.delete({ promotionId: id });
      if (eligibleProductIds.length > 0) {
        await this.promotionProductRepository.insert(
          eligibleProductIds.map((productId) => ({ promotionId: id, productId })),
        );
      }
    }

    // 4. Sync eligible territories (if provided in this request).
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
    await this.promotionRepository.delete(id);
  }

  async validatePromotion(dto: ValidatePromotionDto) {
    // 1. Find promotion by code
    const promotion = await this.promotionRepository.findOne({
      where: { code: dto.code, status: 'active' },
      relations: ['eligibleProducts', 'eligibleTerritories'],
    });

    if (!promotion) {
      throw new BadRequestException('Invalid or expired promotion code.');
    }

    // 2. Check date range
    const now = new Date();
    if (now < promotion.startDate || now > promotion.endDate) {
      throw new BadRequestException('This promotion is not currently active.');
    }

    // 3. Check territory eligibility
    if (promotion.eligibleTerritories && promotion.eligibleTerritories.length > 0) {
      const isEligible = promotion.eligibleTerritories.some(
        (t) => t.territoryId === dto.territoryId,
      );
      if (!isEligible) {
        throw new BadRequestException('Promotion not valid for your territory.');
      }
    }

    // 4. Check min_order_value against cartTotal
    if (promotion.minOrderValue && dto.cartTotal < Number(promotion.minOrderValue)) {
      throw new BadRequestException(
        `Minimum order value of ₦${Number(promotion.minOrderValue).toLocaleString()} not met.`,
      );
    }

    // 5. Check Product Scope
    // If eligibleProducts exist, at least one cart item must match
    if (promotion.eligibleProducts && promotion.eligibleProducts.length > 0) {
      const eligibleIds = promotion.eligibleProducts.map((p) => p.productId);
      const hasEligibleItem = dto.cartItems.some((item) => eligibleIds.includes(item.productId));
      
      if (!hasEligibleItem) {
        throw new BadRequestException('Cart does not contain products eligible for this promotion.');
      }
    }

    // 6. Calculate Discount
    let discountAmount = 0;
    if (promotion.discountType === 'percentage') {
      discountAmount = (dto.cartTotal * Number(promotion.discountValue)) / 100;
    } else {
      discountAmount = Number(promotion.discountValue);
    }

    // Cap discount at cart total
    if (discountAmount > dto.cartTotal) {
      discountAmount = dto.cartTotal;
    }

    // 7. Return
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
    const promotion = await this.promotionRepository.findOne({ where: { code, status: 'active' } });
    if (!promotion) {
      return { valid: false, discount: 0, message: 'Invalid or inactive promotion code.' };
    }

    const now = new Date();
    if (now < promotion.startDate || now > promotion.endDate) {
      return { valid: false, discount: 0, message: 'Promotion is not currently valid.' };
    }

    if (promotion.minOrderValue && orderTotal < promotion.minOrderValue) {
      return { valid: false, discount: 0, message: `Minimum order value not met (${promotion.minOrderValue}).` };
    }

    const territories = await this.promotionTerritoryRepository.find({ where: { promotionId: promotion.id } });
    if (territories.length > 0) {
      const isEligibleTerritory = territories.some(t => t.territoryId === territoryId);
      if (!isEligibleTerritory) {
        return { valid: false, discount: 0, message: 'Promotion not valid for this territory.' };
      }
    }

    const products = await this.promotionProductRepository.find({ where: { promotionId: promotion.id } });
    if (products.length > 0) {
      const hasEligibleProduct = products.some(p => productIds.includes(p.productId));
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
        const shopRedemptions = redemptions.filter(r => r.shopId === shopId);
        if (shopRedemptions.length >= promotion.perShopLimit) {
          return { valid: false, discount: 0, message: 'Shop usage limit reached for this promotion.' };
        }
      }
    }

    let discount = 0;
    if (promotion.discountType === 'PERCENTAGE') {
      discount = (orderTotal * promotion.discountValue) / 100;
      if (discount > orderTotal) discount = orderTotal;
    } else if (promotion.discountType === 'FIXED') {
      discount = Number(promotion.discountValue);
      if (discount > orderTotal) discount = orderTotal;
    }

    return { valid: true, discount, message: 'Promotion applied successfully!', promotionId: promotion.id };
  }
}
