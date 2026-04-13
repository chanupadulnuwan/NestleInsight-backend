import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ActivityService } from '../activity/activity.service';
import { Outlet, OutletStatus } from './entities/outlet.entity';
import { CreateOutletDto } from './dto/create-outlet.dto';
import { ReviewOutletDto } from './dto/review-outlet.dto';

@Injectable()
export class OutletsService {
  constructor(
    @InjectRepository(Outlet)
    private readonly outletsRepo: Repository<Outlet>,
    private readonly activityService: ActivityService,
  ) {}

  async createOutlet(userId: string, dto: CreateOutletDto): Promise<Outlet> {
    const outlet = this.outletsRepo.create({
      outletName: dto.outletName,
      ownerName: dto.ownerName,
      ownerPhone: dto.ownerPhone,
      ownerEmail: dto.ownerEmail,
      address: dto.address,
      latitude: dto.latitude,
      longitude: dto.longitude,
      status: OutletStatus.PENDING_APPROVAL,
      registeredBySalesRepId: userId,
    });

    const savedOutlet = await this.outletsRepo.save(outlet);

    await this.activityService.logForUser({
      userId,
      type: 'OUTLET_CREATED',
      title: 'Outlet Created',
      message: `Outlet "${dto.outletName}" has been registered and is pending approval`,
      metadata: {
        outletId: savedOutlet.id,
        outletName: savedOutlet.outletName,
        status: savedOutlet.status,
      },
    });

    return savedOutlet;
  }

  async getPendingOutlets(): Promise<Outlet[]> {
    return this.outletsRepo.find({
      where: { status: OutletStatus.PENDING_APPROVAL },
      order: { createdAt: 'ASC' },
    });
  }

  async reviewOutlet(
    outletId: string,
    userId: string,
    dto: ReviewOutletDto,
  ): Promise<Outlet> {
    const outlet = await this.outletsRepo.findOne({ where: { id: outletId } });
    if (!outlet) {
      throw new NotFoundException(`Outlet with id ${outletId} not found`);
    }

    if (outlet.status !== OutletStatus.PENDING_APPROVAL) {
      throw new BadRequestException(
        `Outlet is not in PENDING_APPROVAL status (current: ${outlet.status})`,
      );
    }

    const newStatus =
      dto.decision === 'APPROVED' ? OutletStatus.APPROVED : OutletStatus.REJECTED;

    outlet.status = newStatus;
    outlet.reviewedBy = userId;
    outlet.reviewedAt = new Date();
    if (dto.decision === 'REJECTED') {
      outlet.rejectionReason = dto.rejectionReason || null;
    }

    const updatedOutlet = await this.outletsRepo.save(outlet);

    const activityMessage =
      dto.decision === 'APPROVED'
        ? `Outlet "${outlet.outletName}" has been approved`
        : `Outlet "${outlet.outletName}" has been rejected`;

    await this.activityService.logForUser({
      userId,
      type: `OUTLET_${dto.decision}`,
      title: `Outlet ${dto.decision}`,
      message: activityMessage,
      metadata: {
        outletId: updatedOutlet.id,
        outletName: updatedOutlet.outletName,
        decision: dto.decision,
        rejectionReason: updatedOutlet.rejectionReason,
      },
    });

    return updatedOutlet;
  }
}
