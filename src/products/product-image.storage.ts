import { mkdirSync } from 'fs';
import { join, extname } from 'path';

import { BadRequestException } from '@nestjs/common';
import { diskStorage } from 'multer';

const productsUploadDirectory = join(process.cwd(), 'uploads', 'products');
const allowedProductImageMimeTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

mkdirSync(productsUploadDirectory, { recursive: true });

function sanitizeFilenamePart(value: string) {
  const sanitized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);

  return sanitized || 'product';
}

export function createProductImageUploadOptions() {
  return {
    storage: diskStorage({
      destination: (_request, _file, callback) => {
        callback(null, productsUploadDirectory);
      },
      filename: (request, file, callback) => {
        const productName =
          typeof request.body?.productName === 'string'
            ? request.body.productName
            : 'product';

        const extension = extname(file.originalname).toLowerCase() || '.png';
        const filename = `${sanitizeFilenamePart(productName)}-${Date.now()}-${Math.round(
          Math.random() * 1_000_000_000,
        )}${extension}`;

        callback(null, filename);
      },
    }),
    limits: {
      fileSize: 5 * 1024 * 1024,
    },
    fileFilter: (_request, file, callback) => {
      if (!allowedProductImageMimeTypes.has(file.mimetype)) {
        callback(
          new BadRequestException({
            message: 'Upload a PNG, JPG, WEBP, or GIF image.',
            code: 'PRODUCT_IMAGE_INVALID_TYPE',
          }),
          false,
        );
        return;
      }

      callback(null, true);
    },
  };
}

export function buildProductImageUrl(filename: string) {
  return `/uploads/products/${filename}`;
}

export function resolveStoredProductImagePath(
  imageUrl: string | null | undefined,
) {
  if (!imageUrl?.startsWith('/uploads/products/')) {
    return null;
  }

  const filename = imageUrl.replace('/uploads/products/', '');
  return join(productsUploadDirectory, filename);
}
