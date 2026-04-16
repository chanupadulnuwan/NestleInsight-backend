import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { PromotionsService } from './promotions.service';
import { PromotionsController } from './promotions.controller';
import { Promotion } from './entities/promotion.entity';
import { PromotionProduct } from './entities/promotion-product.entity';
import { PromotionTerritory } from './entities/promotion-territory.entity';
import { PromotionRedemption } from './entities/promotion-redemption.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Promotion,
      PromotionProduct,
      PromotionTerritory,
      PromotionRedemption,
    ]),
  ],
  controllers: [PromotionsController],
  providers: [PromotionsService],
  exports: [PromotionsService],
})
export class PromotionsModule {}
