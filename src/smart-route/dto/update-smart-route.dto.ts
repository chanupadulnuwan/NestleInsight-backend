import { PartialType } from '@nestjs/mapped-types';
import { CreateSmartRouteDto } from './create-smart-route.dto';

export class UpdateSmartRouteDto extends PartialType(CreateSmartRouteDto) {}
