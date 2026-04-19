import { ArrayUnique, IsArray, IsUUID } from 'class-validator';

export class RequestDeliveryApprovalDto {
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  orderIds: string[];
}
