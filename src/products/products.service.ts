import { unlink } from 'fs/promises';

import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { seedCategories } from '../categories/categories.seed';
import { Category } from '../categories/entities/category.entity';
import { ProductStatus } from '../common/enums/product-status.enum';
import {
  buildProductImageUrl,
  resolveStoredProductImagePath,
} from './product-image.storage';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { Product } from './entities/product.entity';
import { seedProducts } from './products.seed';

type SerializedProduct = {
  id: string;
  productName: string;
  sku: string;
  categoryId: string;
  categoryName: string;
  brand: string | null;
  packSize: string;
  unitPrice: number;
  productsPerCase: number;
  casePrice: number;
  barcode: string | null;
  description: string | null;
  imageUrl: string | null;
  status: ProductStatus;
  createdAt: Date;
  updatedAt: Date;
};

type NormalizedProductInput = {
  productName?: string;
  sku?: string;
  categoryId?: string;
  brand?: string | null;
  packSize?: string;
  unitPrice?: number;
  productsPerCase?: number;
  casePrice?: number;
  barcode?: string | null;
  description?: string | null;
  status?: ProductStatus;
};

type UploadedProductImage = {
  filename: string;
};

@Injectable()
export class ProductsService implements OnModuleInit {
  constructor(
    @InjectRepository(Product)
    private readonly productsRepository: Repository<Product>,
    @InjectRepository(Category)
    private readonly categoriesRepository: Repository<Category>,
  ) {}

  async onModuleInit() {
    await this.seedInitialProducts();
  }

  async listProducts() {
    const products = await this.productsRepository.find();

    return {
      message: 'Products fetched successfully.',
      products: this.sortProducts(products).map((product) =>
        this.serializeProduct(product),
      ),
    };
  }

  async listActiveProductCatalog() {
    const [products, categories] = await Promise.all([
      this.productsRepository.find({
        where: {
          status: ProductStatus.ACTIVE,
        },
      }),
      this.categoriesRepository.find({
        order: {
          name: 'ASC',
        },
      }),
    ]);

    return {
      message: 'Active product catalog fetched successfully.',
      categories,
      products: this.sortProducts(products).map((product) =>
        this.serializeProduct(product),
      ),
    };
  }

  async checkSkuAvailability(sku: string, excludeProductId?: string) {
    const normalizedSku = sku.trim().toUpperCase();

    if (!normalizedSku) {
      return {
        isAvailable: false,
        message: 'Enter a SKU before checking availability.',
      };
    }

    const existingProduct = await this.productsRepository.findOne({
      where: {
        sku: normalizedSku,
      },
    });

    const isAvailable =
      !existingProduct || existingProduct.id === excludeProductId;

    return {
      isAvailable,
      message: isAvailable
        ? 'SKU is available.'
        : 'A product already exists with this SKU.',
    };
  }

  async createProduct(
    createProductDto: CreateProductDto,
    imageFile?: UploadedProductImage,
  ) {
    const normalizedInput = this.normalizeProductInput(createProductDto);
    const productName = normalizedInput.productName!;
    const sku = normalizedInput.sku!;
    const categoryId = normalizedInput.categoryId!;
    const packSize = normalizedInput.packSize!;
    const unitPrice = normalizedInput.unitPrice!;
    const productsPerCase = normalizedInput.productsPerCase!;

    await this.ensureSkuIsUnique(sku);

    const category = await this.findCategoryOrThrow(categoryId);
    const imageUrl = this.resolveRequiredImageUrl(imageFile);

    const product = this.productsRepository.create({
      productName,
      sku,
      categoryId: category.id,
      category,
      brand: normalizedInput.brand ?? null,
      packSize,
      unitPrice,
      productsPerCase,
      casePrice: this.resolveCasePrice(
        normalizedInput.casePrice,
        unitPrice,
        productsPerCase,
      ),
      barcode: normalizedInput.barcode ?? null,
      description: normalizedInput.description ?? null,
      imageUrl,
      status: normalizedInput.status ?? ProductStatus.ACTIVE,
    });

    const savedProduct = await this.productsRepository.save(product);
    return {
      message: 'Product created successfully.',
      product: this.serializeProduct(savedProduct),
    };
  }

  async updateProduct(
    productId: string,
    updateProductDto: UpdateProductDto,
    imageFile?: UploadedProductImage,
  ) {
    const product = await this.findProductOrThrow(productId);
    const normalizedInput = this.normalizeProductInput(updateProductDto);

    if (normalizedInput.sku && normalizedInput.sku !== product.sku) {
      await this.ensureSkuIsUnique(normalizedInput.sku, product.id);
    }

    const nextCategory = normalizedInput.categoryId
      ? await this.findCategoryOrThrow(normalizedInput.categoryId)
      : product.category;

    const nextUnitPrice = normalizedInput.unitPrice ?? product.unitPrice;
    const nextProductsPerCase =
      normalizedInput.productsPerCase ?? product.productsPerCase;
    const nextCasePrice = this.resolveCasePrice(
      normalizedInput.casePrice,
      nextUnitPrice,
      nextProductsPerCase,
    );

    const previousImageUrl = product.imageUrl;

    Object.assign(product, {
      productName: normalizedInput.productName ?? product.productName,
      sku: normalizedInput.sku ?? product.sku,
      categoryId: nextCategory.id,
      category: nextCategory,
      brand:
        normalizedInput.brand !== undefined
          ? normalizedInput.brand
          : product.brand,
      packSize: normalizedInput.packSize ?? product.packSize,
      unitPrice: nextUnitPrice,
      productsPerCase: nextProductsPerCase,
      casePrice: nextCasePrice,
      barcode:
        normalizedInput.barcode !== undefined
          ? normalizedInput.barcode
          : product.barcode,
      description:
        normalizedInput.description !== undefined
          ? normalizedInput.description
          : product.description,
      imageUrl: imageFile
        ? buildProductImageUrl(imageFile.filename)
        : product.imageUrl,
      status: normalizedInput.status ?? product.status,
    });

    const savedProduct = await this.productsRepository.save(product);

    if (imageFile) {
      await this.removeStoredImage(previousImageUrl);
    }

    return {
      message: 'Product updated successfully.',
      product: this.serializeProduct(savedProduct),
    };
  }

  private async seedInitialProducts() {
    await this.categoriesRepository.upsert(seedCategories, ['slug']);

    const existingProducts = await this.productsRepository.count();
    if (existingProducts > 0) {
      return;
    }

    const categories = await this.categoriesRepository.find();
    const categoriesBySlug = new Map(
      categories.map((category) => [category.slug, category]),
    );

    const productEntities = seedProducts.map((seedProduct) => {
      const category = categoriesBySlug.get(seedProduct.categorySlug);

      if (!category) {
        throw new Error(
          `Unable to seed product "${seedProduct.productName}" because category "${seedProduct.categorySlug}" was not found.`,
        );
      }

      return this.productsRepository.create({
        productName: seedProduct.productName,
        sku: seedProduct.sku,
        categoryId: category.id,
        category,
        brand: seedProduct.brand,
        packSize: seedProduct.packSize,
        unitPrice: this.roundCurrency(seedProduct.unitPrice),
        productsPerCase: seedProduct.productsPerCase,
        casePrice: this.resolveCasePrice(
          seedProduct.casePrice,
          seedProduct.unitPrice,
          seedProduct.productsPerCase,
        ),
        barcode: seedProduct.barcode ?? null,
        description: seedProduct.description ?? null,
        imageUrl: seedProduct.imageUrl,
        status: ProductStatus.ACTIVE,
      });
    });

    await this.productsRepository.save(productEntities);
  }

  private normalizeProductInput(
    input: CreateProductDto | UpdateProductDto,
  ): NormalizedProductInput {
    const output: NormalizedProductInput = {};

    if (input.productName !== undefined) {
      output.productName = input.productName.trim();
    }

    if (input.sku !== undefined) {
      output.sku = input.sku.trim().toUpperCase();
    }

    if (input.categoryId !== undefined) {
      output.categoryId = input.categoryId;
    }

    if (input.brand !== undefined) {
      output.brand = input.brand.trim() || null;
    }

    if (input.packSize !== undefined) {
      output.packSize = input.packSize.trim();
    }

    if (input.unitPrice !== undefined) {
      output.unitPrice = this.roundCurrency(input.unitPrice);
    }

    if (input.productsPerCase !== undefined) {
      output.productsPerCase = Number(input.productsPerCase);
    }

    if (input.casePrice !== undefined) {
      output.casePrice = this.roundCurrency(input.casePrice);
    }

    if (input.barcode !== undefined) {
      output.barcode = input.barcode.trim() || null;
    }

    if (input.description !== undefined) {
      output.description = input.description.trim() || null;
    }

    if (input.status !== undefined) {
      output.status = input.status;
    }

    return output;
  }

  private serializeProduct(product: Product): SerializedProduct {
    return {
      id: product.id,
      productName: product.productName,
      sku: product.sku,
      categoryId: product.categoryId,
      categoryName: product.category?.name ?? '',
      brand: product.brand,
      packSize: product.packSize,
      unitPrice: product.unitPrice,
      productsPerCase: product.productsPerCase,
      casePrice: product.casePrice,
      barcode: product.barcode,
      description: product.description,
      imageUrl: product.imageUrl,
      status: product.status,
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
    };
  }

  private sortProducts(products: Product[]) {
    return [...products].sort((left, right) => {
      const categoryCompare = (left.category?.name ?? '').localeCompare(
        right.category?.name ?? '',
      );

      if (categoryCompare !== 0) {
        return categoryCompare;
      }

      const nameCompare = left.productName.localeCompare(right.productName);
      if (nameCompare !== 0) {
        return nameCompare;
      }

      return left.packSize.localeCompare(right.packSize);
    });
  }

  private resolveCasePrice(
    casePrice: number | undefined,
    unitPrice: number,
    productsPerCase: number,
  ) {
    if (casePrice !== undefined) {
      return this.roundCurrency(casePrice);
    }

    return this.roundCurrency(unitPrice * productsPerCase);
  }

  private resolveRequiredImageUrl(imageFile?: UploadedProductImage) {
    if (!imageFile) {
      throw new BadRequestException({
        message: 'Select a product image before saving.',
        code: 'PRODUCT_IMAGE_REQUIRED',
      });
    }

    return buildProductImageUrl(imageFile.filename);
  }

  private async ensureSkuIsUnique(sku: string, excludeProductId?: string) {
    const existingProduct = await this.productsRepository.findOne({
      where: { sku },
    });

    if (existingProduct && existingProduct.id !== excludeProductId) {
      throw new BadRequestException({
        message: 'A product already exists with this SKU.',
        code: 'PRODUCT_SKU_NOT_UNIQUE',
      });
    }
  }

  private async findCategoryOrThrow(categoryId: string) {
    const category = await this.categoriesRepository.findOne({
      where: {
        id: categoryId,
      },
    });

    if (!category) {
      throw new BadRequestException({
        message: 'Select a valid product category.',
        code: 'PRODUCT_CATEGORY_NOT_FOUND',
      });
    }

    return category;
  }

  private async findProductOrThrow(productId: string) {
    const product = await this.productsRepository.findOne({
      where: {
        id: productId,
      },
    });

    if (!product) {
      throw new NotFoundException('Product not found.');
    }

    return product;
  }

  private async removeStoredImage(imageUrl: string | null) {
    const storedImagePath = resolveStoredProductImagePath(imageUrl);
    if (!storedImagePath) {
      return;
    }

    await unlink(storedImagePath).catch(() => undefined);
  }

  private roundCurrency(value: number) {
    return Number(Number(value).toFixed(2));
  }
}
