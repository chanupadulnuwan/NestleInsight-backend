import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { SubmitFeedbackDto } from './dto/submit-feedback.dto';
import { SubmitOrderFeedbackDto } from './dto/submit-order-feedback.dto';
import { ActivityService } from './activity.service';

@Controller('activities')
export class ActivityController {
  constructor(private readonly activityService: ActivityService) { }

  @UseGuards(JwtAuthGuard)
  @Get()
  getMyActivity(@Req() req: any) {
    return this.activityService.listForUser(req.user?.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('my')
  getMyActivityExplicit(@Req() req: any) {
    return this.getMyActivity(req);
  }

  @UseGuards(JwtAuthGuard)
  @Post('feedback')
  submitFeedback(@Req() req: any, @Body() submitFeedbackDto: SubmitFeedbackDto) {
    return this.activityService.submitFeedbackForUser(
      req.user?.userId,
      submitFeedbackDto.message,
    );
  }

  /**
   * POST /activities/order-feedback
   *
   * Shop Owner submits a star-rating + comment for a completed order.
   * shopOwnerId and territoryId are taken from the verified JWT payload
   * — the client payload only supplies orderId, rating, and comment.
   */
  @UseGuards(JwtAuthGuard)
  @Post('order-feedback')
  submitOrderFeedback(
    @Req() req: any,
    @Body() dto: SubmitOrderFeedbackDto,
  ) {
    const { userId: shopOwnerId, territoryId } = req.user as {
      userId: string;
      territoryId: string;
    };

    return this.activityService.submitOrderFeedback(shopOwnerId, territoryId, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.TERRITORY_DISTRIBUTOR, Role.REGIONAL_MANAGER, Role.SALES_REP) // 👈 ADDED SALES_REP
  @Get('feedback/my-territory')
  getMyTerritoryOrderFeedback(@Req() req: any) {
    const { territoryId } = req.user as { territoryId: string | null };

    if (!territoryId) {
      return [];
    }

    return this.activityService.getFeedbackByTerritory(territoryId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.TERRITORY_DISTRIBUTOR, Role.REGIONAL_MANAGER, Role.SALES_REP) // 👈 ADDED SALES_REP
  @Get('text-feedback/my-territory')
  getMyTerritoryTextFeedback(@Req() req: any) {
    const { territoryId } = req.user as { territoryId: string | null };

    if (!territoryId) {
      return [];
    }

    return this.activityService.getTextFeedbackByTerritory(territoryId);
  }
}
