import { mkdirSync } from 'fs';
import { join, extname } from 'path';

import { BadRequestException } from '@nestjs/common';
import { diskStorage } from 'multer';

const plannerReportsUploadDirectory = join(process.cwd(), 'uploads', 'planner-reports');

mkdirSync(plannerReportsUploadDirectory, { recursive: true });

export function createPlannerReportUploadOptions() {
  return {
    storage: diskStorage({
      destination: (_request, _file, callback) => {
        callback(null, plannerReportsUploadDirectory);
      },
      filename: (_request, file, callback) => {
        const extension = extname(file.originalname).toLowerCase() || '.pdf';
        const filename = `planner-report-${Date.now()}-${Math.round(Math.random() * 1_000_000_000)}${extension}`;
        callback(null, filename);
      },
    }),
    limits: {
      fileSize: 20 * 1024 * 1024,
    },
    fileFilter: (_request, file, callback) => {
      if (file.mimetype !== 'application/pdf') {
        callback(
          new BadRequestException({
            message: 'Only PDF files are allowed.',
            code: 'PLANNER_REPORT_INVALID_TYPE',
          }),
          false,
        );
        return;
      }
      callback(null, true);
    },
  };
}

export function buildPlannerReportAttachmentUrl(filename: string) {
  return `/uploads/planner-reports/${filename}`;
}
