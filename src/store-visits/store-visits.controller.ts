import {
  Body,
  Controller,
  Param,
  Patch,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Role } from '../common/enums/role.enum';
import { CompleteVisitDto } from './dto/complete-visit.dto';
import { StartVisitDto } from './dto/start-visit.dto';
import { CheckInVisitDto } from './dto/check-in-visit.dto';
import { StoreVisitsService } from './store-visits.service';
import { createVisitImageUploadOptions } from './visit-image.storage';

@Controller('store-visits')
@UseGuards(JwtAuthGuard)
export class StoreVisitsController {
  constructor(private readonly storeVisitsService: StoreVisitsService) {}

  @Post('start')
  @UseGuards(RolesGuard)
  @Roles(Role.SALES_REP)
  startVisit(@Req() req: any, @Body() dto: StartVisitDto) {
    return this.storeVisitsService.startVisit(req.user?.userId, dto);
  }

  @Post('check-in')
  @UseGuards(RolesGuard)
  @Roles(Role.SALES_REP)
  checkInVisit(@Req() req: any, @Body() dto: CheckInVisitDto) {
    return this.storeVisitsService.checkInVisit(req.user?.userId, dto);
  }

  @Patch(':id/complete')
  @UseGuards(RolesGuard)
  @Roles(Role.SALES_REP)
  completeVisit(
    @Param('id') visitId: string,
    @Req() req: any,
    @Body() dto: CompleteVisitDto,
  ) {
    return this.storeVisitsService.completeVisit(visitId, req.user?.userId, dto);
  }

  @Post(':id/photos')
  @UseGuards(RolesGuard)
  @Roles(Role.SALES_REP)
  @UseInterceptors(FileInterceptor('image', createVisitImageUploadOptions()))
  uploadPhoto(
    @Param('id') visitId: string,
    @Req() req: any,
    @UploadedFile() file: any,
  ) {
    return this.storeVisitsService.addPhotoToVisit(visitId, req.user?.userId, file.filename);
  }
}
