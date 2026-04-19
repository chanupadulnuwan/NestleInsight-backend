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
import { ConfirmRouteApprovalPinDto } from './dto/confirm-route-approval-pin.dto';
import { CreateRouteDto } from './dto/create-route.dto';
import { EnterPinDto } from './dto/enter-pin.dto';
import { LogReturnItemDto } from './dto/log-return-item.dto';
import { RequestDeliveryApprovalDto } from './dto/request-delivery-approval.dto';
import { ReviewRouteApprovalRequestDto } from './dto/review-route-approval-request.dto';
import { SubmitLoadRequestDto } from './dto/submit-load-request.dto';
import { UpdateRouteBeatPlanDto } from './dto/update-route-beat-plan.dto';
import { SalesRoutesService } from './sales-routes.service';

@Controller('sales-routes')
@UseGuards(JwtAuthGuard)
export class SalesRoutesController {
  constructor(private readonly salesRoutesService: SalesRoutesService) {}

  @Get('setup')
  @UseGuards(RolesGuard)
  @Roles(Role.SALES_REP)
  getSetupOptions(@Req() req: any) {
    return this.salesRoutesService.getSetupOptions(req.user?.userId);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles(Role.SALES_REP)
  createRoute(@Req() req: any, @Body() dto: CreateRouteDto) {
    return this.salesRoutesService.createRoute(req.user?.userId, dto);
  }

  @Patch(':id/beat-plan')
  @UseGuards(RolesGuard)
  @Roles(Role.SALES_REP)
  updateBeatPlan(
    @Param('id') routeId: string,
    @Req() req: any,
    @Body() dto: UpdateRouteBeatPlanDto,
  ) {
    return this.salesRoutesService.updateBeatPlan(
      routeId,
      req.user?.userId,
      dto,
    );
  }

  @Post(':id/delivery-approval-request')
  @UseGuards(RolesGuard)
  @Roles(Role.SALES_REP)
  requestDeliveryApproval(
    @Param('id') routeId: string,
    @Req() req: any,
    @Body() dto: RequestDeliveryApprovalDto,
  ) {
    return this.salesRoutesService.requestDeliveryApproval(
      routeId,
      req.user?.userId,
      dto,
    );
  }

  @Patch('approval-requests/:id/review')
  @UseGuards(RolesGuard)
  @Roles(Role.REGIONAL_MANAGER, Role.TERRITORY_DISTRIBUTOR)
  reviewDeliveryApprovalRequest(
    @Param('id') approvalRequestId: string,
    @Req() req: any,
    @Body() dto: ReviewRouteApprovalRequestDto,
  ) {
    return this.salesRoutesService.reviewDeliveryApprovalRequest(
      approvalRequestId,
      req.user?.userId,
      dto,
    );
  }

  @Post('approval-requests/:id/confirm-pin')
  @UseGuards(RolesGuard)
  @Roles(Role.SALES_REP)
  confirmDeliveryApprovalPin(
    @Param('id') approvalRequestId: string,
    @Req() req: any,
    @Body() dto: ConfirmRouteApprovalPinDto,
  ) {
    return this.salesRoutesService.confirmDeliveryApprovalPin(
      approvalRequestId,
      req.user?.userId,
      dto,
    );
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

  @Get('my/latest')
  @UseGuards(RolesGuard)
  @Roles(Role.SALES_REP)
  getMyLatestRoute(@Req() req: any) {
    return this.salesRoutesService.getLatestRoute(req.user?.userId);
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
    return this.salesRoutesService.logReturnItem(
      routeId,
      req.user?.userId,
      dto,
    );
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
