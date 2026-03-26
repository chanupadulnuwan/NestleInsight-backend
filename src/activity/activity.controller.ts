import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SubmitFeedbackDto } from './dto/submit-feedback.dto';
import { ActivityService } from './activity.service';

@Controller('activities')
export class ActivityController {
  constructor(private readonly activityService: ActivityService) {}

  @UseGuards(JwtAuthGuard)
  @Get()
  getMyActivity(@Req() req: any) {
    return this.activityService.listForUser(req.user?.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('feedback')
  submitFeedback(@Req() req: any, @Body() submitFeedbackDto: SubmitFeedbackDto) {
    return this.activityService.submitFeedbackForUser(
      req.user?.userId,
      submitFeedbackDto.message,
    );
  }
}
