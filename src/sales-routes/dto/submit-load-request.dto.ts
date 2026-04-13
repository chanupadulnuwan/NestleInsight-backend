import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

export class LoadRequestStockLineDto {
  @IsUUID()
  productId: string;

  @IsString()
  productName: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  quantityCases: number;
}

export class SubmitLoadRequestDto {
  @IsArray()
  @ArrayMinSize(0)
  @ValidateNested({ each: true })
  @Type(() => LoadRequestStockLineDto)
  deliveryStock: LoadRequestStockLineDto[];

  @IsArray()
  @ArrayMinSize(0)
  @ValidateNested({ each: true })
  @Type(() => LoadRequestStockLineDto)
  freeSaleStock: LoadRequestStockLineDto[];
}
