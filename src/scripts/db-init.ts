import 'reflect-metadata';

import { readFile } from 'fs/promises';
import { resolve } from 'path';

import { DataSource } from 'typeorm';

import { Category } from '../categories/entities/category.entity';
import { Product } from '../products/entities/product.entity';
import { databaseEntities } from '../database/database.entities';
import { seedInitialCatalog } from '../database/seeds/catalog.seeder';

async function main() {
  await loadEnvironmentFile();

  const connectionOptions = {
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parsePort(process.env.DB_PORT),
    username: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'nestle_insight',
    entities: databaseEntities,
    logging: false,
    synchronize: false,
  } as const;

  const dataSource = new DataSource(connectionOptions);

  try {
    console.log(
      `[db:init] Connecting to ${connectionOptions.database} on ${connectionOptions.host}:${connectionOptions.port} as ${connectionOptions.username}...`,
    );

    await dataSource.initialize();
    await ensurePostgresExtensions(dataSource);

    console.log('[db:init] Synchronizing schema...');
    await dataSource.synchronize();

    console.log('[db:init] Seeding catalog data...');
    const result = await seedInitialCatalog(
      dataSource.getRepository(Category),
      dataSource.getRepository(Product),
    );

    const [categoryCount, productCount] = await Promise.all([
      dataSource.getRepository(Category).count(),
      dataSource.getRepository(Product).count(),
    ]);

    console.log(
      `[db:init] Categories upserted: ${result.categoriesUpserted}. Products inserted: ${result.productsInserted}.`,
    );

    if (result.productsSkipped) {
      console.log(
        '[db:init] Product seeding was skipped because products already exist.',
      );
    }

    console.log(
      `[db:init] Complete. Categories: ${categoryCount}, Products: ${productCount}.`,
    );
  } finally {
    if (dataSource.isInitialized) {
      await dataSource.destroy();
    }
  }
}

async function loadEnvironmentFile() {
  const envPath = resolve(process.cwd(), '.env');

  try {
    const envContents = await readFile(envPath, 'utf8');

    for (const line of envContents.split(/\r?\n/)) {
      const trimmedLine = line.trim();

      if (!trimmedLine || trimmedLine.startsWith('#')) {
        continue;
      }

      const separatorIndex = trimmedLine.indexOf('=');
      if (separatorIndex === -1) {
        continue;
      }

      const key = trimmedLine.slice(0, separatorIndex).trim();
      const rawValue = trimmedLine.slice(separatorIndex + 1).trim();

      if (!key || process.env[key] !== undefined) {
        continue;
      }

      process.env[key] = stripWrappingQuotes(rawValue);
    }
  } catch (error) {
    if (!isFileMissingError(error)) {
      throw error;
    }
  }
}

async function ensurePostgresExtensions(dataSource: DataSource) {
  for (const extension of ['uuid-ossp', 'pgcrypto']) {
    try {
      await dataSource.query(`CREATE EXTENSION IF NOT EXISTS "${extension}"`);
    } catch (error) {
      console.warn(
        `[db:init] Warning: could not ensure PostgreSQL extension "${extension}". ${getErrorMessage(error)}`,
      );
    }
  }
}

function parsePort(rawPort: string | undefined) {
  const port = Number(rawPort || '5432');

  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`Invalid DB_PORT value: ${rawPort}`);
  }

  return port;
}

function stripWrappingQuotes(value: string) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function isFileMissingError(error: unknown): error is NodeJS.ErrnoException {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

void main().catch((error) => {
  console.error(`[db:init] Failed: ${getErrorMessage(error)}`);
  process.exitCode = 1;
});
