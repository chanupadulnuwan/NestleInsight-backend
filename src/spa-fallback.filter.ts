import { existsSync } from 'fs';
import { join } from 'path';

import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from '@nestjs/common';
import { Request, Response } from 'express';

/**
 * Global filter that serves the React SPA index.html for browser navigation
 * requests that hit API routes returning 404 or 401/403.
 *
 * Browser navigations (page refresh / direct URL) always include "text/html"
 * in their Accept header. Axios/fetch API calls from the SPA send
 * "application/json" — those receive the normal JSON error response.
 */
@Catch(HttpException)
export class SpaFallbackFilter implements ExceptionFilter {
  private readonly indexPath = join(process.cwd(), 'web-dist', 'index.html');

  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();
    const status = exception.getStatus();

    const accept = (req.headers['accept'] as string) ?? '';
    const isBrowserNav =
      accept.includes('text/html') && !accept.startsWith('application/json');

    if (
      (status === 404 || status === 401 || status === 403) &&
      isBrowserNav &&
      existsSync(this.indexPath)
    ) {
      return res.sendFile(this.indexPath);
    }

    res.status(status).json(exception.getResponse());
  }
}
