import twilio from 'twilio';
import { defineTool, TACTool } from 'twilio-agent-connect';
import { findCustomer } from '../mockData.js';
import { getState } from '../state.js';

interface VerifyCustomerArgs {
  fullName: string;
  policyNumber: string;
}

interface VerifyCustomerResult {
  verified: boolean;
  reason?: string;
}

function getTwilioClient() {
  return twilio(process.env.TWILIO_API_KEY!, process.env.TWILIO_API_SECRET!, {
    accountSid: process.env.TWILIO_ACCOUNT_SID!,
  });
}

/**
 * Updates the friendlyName of the customer participant in the Conversation,
 * so the correct name appears in the Flex task list instead of "Anonymous".
 */
async function updateParticipantFriendlyName(
  conversationSid: string,
  customerName: string
): Promise<void> {
  try {
    const client = getTwilioClient();

    // Get all participants in the conversation
    const participants = await client.conversations.v1
      .conversations(conversationSid)
      .participants.list();

    // Find the customer participant (not the AI agent)
    const customerParticipant = participants.find(
      (p) => p.identity !== 'ai-assistant' && p.messagingBinding === null
        ? true  // voice participant
        : p.identity !== 'ai-assistant'
    );

    if (!customerParticipant) {
      console.warn(`[verifyCustomer] No customer participant found in ${conversationSid}`);
      return;
    }

    await client.conversations.v1
      .conversations(conversationSid)
      .participants(customerParticipant.sid)
      .update({ identity: customerName });

    console.log(`[verifyCustomer] Updated participant friendlyName to "${customerName}" in ${conversationSid}`);
  } catch (err) {
    // Non-fatal — log and continue
    console.warn(`[verifyCustomer] Failed to update participant friendlyName:`, err);
  }
}

/**
 * Mocked for now — swap the body of this function for a real CRM lookup
 * later. The tool's name, schema, and return shape can stay the same, so
 * nothing else in the flow needs to change.
 */
export function makeVerifyCustomerTool(conversationId: string): TACTool {
  return defineTool(
    'verify_customer',
    "Verifies a policyholder's identity using their full name and policy/customer number. " +
      'Always call this before recording any claim details.',
    {
      type: 'object',
      properties: {
        fullName: { type: 'string', description: "Customer's full name as given" },
        policyNumber: { type: 'string', description: 'Policy or customer number' },
      },
      required: ['fullName', 'policyNumber'],
    },
    async (args: VerifyCustomerArgs): Promise<VerifyCustomerResult> => {
      const customer = findCustomer(args.policyNumber);
      const state = getState(conversationId);

      if (!customer) {
        return { verified: false, reason: 'No policy found with that number.' };
      }

      if (customer.fullName.toLowerCase() !== args.fullName.trim().toLowerCase()) {
        return { verified: false, reason: 'Name does not match our records for this policy.' };
      }

      state.verified = true;
      state.customerName = customer.fullName;
      state.policyNumber = customer.policyNumber;
      state.phoneNumber = customer.phoneNumber;
      state.email = customer.email;

      // Update the participant friendlyName in Flex so it shows the real name
      // instead of "Anonymous". Non-fatal if it fails.
      void updateParticipantFriendlyName(conversationId, customer.fullName);

      return { verified: true };
    }
  );
}