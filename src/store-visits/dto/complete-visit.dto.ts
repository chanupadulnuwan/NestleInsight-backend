import {
  IsOptional,
  IsBoolean,
  IsString,
  IsArray,
  IsNumber,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class VisitStockItemDto {
  @IsString()
  productId: string;

  @IsString()
  productName: string;

  @IsNumber()
  shelfCount: number;

  @IsNumber()
  backroomCount: number;

  @IsNumber()
  estimatedSales: number;

  @IsOptional()
  @IsBoolean()
  inStock?: boolean;

  @IsOptional()
  @IsString()
  oosReason?: string;
}

export class VisitExpiryItemDto {
  @IsString()
  productId: string;

  @IsString()
  productName: string;

  @IsBoolean()
  hasExpiredItems: boolean;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class VisitOsaIssueDto {
  @IsString()
  tag: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class VisitPromotionCheckDto {
  @IsString()
  promotionId: string;

  @IsBoolean()
  informed: boolean;

  @IsOptional()
  @IsString()
  customerFeedback?: string;
}

export class VisitAnswerDto {
  @IsString()
  question: string;

  @IsString()
  answer: string;
}

export class CompleteVisitDto {
  // Structured fields
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VisitStockItemDto)
  stockItems?: VisitStockItemDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VisitExpiryItemDto)
  expiryItems?: VisitExpiryItemDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VisitOsaIssueDto)
  osaIssues?: VisitOsaIssueDto[];

  @IsOptional()
  @IsString()
  competitorNotes?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VisitPromotionCheckDto)
  promotionChecks?: VisitPromotionCheckDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VisitAnswerDto)
  planogramAnswers?: VisitAnswerDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VisitAnswerDto)
  posmAnswers?: VisitAnswerDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VisitAnswerDto)
  outletFeedbackAnswers?: VisitAnswerDto[];

  @IsOptional()
  @IsString()
  outletFeedback?: string;

  @IsOptional()
  @IsBoolean()
  planogramOk?: boolean;

  @IsOptional()
  @IsBoolean()
  posmOk?: boolean;

  // Legacy JSON fields — kept for backward compatibility
  @IsOptional()
  shelfStockJson?: any;

  @IsOptional()
  backroomStockJson?: any;

  @IsOptional()
  osaIssuesJson?: any;

  @IsOptional()
  promotionsJson?: any;
}
