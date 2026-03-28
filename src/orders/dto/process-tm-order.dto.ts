import { IsIn, IsOptional, IsString } from 'class-validator';

export const PROCESS_TM_ORDER_DECISIONS = [
  'READY_TO_DELIVER',
  'PROCEED_AVAILABLE',
  'CANCEL_ORDER',
] as const;

export type ProcessTmOrderDecision =
  (typeof PROCESS_TM_ORDER_DECISIONS)[number];

export class ProcessTmOrderDto {
  @IsString()
  @IsIn(PROCESS_TM_ORDER_DECISIONS)
  decision: ProcessTmOrderDecision;

  @IsOptional()
  @IsString()
  explanation?: string;
}
