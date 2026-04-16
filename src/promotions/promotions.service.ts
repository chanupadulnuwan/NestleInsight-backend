import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Promotion } from './entities/promotion.entity';
import { PromotionProduct } from './entities/promotion-product.entity';
import { PromotionTerritory } from './entities/promotion-territory.entity';
import { PromotionRedemption } from './entities/promotion-redemption.entity';
import { CreatePromotionDto, UpdatePromotionDto } from './dto/promotions.dto';

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
    return this.promotionRepository.find();
  }

  async findActive(territoryId?: string): Promise<Promotion[]> {
    const qb = this.promotionRepository.createQueryBuilder('promotion')
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

    return qb.getMany();
  }

  async findOne(id: string): Promise<Promotion | null> {
    return this.promotionRepository.findOne({ where: { id } });
  }

  async update(id: string, updateDto: UpdatePromotionDto): Promise<Promotion | null> {
    await this.promotionRepository.update(id, updateDto);
    return this.findOne(id);
  }

  async remove(id: string): Promise<void> {
    await this.promotionRepository.delete(id);
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
