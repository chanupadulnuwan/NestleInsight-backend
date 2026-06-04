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
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  /**
   * GET /products/public
   * 
   * A completely public endpoint that lists all active products in the system.
   * This is used by the marketing/public catalog page so guest users can browse
   * the Nestle product selection (Milo, Nescafe, Maggi, etc.) without logging in.
   */
  @Get('public')
  listPublicProducts() {
    return this.productsService.listActiveProductCatalog();
  }

  /**
   * GET /products/catalog
   * 
   * Fetches the active catalog for logged-in business users.
   * Accessible by Admins, Shop Owners, Sales Reps, and Territory Distributors.
   * Returns active products grouped/sorted by category.
   */
  @Get('catalog')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(
    Role.ADMIN,
    Role.SHOP_OWNER,
    Role.SALES_REP,
    Role.TERRITORY_DISTRIBUTOR,
  )
  listActiveProductCatalog() {
    return this.productsService.listActiveProductCatalog();
  }

  /**
   * GET /products
   * 
   * Fetches the complete list of all products in the database, including inactive ones.
   * Restricted to Admin and Demand Planner roles for inventory tracking and system management.
   */
  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.DEMAND_PLANNER)
  listProducts() {
    return this.productsService.listProducts();
  }

  /**
   * GET /products/sku-availability
   * 
   * Checks if a proposed SKU (Stock Keeping Unit) code is available or already in use.
   * Restricted to Admin to prevent duplicate SKUs when creating or renaming products.
   */
  @Get('sku-availability')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  checkSkuAvailability(
    @Query('sku') sku: string,
    @Query('excludeProductId') excludeProductId?: string,
  ) {
    return this.productsService.checkSkuAvailability(sku, excludeProductId);
  }

  /**
   * POST /products
   * 
   * Creates a new product in the database.
   * Restricted to Admin.
   * Uses FileInterceptor to handle product image upload and save it in the system.
   */
  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @UseInterceptors(FileInterceptor('image', createProductImageUploadOptions()))
  createProduct(
    @Body() createProductDto: CreateProductDto,
    @UploadedFile() imageFile?: UploadedProductImage,
  ) {
    return this.productsService.createProduct(createProductDto, imageFile);
  }

  /**
   * PATCH /products/:id
   * 
   * Updates an existing product's details or updates its image.
   * Restricted to Admin.
   * Automatically replaces and deletes the old product image from the filesystem if a new one is uploaded.
   */
  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @UseInterceptors(FileInterceptor('image', createProductImageUploadOptions()))
  updateProduct(
    @Param('id') id: string,
    @Body() updateProductDto: UpdateProductDto,
    @UploadedFile() imageFile?: UploadedProductImage,
  ) {
    return this.productsService.updateProduct(id, updateProductDto, imageFile);
  }
}
