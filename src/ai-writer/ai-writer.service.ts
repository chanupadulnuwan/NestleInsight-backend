import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type InsightWriterRequest = {
  reportType: string;
  audience: string;
  model?: string;
  window: {
    fromDate: string;
    toDate: string;
  };
  filters: Record<string, string>;
  metrics: Record<string, number | string | null>;
  charts: Array<{
    title: string;
    purpose: string;
    dataSummary: string;
  }>;
  anomalies: string[];
  recommendedActions: string[];
};

export type InsightWriterResponse = {
  model: string;
  generatedAt: string;
  reportTitle: string;
  headline: string;
  executiveSummary: string;
  storyOfTheNumbers: string;
  anomalyExplanation: string;
  managementRecommendation: string;
  sectionTitles: string[];
  chartCaptions: string[];
  callouts: string[];
};

@Injectable()
export class AiWriterService {
  constructor(private readonly configService: ConfigService) {}

  isConfigured() {
    return Boolean(
      this.configService.get<string>('INSIGHT_WRITER_URL') &&
        this.configService.get<string>('INSIGHT_WRITER_SHARED_SECRET'),
    );
  }

  async writeInsightCenterNarrative(
    payload: InsightWriterRequest,
  ): Promise<InsightWriterResponse | null> {
    const url = this.configService.get<string>('INSIGHT_WRITER_URL')?.trim();
    const secret = this.configService
      .get<string>('INSIGHT_WRITER_SHARED_SECRET')
      ?.trim();
    const model =
      this.configService.get<string>('INSIGHT_WRITER_MODEL')?.trim() ||
      'gemini-2.5-pro';

    if (!url || !secret) {
      return null;
    }

    const response = await fetch(`${url.replace(/\/+$/, '')}/v1/report-writer`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-insight-service-token': secret,
      },
      body: JSON.stringify({
        ...payload,
        model,
      }),
    });

    if (!response.ok) {
      throw new Error(
        `Insight writer request failed with status ${response.status}.`,
      );
    }

    return (await response.json()) as InsightWriterResponse;
  }
}
