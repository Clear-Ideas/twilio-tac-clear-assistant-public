import twilio from 'twilio';
import { defineTool, TACTool } from 'twilio-agent-connect';
import { getState } from '../state.js';

interface SendClaimChecklistResult {
  success: boolean;
  reason?: string;
  messageSid?: string;
}

function getTwilioClient() {
  return twilio(process.env.TWILIO_API_KEY!, process.env.TWILIO_API_SECRET!, {
    accountSid: process.env.TWILIO_ACCOUNT_SID!,
  });
}

const PHOTO_UPLOAD_LINK = 'https://update-call-summary-4922.twil.io/upload-page';

const CHECKLIST_TEXT =
  'To process your claim, please send: ' +
  '1) Your Garda Incident/PULSE reference number. ' +
  `2) Photos of the damage — upload here: ${PHOTO_UPLOAD_LINK}`;

/**
 * Sends the claim checklist (Garda ref request + photo upload link)
 * natively in whichever channel the customer is currently using:
 *   - webchat: posted inline in the same Conversation (shows in the widget)
 *   - whatsapp: sent as a WhatsApp message from the WhatsApp sender
 *   - sms / voice: sent as SMS via the Alpha Sender (notification-only,
 *     avoids the AI's own outbound message being picked back up as if the
 *     customer had sent it)
 */
export function makeSendClaimChecklistTool(
  conversationId: string,
  channel: string,
  channelId?: string
): TACTool {
  return defineTool(
    'send_claim_checklist',
    'Sends the customer their Garda reference reminder and the photo upload link, natively ' +
      'in whichever channel they are currently using. Call this once as a single proactive ' +
      "message, after the accident details have been recorded — do not wait for the customer " +
      'to ask what documents they need.',
    {
      type: 'object',
      properties: {},
      required: [],
    },
    async (): Promise<SendClaimChecklistResult> => {
      const state = getState(conversationId);

      if (!state.verified) {
        return { success: false, reason: 'Customer not verified yet.' };
      }

      try {
        const client = getTwilioClient();

        // --- Webchat: post inline in the same Conversation ---
        if (channel === 'chat') {
          if (!channelId) {
            return { success: false, reason: 'Missing channelId for webchat delivery.' };
          }
          const message = await client.conversations.v1
            .conversations(channelId)
            .messages.create({ author: 'ai-assistant', body: CHECKLIST_TEXT });
          state.claimChecklistSent = true;
          return { success: true, messageSid: message.sid };
        }

        // --- WhatsApp ---
        if (channel === 'whatsapp') {
          const fromNumber = process.env.TWILIO_WHATSAPP_NUMBER;
          if (!fromNumber || !state.phoneNumber) {
            return { success: false, reason: 'Missing WhatsApp number configuration.' };
          }
          const message = await client.messages.create({
            to: `whatsapp:${state.phoneNumber}`,
            from: fromNumber.startsWith('whatsapp:') ? fromNumber : `whatsapp:${fromNumber}`,
            body: CHECKLIST_TEXT,
          });
          state.claimChecklistSent = true;
          return { success: true, messageSid: message.sid };
        }

        // --- SMS / Voice fallback: Alpha Sender ---
        if (!state.phoneNumber) {
          return { success: false, reason: 'No phone number on file.' };
        }
        const fromNumber = process.env.ALPHA_SENDER_ID ?? process.env.TWILIO_PHONE_NUMBER;
        if (!fromNumber) {
          return { success: false, reason: 'Neither ALPHA_SENDER_ID nor TWILIO_PHONE_NUMBER configured.' };
        }
        const message = await client.messages.create({
          to: state.phoneNumber,
          from: fromNumber,
          body: CHECKLIST_TEXT,
        });
        state.claimChecklistSent = true;
        return { success: true, messageSid: message.sid };
      } catch (err) {
        console.error('[send_claim_checklist] error:', err);
        return { success: false, reason: err instanceof Error ? err.message : String(err) };
      }
    }
  );
}