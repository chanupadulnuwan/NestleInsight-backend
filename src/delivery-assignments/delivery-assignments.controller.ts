import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';

import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PortalApprovalGuard } from '../auth/guards/portal-approval.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Role } from '../common/enums/role.enum';
import { DeliveryAssignmentsService } from './delivery-assignments.service';
import { AddNoteDto } from './dto/add-note.dto';
import { CompleteOrderDto } from './dto/complete-order.dto';
import { CreateAssignmentDto } from './dto/create-assignment.dto';
import { GenerateReturnPinDto } from './dto/generate-return-pin.dto';
import { ReportIncidentDto } from './dto/report-incident.dto';
import { SubmitShopReturnDto } from './dto/submit-shop-return.dto';
import { SubmitReturnDto } from './dto/submit-return.dto';

@Controller('delivery-assignments')
export class DeliveryAssignmentsController {
  constructor(private readonly service: DeliveryAssignmentsService) {}

  // ── Territory Manager (web) ──────────────────────────────────────────────

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard, PortalApprovalGuard)
  @Roles(Role.REGIONAL_MANAGER)
  createAssignment(@Request() req: any, @Body() dto: CreateAssignmentDto) {
    return this.service.createAssignment(req.user.userId, dto);
  }

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard, PortalApprovalGuard)
  @Roles(Role.REGIONAL_MANAGER)
  listAssignments(
    @Request() req: any,
    @Query('date') date?: string,
  ) {
    return this.service.listAssignments(req.user.userId, date);
  }

  @Post('return-pin')
  @UseGuards(JwtAuthGuard, RolesGuard, PortalApprovalGuard)
  @Roles(Role.REGIONAL_MANAGER)
  generateReturnPin(@Request() req: any, @Body() dto: GenerateReturnPinDto) {
    return this.service.generateReturnPin(req.user.userId, dto.assignmentId);
  }

  @Get('returns')
  @UseGuards(JwtAuthGuard, RolesGuard, PortalApprovalGuard)
  @Roles(Role.REGIONAL_MANAGER)
  listReturns(@Request() req: any) {
    return this.service.listReturns(req.user.userId);
  }

  @Get('incidents')
  @UseGuards(JwtAuthGuard, RolesGuard, PortalApprovalGuard)
  @Roles(Role.REGIONAL_MANAGER)
  listIncidents(@Request() req: any) {
    return this.service.listIncidents(req.user.userId);
  }

  // ── Distributor (mobile) ─────────────────────────────────────────────────

  @Get('my')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.TERRITORY_DISTRIBUTOR)
  getMyAssignment(@Request() req: any) {
    return this.service.getMyAssignment(req.user.userId);
  }

  @Post('orders/:orderId/complete')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.TERRITORY_DISTRIBUTOR)
  completeOrder(
    @Request() req: any,
    @Param('orderId') orderId: string,
    @Body() dto: CompleteOrderDto,
  ) {
    return this.service.completeOrder(req.user.userId, orderId, dto.pin);
  }

  @Post(':assignmentId/returns')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.TERRITORY_DISTRIBUTOR)
  submitReturn(
    @Request() req: any,
    @Param('assignmentId') assignmentId: string,
    @Body() dto: SubmitReturnDto,
  ) {
    return this.service.submitReturn(req.user.userId, assignmentId, dto);
  }

  @Post('incidents')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.TERRITORY_DISTRIBUTOR)
  reportIncident(@Request() req: any, @Body() dto: ReportIncidentDto) {
    return this.service.reportIncident(req.user.userId, dto);
  }

  @Post('orders/:orderId/request-delivery-pin')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.TERRITORY_DISTRIBUTOR)
  requestDeliveryPin(@Request() req: any, @Param('orderId') orderId: string) {
    return this.service.requestDeliveryPin(req.user.userId, orderId);
  }

  @Post('orders/:orderId/request-shop-return-pin')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.TERRITORY_DISTRIBUTOR)
  requestShopReturnPin(@Request() req: any, @Param('orderId') orderId: string) {
    return this.service.requestShopReturnPin(req.user.userId, orderId);
  }

  @Post('orders/:orderId/submit-shop-return')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.TERRITORY_DISTRIBUTOR)
  submitShopReturn(
    @Request() req: any,
    @Param('orderId') orderId: string,
    @Body() dto: SubmitShopReturnDto,
  ) {
    return this.service.submitShopReturn(req.user.userId, orderId, dto);
  }

  @Post(':assignmentId/request-warehouse-return-pin')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.TERRITORY_DISTRIBUTOR)
  requestWarehouseReturnPin(
    @Request() req: any,
    @Param('assignmentId') assignmentId: string,
  ) {
    return this.service.requestWarehouseReturnPin(req.user.userId, assignmentId);
  }

  @Post('notes')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.TERRITORY_DISTRIBUTOR)
  addNote(@Request() req: any, @Body() dto: AddNoteDto) {
    return this.service.addDistributorNote(req.user.userId, dto);
  }
}
