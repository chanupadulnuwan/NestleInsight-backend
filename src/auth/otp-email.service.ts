import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import SMTPTransport from 'nodemailer/lib/smtp-transport';

export type OtpDeliveryMethod = 'email' | 'debug';

export interface OtpEmailDeliveryResult {
  delivered: boolean;
  reason?: string;
}

@Injectable()
export class OtpEmailService {
  private readonly logger = new Logger(OtpEmailService.name);

  constructor(private readonly configService: ConfigService) {}

  async sendOtpEmail(params: {
    email: string;
    firstName: string;
    otpCode: string;
    expiresInMinutes: number;
  }): Promise<OtpEmailDeliveryResult> {
    const configurationIssue = this.getConfigurationIssue();
    if (configurationIssue) {
      return {
        delivered: false,
        reason: configurationIssue,
      };
    }

    const transporter = nodemailer.createTransport(this.buildTransportOptions());

    await transporter.sendMail({
      from: this.buildFromAddress(),
      to: params.email,
      subject: 'Nestle Insight verification code',
      text: this.buildTextBody(params),
      html: this.buildHtmlBody(params),
    });

    this.logger.log(`OTP email sent to ${params.email}`);

    return {
      delivered: true,
    };
  }

  private buildTransportOptions(): SMTPTransport.Options {
    const host = this.configService.get<string>('SMTP_HOST')?.trim() ?? '';
    const port = Number.parseInt(
      this.configService.get<string>('SMTP_PORT')?.trim() ?? '587',
      10,
    );
    const secure = this.parseBoolean(
      this.configService.get<string>('SMTP_SECURE'),
      port === 465,
    );
    const user = this.configService.get<string>('SMTP_USER')?.trim() ?? '';
    const pass = this.configService.get<string>('SMTP_PASS')?.trim() ?? '';

    return {
      host,
      port,
      secure,
      ...(user && pass
        ? {
            auth: {
              user,
              pass,
            },
          }
        : {}),
    };
  }

  private buildFromAddress(): string {
    const fromEmail =
      this.configService.get<string>('SMTP_FROM_EMAIL')?.trim() ??
      'no-reply@example.com';
    const fromName =
      this.configService.get<string>('SMTP_FROM_NAME')?.trim() ||
      'Nestle Insight';

    return `"${fromName}" <${fromEmail}>`;
  }

  private getConfigurationIssue(): string | null {
    const host = this.configService.get<string>('SMTP_HOST')?.trim();
    const port = this.configService.get<string>('SMTP_PORT')?.trim();
    const fromEmail = this.configService.get<string>('SMTP_FROM_EMAIL')?.trim();
    const user = this.configService.get<string>('SMTP_USER')?.trim();
    const pass = this.configService.get<string>('SMTP_PASS')?.trim();

    if (!host) {
      return 'SMTP_HOST is not configured';
    }

    if (!port) {
      return 'SMTP_PORT is not configured';
    }

    if (!fromEmail) {
      return 'SMTP_FROM_EMAIL is not configured';
    }

    if ((user && !pass) || (!user && pass)) {
      return 'SMTP_USER and SMTP_PASS must be set together';
    }

    return null;
  }

  private parseBoolean(value: string | undefined, fallback: boolean): boolean {
    if (!value) {
      return fallback;
    }

    return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
  }

  private buildTextBody(params: {
    firstName: string;
    otpCode: string;
    expiresInMinutes: number;
  }): string {
    return [
      `Hi ${params.firstName},`,
      '',
      'Your Nestle Insight verification code is:',
      params.otpCode,
      '',
      `This code expires in ${params.expiresInMinutes} minutes.`,
      'If you did not request this account, you can ignore this email.',
    ].join('\n');
  }

  private buildHtmlBody(params: {
    firstName: string;
    otpCode: string;
    expiresInMinutes: number;
  }): string {
    return `
      <div style="font-family: Arial, sans-serif; color: #3f342d; line-height: 1.6;">
        <p>Hi ${this.escapeHtml(params.firstName)},</p>
        <p>Your Nestle Insight verification code is:</p>
        <p style="font-size: 28px; font-weight: 700; letter-spacing: 6px; color: #8b6b52;">
          ${this.escapeHtml(params.otpCode)}
        </p>
        <p>This code expires in ${params.expiresInMinutes} minutes.</p>
        <p>If you did not request this account, you can ignore this email.</p>
      </div>
    `.trim();
  }

  private escapeHtml(value: string): string {
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }
}
