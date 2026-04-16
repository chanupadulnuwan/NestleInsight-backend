import { PartialType } from '@nestjs/mapped-types';
import { CreateFieldMonitoringDto } from './create-field-monitoring.dto';

export class UpdateFieldMonitoringDto extends PartialType(CreateFieldMonitoringDto) {}
