import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Category } from './entities/category.entity';
import { seedCategories } from './categories.seed';

@Injectable()
export class CategoriesService implements OnModuleInit {
  constructor(
    @InjectRepository(Category)
    private readonly categoriesRepository: Repository<Category>,
  ) {}

  async onModuleInit() {
    await this.seedInitialCategories();
  }

  async listCategories() {
    const categories = await this.categoriesRepository.find({
      order: {
        name: 'ASC',
      },
    });

    return {
      message: 'Categories fetched successfully.',
      categories,
    };
  }

  private async seedInitialCategories() {
    await this.categoriesRepository.upsert(seedCategories, ['slug']);
  }
}
