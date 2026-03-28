import { existsSync } from 'fs';
import { join } from 'path';

import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';

import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const port = parseInt(process.env.PORT ?? '3000', 10);
  const host = process.env.HOST ?? '0.0.0.0';

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  app.enableCors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });

  app.useStaticAssets(join(process.cwd(), 'uploads'), {
    prefix: '/uploads/',
  });

  // Serve web frontend if web-dist folder exists (production)
  const webDistPath = join(process.cwd(), 'web-dist');
  const spaIndexPath = join(webDistPath, 'index.html');
  if (existsSync(webDistPath)) {
    app.useStaticAssets(webDistPath);

    // SPA fallback: return index.html for any path that isn't an API route or a static file
    const expressApp = app.getHttpAdapter().getInstance() as any;
    expressApp.use((req: any, res: any, next: any) => {
      const p: string = req.path ?? '';
      const isApiRoute = /^\/(auth|users|products|categories|orders|territories|warehouses|vehicles|activity|delivery-assignments|tm|uploads)(\/|$)/.test(p);
      const isFile = p.includes('.');
      if (!isApiRoute && !isFile && existsSync(spaIndexPath)) {
        res.sendFile(spaIndexPath);
      } else {
        next();
      }
    });
  }

  await app.listen(port, host);
}
bootstrap();
