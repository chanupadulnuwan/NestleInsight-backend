import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ActivityService } from '../activity/activity.service';
import { CreateOutletDto } from './dto/create-outlet.dto';
import { ReviewOutletDto } from './dto/review-outlet.dto';
import { Outlet, OutletStatus } from './entities/outlet.entity';

type CreateOutletInput = {
  userId: string;
  territoryId?: string | null;
  warehouseId?: string | null;
  dto: CreateOutletDto;
};

@Injectable()
export class OutletsService {
  constructor(
    @InjectRepository(Outlet)
    private readonly outletsRepo: Repository<Outlet>,
    private readonly activityService: ActivityService,
  ) {}

  async createOutlet({
    userId,
    territoryId,
    warehouseId,
    dto,
  }: CreateOutletInput): Promise<Outlet> {
    const resolvedTerritoryId =
      territoryId?.trim() || dto.territoryId?.trim() || null;

    if (!resolvedTerritoryId) {
      throw new BadRequestException(
        'No territory is assigned to this sales rep account.',
      );
    }

    const outlet = this.outletsRepo.create({
      outletName: dto.outletName,
      ownerName: dto.ownerName,
      ownerPhone: dto.contactNumber,
      ownerEmail: dto.ownerEmail || null,
      address: dto.address || null,
      latitude: dto.latitude,
      longitude: dto.longitude,
      territoryId: resolvedTerritoryId,
      warehouseId: warehouseId?.trim() || null,
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
        territoryId: savedOutlet.territoryId,
        warehouseId: savedOutlet.warehouseId,
      },
    });

    return savedOutlet;
  }

  async getMyTerritoryOutlets(
    salesRepId: string,
    territoryId: string | null,
  ): Promise<Outlet[]> {
    const where: any = { registeredBySalesRepId: salesRepId };
    if (territoryId) {
      where.territoryId = territoryId;
    }
    return this.outletsRepo.find({
      where,
      order: { createdAt: 'ASC' },
    });
  }

  async getPendingOutlets(warehouseId?: string | null): Promise<Outlet[]> {
    const where: any = { status: OutletStatus.PENDING_APPROVAL };
    if (warehouseId?.trim()) {
      where.warehouseId = warehouseId.trim();
    }

    return this.outletsRepo.find({
      where,
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
      dto.decision === 'APPROVED'
        ? OutletStatus.APPROVED
        : OutletStatus.REJECTED;

    outlet.status = newStatus;
    outlet.reviewedBy = userId;
    outlet.reviewedAt = new Date();
    if (dto.decision === 'REJECTED') {
      outlet.rejectionReason = dto.rejectionReason || null;
    }

    const updatedOutlet = await this.outletsRepo.save(outlet);

    // IMPORTANT: Log activity for the Sales Rep who registered the outlet,
    // NOT for the Administrator/RM who performed the review.
    const targetUserId = outlet.registeredBySalesRepId;

    if (targetUserId) {
      const activityMessage =
        dto.decision === 'APPROVED'
          ? `Outlet "${outlet.outletName}" has been approved. It is now active for visits.`
          : `Outlet "${outlet.outletName}" has been declined. Reason: ${updatedOutlet.rejectionReason || 'No reason provided'}`;

      await this.activityService.logForUser({
        userId: targetUserId,
        type: `OUTLET_${dto.decision}`,
        title: `Outlet Registration ${dto.decision === 'APPROVED' ? 'Approved' : 'Declined'}`,
        message: activityMessage,
        metadata: {
          outletId: updatedOutlet.id,
          outletName: updatedOutlet.outletName,
          decision: dto.decision,
          rejectionReason: updatedOutlet.rejectionReason,
        },
      });
    }

    return updatedOutlet;
  }
}
