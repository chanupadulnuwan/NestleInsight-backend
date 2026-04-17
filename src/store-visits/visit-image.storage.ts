import { mkdirSync } from 'fs';
import { join, extname } from 'path';

import { BadRequestException } from '@nestjs/common';
import { diskStorage } from 'multer';

// Storage directory for visit photos
const visitsUploadDirectory = join(process.cwd(), 'uploads', 'visits');

const allowedVisitImageMimeTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

// Ensure directory exists
mkdirSync(visitsUploadDirectory, { recursive: true });

export function createVisitImageUploadOptions() {
  return {
    storage: diskStorage({
      destination: (_request, _file, callback) => {
        callback(null, visitsUploadDirectory);
      },
      filename: (request, file, callback) => {
        // Use visit ID or timestamp for filename
        const visitId = request.params?.id || 'visit';
        const timestamp = Date.now();
        const rand = Math.round(Math.random() * 1_000_000);
        const extension = extname(file.originalname).toLowerCase() || '.jpg';
        
        const filename = `visit-${visitId}-${timestamp}-${rand}${extension}`;
        callback(null, filename);
      },
    }),
    limits: {
      fileSize: 10 * 1024 * 1024, // 10MB limit for high-res evidence
    },
    fileFilter: (_request, file, callback) => {
      if (!allowedVisitImageMimeTypes.has(file.mimetype)) {
        callback(
          new BadRequestException({
            message: 'Upload a PNG, JPG, or WEBP image.',
            code: 'VISIT_IMAGE_INVALID_TYPE',
          }),
          false,
        );
        return;
      }

      callback(null, true);
    },
  };
}

export function buildVisitPhotoUrl(filename: string) {
  return `/uploads/visits/${filename}`;
}
