/**
 * EmailService — shared nodemailer transporter
 * Used by AuthService (forgot password) and WorkspacesService (invite).
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService }      from '@nestjs/config';
import * as nodemailer        from 'nodemailer';

@Injectable()
export class EmailService {
  private readonly log       = new Logger(EmailService.name);
  private readonly transporter: nodemailer.Transporter;
  private readonly from:        string;
  private readonly appUrl:      string;

  constructor(private readonly cfg: ConfigService) {
    this.transporter = nodemailer.createTransport({
      host:   cfg.get('MAIL_HOST',  'smtp.gmail.com'),
      port:   cfg.get<number>('MAIL_PORT', 587),
      secure: false,
      auth: {
        user: cfg.get('MAIL_USER'),
        pass: cfg.get('MAIL_PASS'),
      },
    });

    this.from   = cfg.get('MAIL_FROM', 'Pulse <noreply@pulse.app>');
    this.appUrl = cfg.get('FRONTEND_URL', 'https://pulse-next-phi.vercel.app');
  }

  // ── Send workspace invitation email ──────────────────────────────────────

  async sendWorkspaceInvite(opts: {
    toEmail:       string;
    toName?:       string;
    inviterName:   string;
    workspaceName: string;
    roleLabel:     string;
    inviteToken:   string;
    expiresAt:     Date;
  }): Promise<void> {
    const acceptUrl = `${this.appUrl}/invite/${opts.inviteToken}`;
    const rejectUrl = `${this.appUrl}/invite/${opts.inviteToken}?action=reject`;
    const expiry    = opts.expiresAt.toLocaleDateString('id-ID', {
      day: 'numeric', month: 'long', year: 'numeric',
    });
    const greeting = opts.toName ? `Hai <b>${opts.toName}</b>,` : 'Hai,';

    const html = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
                  max-width:520px;margin:auto;padding:0 0 32px">

        <!-- Header -->
        <div style="background:linear-gradient(135deg,#B25329 0%,#8C3B18 100%);
                    border-radius:16px 16px 0 0;padding:32px 28px;text-align:center">
          <p style="color:rgba(255,255,255,0.85);font-size:13px;margin:0 0 6px">
            Personal Finance
          </p>
          <h1 style="color:#fff;font-size:28px;font-weight:900;margin:0">💰 Pulse</h1>
        </div>

        <!-- Body -->
        <div style="background:#fff;border:1px solid #ECE1D1;border-top:none;
                    border-radius:0 0 16px 16px;padding:28px">

          <p style="color:#3D2314;font-size:15px;margin:0 0 12px">${greeting}</p>

          <p style="color:#3D2314;font-size:15px;margin:0 0 20px;line-height:1.6">
            <b>${opts.inviterName}</b> mengundang kamu untuk bergabung ke workspace
            <b>"${opts.workspaceName}"</b> di Pulse sebagai <b>${opts.roleLabel}</b>.
          </p>

          <!-- Action Buttons -->
          <div style="display:flex;gap:12px;justify-content:center;margin:28px 0;flex-wrap:wrap">
            <a href="${acceptUrl}"
               style="display:inline-block;background:#B25329;color:#fff;
                      font-weight:700;font-size:15px;padding:14px 32px;
                      border-radius:12px;text-decoration:none;letter-spacing:0.2px">
              ✓ Terima Undangan
            </a>
            <a href="${rejectUrl}"
               style="display:inline-block;background:#F4EDE2;color:#8C7B70;
                      font-weight:700;font-size:15px;padding:14px 32px;
                      border-radius:12px;text-decoration:none;letter-spacing:0.2px">
              ✕ Tolak
            </a>
          </div>

          <p style="color:#8C7B70;font-size:13px;line-height:1.6;margin:0 0 8px">
            Atau buka halaman notifikasi setelah login untuk mengelola undangan ini.
          </p>

          <p style="color:#B0A090;font-size:12px;line-height:1.6;margin:0">
            Undangan berlaku hingga <b>${expiry}</b>.
            Jika kamu tidak mengenal pengirim ini, abaikan email ini.
          </p>

          <hr style="border:none;border-top:1px solid #ECE1D1;margin:20px 0 16px">

          <p style="color:#B0A090;font-size:11px;margin:0;text-align:center">
            Email ini dikirim dari Pulse Personal Finance ·
            <a href="${this.appUrl}" style="color:#B25329;text-decoration:none">
              pulse-next-phi.vercel.app
            </a>
          </p>
        </div>
      </div>
    `;

    try {
      await this.transporter.sendMail({
        from:    this.from,
        to:      opts.toEmail,
        subject: `${opts.inviterName} mengundangmu ke "${opts.workspaceName}" – Pulse`,
        html,
      });
      this.log.log(`Invite email sent to ${opts.toEmail}`);
    } catch (err) {
      this.log.warn(`Failed to send invite email to ${opts.toEmail}: ${String(err)}`);
    }
  }
}
