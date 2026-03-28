import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Role } from '../common/enums/role.enum';
import { createProductImageUploadOptions } from './product-image.storage';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductsService } from './products.service';

type UploadedProductImage = {
  filename: string;
};

@Controller('products')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get('catalog')
  @Roles(Role.ADMIN, Role.SHOP_OWNER)
  listActiveProductCatalog() {
    return this.productsService.listActiveProductCatalog();
  }

  @Get()
  listProducts() {
    return this.productsService.listProducts();
  }

  @Get('sku-availability')
  checkSkuAvailability(
    @Query('sku') sku: string,
    @Query('excludeProductId') excludeProductId?: string,
  ) {
    return this.productsService.checkSkuAvailability(sku, excludeProductId);
  }

  @Post()
  @UseInterceptors(FileInterceptor('image', createProductImageUploadOptions()))
  createProduct(
    @Body() createProductDto: CreateProductDto,
    @UploadedFile() imageFile?: UploadedProductImage,
  ) {
    return this.productsService.createProduct(createProductDto, imageFile);
  }

  @Patch(':id')
  @UseInterceptors(FileInterceptor('image', createProductImageUploadOptions()))
  updateProduct(
    @Param('id') id: string,
    @Body() updateProductDto: UpdateProductDto,
    @UploadedFile() imageFile?: UploadedProductImage,
  ) {
    return this.productsService.updateProduct(id, updateProductDto, imageFile);
  }
}
