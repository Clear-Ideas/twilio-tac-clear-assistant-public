import { defineTool, TACTool } from 'twilio-agent-connect';
import { getState } from '../state.js';
import sgMail from '@sendgrid/mail';
import { saveClaimRecord } from '../claimLogger.js';

interface SendClaimSummaryEmailResult {
  success: boolean;
  reason?: string;
}

function buildEmailContent(state: ReturnType<typeof getState>): { subject: string; html: string; text: string } {
  const a = state.accident;
  const customerName = state.customerName ?? 'there';
  const subject = `Clear Insurance — Your claim summary (Policy ${state.policyNumber ?? 'N/A'})`;

  const detailRows = [
    ['Policy number', state.policyNumber ?? '—'],
    ['What happened', a?.whatHappened ?? '—'],
    ['Date/time', a?.dateTime ?? '—'],
    ['Location', a?.location ?? '—'],
    ['Garda reference', a?.gardaReference ?? 'Not yet provided'],
  ];

  const detailRowsHtml = detailRows
    .map(
      ([label, value]) => `
        <tr>
          <td style="padding:6px 0;font-size:13px;color:#888888;width:160px;vertical-align:top;">${label}</td>
          <td style="padding:6px 0;font-size:14px;color:#333333;">${value}</td>
        </tr>`
    )
    .join('');

  const text = `
Hi ${customerName},

Thanks for reporting your claim with Clear Insurance today. Here's a summary:

  Policy number:     ${state.policyNumber ?? '—'}
  What happened:     ${a?.whatHappened ?? '—'}
  Date/time:         ${a?.dateTime ?? '—'}
  Location:          ${a?.location ?? '—'}
  Garda reference:   ${a?.gardaReference ?? 'Not yet provided'}


If you have any questions, just reply to this email or call us back and
one of our team will help.

The Clear Insurance Team
`.trim();

  const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f4f4f4;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f4;padding:30px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
          <tr>
            <td style="background-color:#000000;padding:32px 40px;text-align:center;">
              <div style="font-size:28px;font-weight:bold;color:#ffffff;letter-spacing:1px;">Clear Insurance</div>
            </td>
          </tr>
          <tr>
            <td style="padding:40px;">
              <p style="margin:0 0 8px 0;font-size:15px;color:#555555;">Hi ${customerName},</p>
              <p style="margin:0 0 24px 0;font-size:15px;color:#555555;">
                Thanks for reporting your claim with Clear Insurance today. Here's a summary of what
                we discussed for your records.
              </p>
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background-color:#f9f9f9;border-left:4px solid #52a016;border-radius:0 6px 6px 0;padding:20px 24px;">
                    <div style="font-size:11px;font-weight:bold;color:#000000;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px;">Claim Details</div>
                    <table width="100%" cellpadding="0" cellspacing="0">
                      ${detailRowsHtml}
                    </table>
                  </td>
                </tr>
              </table>
              <p style="margin:28px 0 8px 0;font-size:14px;color:#555555;font-weight:bold;">Next steps</p>
              <ol style="margin:0 0 24px 0;padding-left:20px;font-size:14px;color:#555555;line-height:1.7;">
                <li>If you haven't already, please report the incident to the Gardai and get a reference number.</li>
                <li>Upload photos of the damage using the secure link we texted you.</li>
              </ol>
              <p style="margin:0 0 24px 0;font-size:14px;color:#555555;">
                If you have any questions, just reply to this email or call us back and one of our
                team will help.
              </p>
              <p style="margin:0;font-size:14px;color:#555555;">
                Kind regards,<br/>
                <strong>The Clear Insurance Team</strong>
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 40px;"><hr style="border:none;border-top:1px solid #eeeeee;margin:0;"/></td>
          </tr>
          <tr>
            <td style="padding:24px 40px;text-align:center;">
              <p style="margin:0 0 8px 0;font-size:12px;color:#aaaaaa;">
                No. 19, The Exchange, Calmount Park, Dublin, D12 F5X0, Ireland
              </p>
              <p style="margin:0;font-size:12px;color:#aaaaaa;">
                <a href="https://clearideas.ai" style="color:#000000;text-decoration:underline;">clearideas.ai</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, html, text };
}

/**
 * Emails the policy documents via SendGrid, using the same branded HTML
 * template as the human-agent wrap-up summary email (send-wrapup-summary-email
 * in the Twilio Functions project), for visual consistency between the AI
 * and human-agent paths. Falls back to logging if SendGrid isn't configured.
 *
 * Also saves a local record of the claim (see claimLogger.ts) — quick
 * persistence for testing/demo purposes.
 */
export function makeSendClaimSummaryEmailTool(conversationId: string): TACTool {
  return defineTool(
    'send_claim_summary_email',
    'Emails the customer a summary of their claim. Always offer this before ending the ' +
      'conversation, even if the customer does not ask for it.',
    {
      type: 'object',
      properties: {},
      required: [],
    },
    async (): Promise<SendClaimSummaryEmailResult> => {
      const state = getState(conversationId);

      if (!state.email) {
        return { success: false, reason: 'No email on file for this customer.' };
      }

      const { subject, html, text } = buildEmailContent(state);

      if (!process.env.SENDGRID_API_KEY || !process.env.SENDGRID_FROM_EMAIL) {
        console.warn('[send_claim_summary_email] SendGrid not configured, logging instead:');
        console.log(`To: ${state.email}\nSubject: ${subject}\nBody:\n${text}\n`);
        saveClaimRecord(conversationId, state);
        return { success: true };
      }

      try {
        sgMail.setApiKey(process.env.SENDGRID_API_KEY);
        await sgMail.send({
          to: state.email,
          from: {
            email: process.env.SENDGRID_FROM_EMAIL,
            name: process.env.SENDGRID_FROM_NAME || 'Clear Insurance Customer Care',
          },
          replyTo: 'demo@flex.clearideas.ai',
          subject,
          text,
          html,
        });
        saveClaimRecord(conversationId, state);
        return { success: true };
      } catch (err) {
        console.error('[send_claim_summary_email] SendGrid error:', err);
        return { success: false, reason: err instanceof Error ? err.message : String(err) };
      }
    }
  );
}