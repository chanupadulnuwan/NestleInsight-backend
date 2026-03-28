import { Repository } from 'typeorm';

import { seedCategories } from '../../categories/categories.seed';
import { Category } from '../../categories/entities/category.entity';
import { ProductStatus } from '../../common/enums/product-status.enum';
import { Product } from '../../products/entities/product.entity';
import { seedProducts } from '../../products/products.seed';

export type CatalogSeedResult = {
  categoriesUpserted: number;
  productsInserted: number;
  productsSkipped: boolean;
};

export async function upsertSeedCategories(
  categoriesRepository: Repository<Category>,
) {
  await categoriesRepository.upsert(seedCategories, ['slug']);
  return seedCategories.length;
}

export async function seedInitialCatalog(
  categoriesRepository: Repository<Category>,
  productsRepository: Repository<Product>,
): Promise<CatalogSeedResult> {
  await upsertSeedCategories(categoriesRepository);

  const existingProducts = await productsRepository.count();
  if (existingProducts > 0) {
    return {
      categoriesUpserted: seedCategories.length,
      productsInserted: 0,
      productsSkipped: true,
    };
  }

  const categories = await categoriesRepository.find();
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

    return productsRepository.create({
      productName: seedProduct.productName,
      sku: seedProduct.sku,
      categoryId: category.id,
      category,
      brand: seedProduct.brand,
      packSize: seedProduct.packSize,
      unitPrice: roundCurrency(seedProduct.unitPrice),
      productsPerCase: seedProduct.productsPerCase,
      casePrice: resolveCasePrice(
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

  await productsRepository.save(productEntities);

  return {
    categoriesUpserted: seedCategories.length,
    productsInserted: productEntities.length,
    productsSkipped: false,
  };
}

function resolveCasePrice(
  casePrice: number | undefined,
  unitPrice: number,
  productsPerCase: number,
) {
  if (casePrice !== undefined) {
    return roundCurrency(casePrice);
  }

  return roundCurrency(unitPrice * productsPerCase);
}

function roundCurrency(value: number) {
  return Number(Number(value).toFixed(2));
}
