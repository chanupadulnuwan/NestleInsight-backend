import AdmZip from 'adm-zip';
import { parse } from 'csv-parse/sync';

export type ImportedDemandType =
  | 'REPLENISHMENT_DEMAND'
  | 'ESTIMATED_RETAIL_OFFTAKE';

export type ImportedPlannerForecastRow = {
  forecast_date: string;
  demand_type: ImportedDemandType;
  product_id: string;
  product_name: string;
  territory_id: string | null;
  warehouse_id: string | null;
  avg_daily_cases_7d: number;
  avg_daily_cases_28d: number;
  forecast_cases: number;
  promotion_flag: boolean;
  confidence_score: number;
  confidence_level: string;
  signal_source: string;
};

export type ImportedPlannerProduct = {
  product_id: string;
  sku: string;
  product_name: string;
  brand: string;
  units_per_case: number;
};

export type ImportedInventorySnapshot = {
  product_id: string;
  warehouse_id: string | null;
  quantity_cases: number;
  snapshot_date: string;
  snapshot_source: string;
};

export type ImportedFieldObservation = {
  observation_id: string;
  source_type: string;
  source_id: string;
  signal_date: string;
  canonical_shop_id: string | null;
  sales_rep_id: string | null;
  territory_id: string | null;
  warehouse_id: string | null;
  route_id: string | null;
  product_id: string | null;
  product_name: string | null;
  issue_tag: string;
  issue_type: string;
  severity_hint: string;
  observation_text: string;
  promotion_related: boolean;
  competitor_related: boolean;
  osa_related: boolean;
  planogram_violation: boolean;
  posm_violation: boolean;
};

export type ImportedForecastBundle = {
  packageName: string | null;
  generatedAt: string | null;
  products: ImportedPlannerProduct[];
  forecastRows: ImportedPlannerForecastRow[];
  inventorySnapshots: ImportedInventorySnapshot[];
  fieldObservations: ImportedFieldObservation[];
};

type ParsedManifest = {
  export_name?: string;
  generated_at?: string;
};

function parseCsv(text: string) {
  return parse(text, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as Array<Record<string, string>>;
}

function readNumber(value: string | undefined) {
  const numericValue = Number(value ?? 0);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

function readBoolean(value: string | undefined) {
  return ['true', '1', 'yes'].includes((value ?? '').trim().toLowerCase());
}

function readNullableText(value: string | undefined) {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
}

function readEntryText(zip: AdmZip, entryName: string) {
  const entry = zip.getEntry(entryName);
  return entry ? entry.getData().toString('utf8') : null;
}

function parseForecastRows(
  rows: Array<Record<string, string>>,
  demandType: ImportedDemandType,
) {
  return rows
    .map<ImportedPlannerForecastRow>((row) => ({
      forecast_date: row.forecast_date?.trim() ?? '',
      demand_type: demandType,
      product_id: row.product_id?.trim() ?? '',
      product_name: row.product_name?.trim() ?? 'Unknown Product',
      territory_id: readNullableText(row.territory_id),
      warehouse_id: readNullableText(row.warehouse_id),
      avg_daily_cases_7d: readNumber(row.avg_daily_cases_7d),
      avg_daily_cases_28d: readNumber(row.avg_daily_cases_28d),
      forecast_cases: readNumber(row.forecast_cases),
      promotion_flag: readBoolean(row.promotion_flag),
      confidence_score: readNumber(row.confidence_score),
      confidence_level: row.confidence_level?.trim() ?? 'UNKNOWN',
      signal_source: row.signal_source?.trim() ?? '',
    }))
    .filter((row) => row.forecast_date && row.product_id);
}

export function parseForecastExportBundle(buffer: Buffer): ImportedForecastBundle {
  const zip = new AdmZip(buffer);

  const manifestText = readEntryText(zip, 'manifest.json');
  const manifest = manifestText
    ? (JSON.parse(manifestText) as ParsedManifest)
    : null;

  const productRows = parseCsv(readEntryText(zip, 'products.csv') ?? '');
  const inventoryRows = parseCsv(readEntryText(zip, 'inventory_snapshots.csv') ?? '');
  const replenishmentRows = parseCsv(
    readEntryText(zip, 'forecast_replenishment_demand.csv') ?? '',
  );
  const retailRows = parseCsv(
    readEntryText(zip, 'forecast_estimated_retail_offtake.csv') ?? '',
  );
  const fieldObservationRows = parseCsv(
    readEntryText(zip, 'field_observations.csv') ?? '',
  );

  const products = productRows
    .map<ImportedPlannerProduct>((row) => ({
      product_id: row.product_id?.trim() ?? '',
      sku: row.sku?.trim() ?? '',
      product_name: row.product_name?.trim() ?? 'Unknown Product',
      brand: row.brand?.trim() ?? '',
      units_per_case: Math.max(1, readNumber(row.units_per_case)),
    }))
    .filter((row) => row.product_id);

  const inventorySnapshots = inventoryRows
    .map<ImportedInventorySnapshot>((row) => ({
      product_id: row.product_id?.trim() ?? '',
      warehouse_id: readNullableText(row.warehouse_id),
      quantity_cases: readNumber(row.quantity_cases),
      snapshot_date: row.snapshot_date?.trim() ?? '',
      snapshot_source: row.snapshot_source?.trim() ?? '',
    }))
    .filter(
      (row) =>
        row.product_id &&
        row.snapshot_source.toUpperCase() === 'WAREHOUSE_SYSTEM',
    )
    .reduce<ImportedInventorySnapshot[]>((accumulator, row) => {
      const existingIndex = accumulator.findIndex(
        (item) =>
          item.product_id === row.product_id &&
          item.warehouse_id === row.warehouse_id,
      );
      if (existingIndex === -1) {
        accumulator.push(row);
        return accumulator;
      }

      if (row.snapshot_date > accumulator[existingIndex].snapshot_date) {
        accumulator[existingIndex] = row;
      }
      return accumulator;
    }, []);

  const forecastRows = [
    ...parseForecastRows(replenishmentRows, 'REPLENISHMENT_DEMAND'),
    ...parseForecastRows(retailRows, 'ESTIMATED_RETAIL_OFFTAKE'),
  ].sort((left, right) =>
    `${left.forecast_date}|${left.product_name}|${left.demand_type}`.localeCompare(
      `${right.forecast_date}|${right.product_name}|${right.demand_type}`,
    ),
  );

  if (products.length === 0 || forecastRows.length === 0) {
    throw new Error(
      'The uploaded export ZIP is missing the forecast product catalog or forecast rows.',
    );
  }

  return {
    packageName: manifest?.export_name ?? null,
    generatedAt: manifest?.generated_at ?? null,
    products,
    forecastRows,
    inventorySnapshots,
    fieldObservations: fieldObservationRows
      .map<ImportedFieldObservation>((row) => ({
        observation_id: row.observation_id?.trim() ?? '',
        source_type: row.source_type?.trim() ?? '',
        source_id: row.source_id?.trim() ?? '',
        signal_date: row.signal_date?.trim() ?? '',
        canonical_shop_id: readNullableText(row.canonical_shop_id),
        sales_rep_id: readNullableText(row.sales_rep_id),
        territory_id: readNullableText(row.territory_id),
        warehouse_id: readNullableText(row.warehouse_id),
        route_id: readNullableText(row.route_id),
        product_id: readNullableText(row.product_id),
        product_name: readNullableText(row.product_name),
        issue_tag: row.issue_tag?.trim() ?? '',
        issue_type: row.issue_type?.trim() ?? '',
        severity_hint: row.severity_hint?.trim() ?? '',
        observation_text: row.observation_text?.trim() ?? '',
        promotion_related: readBoolean(row.promotion_related),
        competitor_related: readBoolean(row.competitor_related),
        osa_related: readBoolean(row.osa_related),
        planogram_violation: readBoolean(row.planogram_violation),
        posm_violation: readBoolean(row.posm_violation),
      }))
      .filter((row) => row.signal_date && row.observation_text),
  };
}
