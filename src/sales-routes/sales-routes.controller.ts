import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';

import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Role } from '../common/enums/role.enum';
import { ApproveLoadRequestDto } from './dto/approve-load-request.dto';
import { CloseRouteDto } from './dto/close-route.dto';
import { LogReturnItemDto } from './dto/log-return-item.dto';
import { CreateRouteDto } from './dto/create-route.dto';
import { EnterPinDto } from './dto/enter-pin.dto';
import { SubmitLoadRequestDto } from './dto/submit-load-request.dto';
import { SalesRoutesService } from './sales-routes.service';

@Controller('sales-routes')
@UseGuards(JwtAuthGuard)
export class SalesRoutesController {
  constructor(private readonly salesRoutesService: SalesRoutesService) {}

  @Post()
  @UseGuards(RolesGuard)
  @Roles(Role.SALES_REP)
  createRoute(@Req() req: any, @Body() dto: CreateRouteDto) {
    return this.salesRoutesService.createRoute(req.user?.userId, dto);
  }

  @Post(':id/load-request')
  @UseGuards(RolesGuard)
  @Roles(Role.SALES_REP)
  submitLoadRequest(
    @Param('id') routeId: string,
    @Req() req: any,
    @Body() dto: SubmitLoadRequestDto,
  ) {
    return this.salesRoutesService.submitLoadRequest(
      routeId,
      req.user?.userId,
      dto,
    );
  }

  @Get('my')
  @UseGuards(RolesGuard)
  @Roles(Role.SALES_REP)
  getMyRoute(@Req() req: any) {
    return this.salesRoutesService.getMyRoute(req.user?.userId);
  }

  @Patch('load-requests/:id/review')
  @UseGuards(RolesGuard)
  @Roles(Role.REGIONAL_MANAGER, Role.TERRITORY_DISTRIBUTOR)
  approveLoadRequest(
    @Param('id') loadRequestId: string,
    @Req() req: any,
    @Body() dto: ApproveLoadRequestDto,
  ) {
    return this.salesRoutesService.approveLoadRequest(
      loadRequestId,
      req.user?.userId,
      dto,
    );
  }

  @Post(':id/start-pin')
  @UseGuards(RolesGuard)
  @Roles(Role.SALES_REP)
  enterStartPin(
    @Param('id') routeId: string,
    @Req() req: any,
    @Body() dto: EnterPinDto,
  ) {
    return this.salesRoutesService.enterStartPin(
      routeId,
      req.user?.userId,
      dto,
    );
  }

  @Post(':id/log-return')
  @UseGuards(RolesGuard)
  @Roles(Role.SALES_REP)
  logReturnItem(
    @Param('id') routeId: string,
    @Req() req: any,
    @Body() dto: LogReturnItemDto,
  ) {
    return this.salesRoutesService.logReturnItem(routeId, req.user?.userId, dto);
  }

  @Post(':id/close')
  @UseGuards(RolesGuard)
  @Roles(Role.SALES_REP)
  closeRoute(
    @Param('id') routeId: string,
    @Req() req: any,
    @Body() dto: CloseRouteDto,
  ) {
    return this.salesRoutesService.closeRoute(routeId, req.user?.userId, dto);
  }
}
