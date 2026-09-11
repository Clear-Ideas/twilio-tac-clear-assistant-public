/**
 * Clear Insurance Claims Assistant (TAC)
 *
 * Motor accident claim flow: identity verification, welfare check
 * (auto-handoff on injury), accident details, claim checklist SMS (real),
 * claim summary email (real via SendGrid), automatic call hangup, human
 * handoff, and knowledge base search. Voice + SMS. Memory disabled.
 */
import { config } from 'dotenv';
import twilio from 'twilio';
import { WhatsAppChannel, ChatChannel } from 'twilio-agent-connect';
import { Agent, AgentInputItem, run, setTracingDisabled } 
from '@openai/agents';
import {
  TAC,
  TACConfig,
  VoiceChannel,
  SMSChannel,
  ConversationSession,
  ConversationId,
  ChannelType,
  ProfileId,
  TACServer,
  createStudioHandoffTool,
} from 'twilio-agent-connect';
import { buildSystemInstructions } from './systemPrompt.js';
import { makeVerifyCustomerTool } from './tools/verifyCustomer.js';
import { makeRecordAccidentDetailsTool } from './tools/recordAccidentDetails.js';
import { makeSendClaimChecklistTool } from './tools/sendClaimChecklist.js';
import { makeSendClaimSummaryEmailTool } from './tools/sendClaimSummaryEmail.js';
import { makeSearchKnowledgeTool } from './tools/searchKnowledge.js';
import { makeEndCallTool, endCallForCaller } from './tools/endCall.js';
import { clearState, getState } from './state.js';

config({ path: '../.env' });
setTracingDisabled(true);

const tac = await TAC.create({ config: TACConfig.fromEnv() });

const voiceChannel = new VoiceChannel(tac, {
  defaultTwimlOptions: {
    welcomeGreeting: "Hi, thanks for calling Clear Insurance — this is Aileen. How can I help you today?",
    ttsProvider: 'ElevenLabs',
    voice: 'nBGpwX2gxJKzCm2Z6Oxj',
    transcriptionProvider: 'Deepgram',
    interruptSensitivity: 'low',
    ignoreBackchannel: true,
  },
});

const smsChannel = new SMSChannel(tac);
const whatsappChannel = new WhatsAppChannel(tac);
const chatChannel = new ChatChannel(tac);
tac.registerChannel(voiceChannel);
tac.registerChannel(smsChannel);
tac.registerChannel(whatsappChannel);
tac.registerChannel(chatChannel);

const conversationHistory: Record<string, AgentInputItem[]> = {};

async function buildHandoffAttributes(
  convId: string,
  session?: ConversationSession,
  channel?: ChannelType | 'email',
  knownAuthorName?: string
) {
  const state = getState(convId);
  const a = state.accident;
  const channelSid =
    session && typeof session.metadata?.channelId === 'string'
      ? session.metadata.channelId
      : convId;
  console.log(`[buildHandoffAttributes] channel=${channel}, channelSid=${channelSid}, convId=${convId}, session.metadata=`, session?.metadata);

  let authorName = state.customerName ?? knownAuthorName ?? 'Unknown';

  if (!state.customerName && !knownAuthorName) {
    const address = session?.authorInfo?.address ?? '';

    if (channel === 'whatsapp' && address.startsWith('whatsapp:')) {
      authorName = address;
    } else if (channel === 'sms' && address.startsWith('+')) {
      authorName = address;
    } else if (channel === 'voice' && address.startsWith('+')) {
      authorName = address;
    } else if (channelSid.startsWith('CH')) {
      try {
        const client = twilio(process.env.TWILIO_API_KEY!, process.env.TWILIO_API_SECRET!, {
          accountSid: process.env.TWILIO_ACCOUNT_SID!,
        });
        const participants = await client.conversations.v1
          .conversations(channelSid)
          .participants.list();
        const customer = participants.find(p => p.identity !== 'ai-assistant');
        if (customer?.identity && !customer.identity.startsWith('FX')) {
          authorName = customer.identity;
        } else {
          authorName = 'Webchat Customer';
        }
      } catch (err) {
        console.warn(`[buildHandoffAttributes] Failed to fetch participant:`, err);
        authorName = 'Webchat Customer';
      }
    }
  }

  console.log(`[buildHandoffAttributes] channel=${channel}, finalAuthorName=${authorName}`);

  const summaryLines = [
    `Customer: ${authorName}`,
    `Policy number: ${state.policyNumber ?? 'Not yet verified'}`,
    `Injury reported: ${state.injuryReported ? 'YES' : 'No'}`,
    a?.whatHappened ? `What happened: ${a.whatHappened}` : null,
    a?.dateTime ? `Date/time: ${a.dateTime}` : null,
    a?.location ? `Location: ${a.location}` : null,
    a?.gardaReference ? `Garda reference: ${a.gardaReference}` : null,
    state.topicsDiscussed?.length
      ? `Topics discussed: ${state.topicsDiscussed.join('; ')}`
      : null,
  ].filter((line): line is string => Boolean(line));

  const conversationSentiment = state.injuryReported ? 'negative' : 'neutral';
  return {
    department: 'claims',
    priority: state.injuryReported ? 'urgent' : 'normal',
    conversationSummary: summaryLines.join(' | '),
    conversationSentiment,
    conversationSid: channelSid,
    customerName: authorName,
    channel: channel ?? 'chat',
  };
}

function wrapInEmailTemplate(content: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 24px; background-color: #f4f4f2; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;">
  <div style="max-width: 600px; margin: 0 auto;">
    <div style="background-color: #000000; padding: 28px 32px; border-radius: 12px 12px 0 0;">
      <h1 style="color: #ffffff; margin: 0; font-size: 20px; font-weight: 700; letter-spacing: -0.3px;">Clear Insurance</h1>
      <p style="color: #52a016; margin: 6px 0 0 0; font-size: 13px; font-weight: 600;">Claims Assistant — Aileen</p>
    </div>
    <div style="background-color: #ffffff; padding: 32px; border: 1px solid #ececec; border-top: none;">
      ${content}
    </div>
    <div style="background-color: #ffffff; padding: 0 32px 28px 32px; border: 1px solid #ececec; border-top: none; border-radius: 0 0 12px 12px;">
      <hr style="border: none; border-top: 1px solid #ececec; margin: 0 0 18px 0;">
      <table role="presentation" style="width: 100%;">
        <tr>
          <td style="vertical-align: middle;">
            <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background-color: #52a016; margin-right: 8px;"></span>
            <span style="font-size: 12px; color: #999999;">Sent automatically by Aileen, Clear Insurance AI Claims Assistant</span>
          </td>
        </tr>
      </table>
      <p style="font-size: 11px; color: #bbbbbb; margin: 12px 0 0 0; line-height: 1.5;">
        Need a human? Reply with "transfer" or call us directly.
      </p>
    </div>
  </div>
</body>
</html>`;
}

async function uploadHtmlToMcs(html: string): Promise<string> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID!;
  const authToken = process.env.TWILIO_AUTH_TOKEN!;
  const serviceSid = process.env.TWILIO_CONVERSATIONS_SERVICE_SID!;
  const region = process.env.MCS_REGION ?? 'us1';

  const url = `https://mcs.${region}.twilio.com/v1/Services/${serviceSid}/Media?Category=body`;
  const token = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${token}`,
      'Content-Type': 'text/html',
    },
    body: html,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`MCS upload failed (${response.status}): ${text}`);
  }

  const media = await response.json() as { sid: string };
  console.log(`[email] Uploaded HTML to MCS: ${media.sid}`);
  return media.sid;
}

async function handleMessageReady(params: {
  conversationId: ConversationId;
  profileId: ProfileId | undefined;
  message: string;
  author: string;
  session: ConversationSession;
  channel: ChannelType;
}): Promise<string | undefined> {
  const { conversationId, message, session, channel } = params;
  const convId = conversationId as string;
  console.log(`[${convId}] Customer said: ${message}`);

  // If a human agent has already taken over this conversation (handoff
  // already triggered), stay silent — otherwise the AI keeps replying
  // alongside the live agent, which is confusing for the customer. Voice
  // calls aren't affected by this (the whole call moves to the agent), but
  // chat/SMS/WhatsApp/email share the same Conversation with the human agent
  // after handoff, so every new message still reaches this webhook.
  const preHandoffState = getState(convId);
  if (preHandoffState.handoffTriggered) {
    console.log(`[${convId}] Handoff already triggered — staying silent so the live agent can respond directly.`);
    return undefined;
  }

  const handoffTool = createStudioHandoffTool(tac, session, {
    attributes: await buildHandoffAttributes(convId, session, channel),
  });

  const tools = [
    await makeVerifyCustomerTool(convId).toOpenAIAgentsSDKTool(),
    await makeRecordAccidentDetailsTool(convId).toOpenAIAgentsSDKTool(),
    await makeSendClaimChecklistTool(
      convId,
      channel,
      session.metadata?.channelId as string | undefined
    ).toOpenAIAgentsSDKTool(),
    await makeSearchKnowledgeTool(convId).toOpenAIAgentsSDKTool(),
    await makeSendClaimSummaryEmailTool(convId).toOpenAIAgentsSDKTool(),
    await makeEndCallTool(session.authorInfo?.address).toOpenAIAgentsSDKTool(),
  ];

  if (process.env.TWILIO_STUDIO_HANDOFF_FLOW_SID) {
    tools.push(await handoffTool.toOpenAIAgentsSDKTool());
  }

  const agent = new Agent({
    name: 'Clear Insurance Claims Assistant',
    instructions: buildSystemInstructions(),
    model: 'gpt-5.4-nano',
    modelSettings: { temperature: 0 },
    tools,
  });

  const history = conversationHistory[convId] ?? [];
  const isFirstResponse = history.length === 0;
  const agentInput: AgentInputItem[] = [...history, { role: 'user', content: message }];

  let result;
  try {
    result = await run(agent, agentInput);
  } catch (err) {
    console.error(`[${convId}] Agent run() threw an error:`, err);
    return 'Sorry, I ran into an error. Could you say that again?';
  }

  conversationHistory[convId] = result.history;

  const endCallWasCalled = result.output?.some(
    (item: any) => item.type === 'function_call' && item.name === 'end_call'
  );

  // The model's own way of handing off is calling the "handoff" tool
  // directly — this must be detected the same way endCallWasCalled is,
  // otherwise state.handoffTriggered only gets set by the safety-net
  // checks below (injuryReported / regex on finalOutput), which miss
  // any handoff the model triggers on its own wording.
  const handoffToolWasCalled = result.output?.some(
    (item: any) => item.type === 'function_call' && item.name === 'handoff'
  );

  let finalOutput = result.finalOutput;

  if (!finalOutput) {
    if (endCallWasCalled) {
      finalOutput = '';
      console.log(`[${convId}] Empty response after end_call — expected, skipping fallback.`);
    } else {
      finalOutput = "I'm connecting you with one of our team members now.";
      console.warn(`[${convId}] Empty response from model, using fallback message.`);
      console.log(`[${convId}] Full result output:`, JSON.stringify(result.output, null, 2));
    }
  }

  console.log(`[${convId}] Assistant said: "${finalOutput}"`);

  const state = getState(convId);

  if (handoffToolWasCalled && !state.handoffTriggered) {
    state.handoffTriggered = true;
    console.log(`[${convId}] Handoff tool was called directly by the model — marking handoffTriggered.`);
  }

  if (
    state.injuryReported &&
    !state.handoffTriggered &&
    process.env.TWILIO_STUDIO_HANDOFF_FLOW_SID
  ) {
    state.handoffTriggered = true;
    void handoffTool.implementation({ reason: 'Injury reported during welfare check' });
  }

  if (
    !state.handoffTriggered &&
    process.env.TWILIO_STUDIO_HANDOFF_FLOW_SID &&
    /transfer|connecting you|speak (with|to) (a )?(human|team member|live agent)/i.test(finalOutput)
  ) {
    state.handoffTriggered = true;
    void handoffTool.implementation({ reason: 'Customer requested a human agent' });
  }

  // Safety net: if the response sounds like a closing/farewell but doesn't
  // match the exact scripted line, override it and force end_call —
  // guarantees a consistent, correctly-ending call regardless of how the
  // model phrased it.
  const EXACT_CLOSING_LINE =
    "Thank you for calling Clear Insurance. Please don't hesitate to come back if you have any further questions or if I can help you in any way. Have a great day.";

  const soundsLikeFarewell =
    !isFirstResponse &&
    /goodbye|bye\b|take care|talk soon|have a good|all the best|great day|call.{0,20}(has been |is |now )?end(ed)?|thank(s| you) for calling/i.test(
      finalOutput,
    );

  if (soundsLikeFarewell) {
    if (finalOutput.trim() !== EXACT_CLOSING_LINE) {
      console.log(
        `[${convId}] Safety net: model's closing ("${finalOutput}") didn't match the exact script — overriding.`,
      );
      finalOutput = EXACT_CLOSING_LINE;
    }
    console.log(`[${convId}] Safety net: forcing end_call.`);
    void endCallForCaller(session.authorInfo?.address);

    // For non-voice channels the Conversation itself has no equivalent of
    // "hanging up" — without explicitly closing it here, it stays "active"
    // indefinitely, and the next message from the same customer (even days
    // later) gets routed into this same old Conversation with stale
    // conversationHistory/state instead of starting fresh.
    //
    // Uses tac.getConversationClient() (the same Orchestrator-aware client
    // createStudioHandoffTool uses internally, via coClient.updateConversation)
    // rather than a raw Conversations API call — a raw API call bypasses the
    // Orchestrator's participant bookkeeping and was observed leaving a test
    // Conversation in a broken state where the customer's own participant got
    // misidentified as the AI agent on the next message.
    if (channel !== 'voice') {
      const conversationSid = session.metadata?.channelId as string | undefined;
      if (conversationSid) {
        // Fire-and-forget, like endCallForCaller above — awaiting this here
        // would block the function's return until the Conversation is
        // already INACTIVE, and the closing message (finalOutput, returned
        // below) still needs to be sent through this same Conversation
        // after we return. If the send happens after the state change goes
        // through, it can fail silently, same failure mode as the earlier
        // closed-before-send bug.
        void (async () => {
          try {
          const coClient = tac.getConversationClient();
          if (!coClient) {
            console.error(`[${convId}] getConversationClient() returned null, cannot close Conversation ${convId}.`);
            return;
          }
          await coClient.updateConversation(convId, 'CLOSED');
          console.log(`[${convId}] Marked Conversation ${convId} CLOSED after farewell.`);
          } catch (err) {
          console.error(`[${convId}] Failed to close Conversation ${convId} after farewell:`, err);
        }
      })();
      }
    }
  }

  return finalOutput || undefined;
}

tac.onMessageReady(handleMessageReady);

const endedConversations = new Set<string>();
tac.onConversationEnded(async ({ session }) => {
  const convId = session.conversationId;
  if (endedConversations.has(convId)) return;
  endedConversations.add(convId);
  console.log(`Conversation ${convId} ended`);
  delete conversationHistory[convId];
  clearState(convId);
});

const server = new TACServer(tac);

const twilioClient = twilio(process.env.TWILIO_API_KEY!, process.env.TWILIO_API_SECRET!, {
  accountSid: process.env.TWILIO_ACCOUNT_SID!,
});

const AI_AUTHOR_IDENTITY = 'ai-assistant';

server.fastify.post('/webhook-email', async (request, reply) => {
  reply.code(200).send({ received: true });
  try {
    const body = request.body as any;
    if (body.EventType !== 'onMessageAdded') return;
    if (body.Author === AI_AUTHOR_IDENTITY) return;

    const conversationSid = body.ConversationSid as string;
    const messageSid = body.MessageSid as string;
    const customerEmail = body.Author as string;

    if (!conversationSid || !messageSid) {
      console.warn('[email] Missing ConversationSid or MessageSid, skipping.');
      return;
    }

    const convId = conversationSid;

    // Same handoff-silence guard as handleMessageReady, for the email channel.
    const preHandoffState = getState(convId);
    if (preHandoffState.handoffTriggered) {
      console.log(`[email][${convId}] Handoff already triggered — staying silent so the live agent can respond directly.`);
      return;
    }

    const message = await twilioClient.conversations.v1
      .conversations(conversationSid)
      .messages(messageSid)
      .fetch();

    const emailText = message.body ?? '';
    console.log(`[email][${conversationSid}] Customer said: ${emailText}`);

    const state = getState(convId);
    if (!state.email) {
      state.email = customerEmail;
    }

    const handoffTool = createStudioHandoffTool(tac, {
      conversationId: convId,
      authorInfo: { address: customerEmail },
    } as any, {
      attributes: await buildHandoffAttributes(convId, undefined, 'email', customerEmail),
    });

    const tools = [
      await makeVerifyCustomerTool(convId).toOpenAIAgentsSDKTool(),
      await makeRecordAccidentDetailsTool(convId).toOpenAIAgentsSDKTool(),
      await makeSendClaimChecklistTool(convId, 'email').toOpenAIAgentsSDKTool(),
      await makeSearchKnowledgeTool(convId).toOpenAIAgentsSDKTool(),
      await makeSendClaimSummaryEmailTool(convId).toOpenAIAgentsSDKTool(),
    ];

    if (process.env.TWILIO_STUDIO_HANDOFF_FLOW_SID) {
      tools.push(await handoffTool.toOpenAIAgentsSDKTool());
    }

    const agent = new Agent({
      name: 'Clear Insurance Claims Assistant (Email)',
      instructions: buildSystemInstructions(),
      model: 'gpt-5.4-nano',
      modelSettings: { temperature: 0 },
      tools,
    });

    const history = conversationHistory[convId] ?? [];
    const agentInput: AgentInputItem[] = [...history, { role: 'user', content: emailText }];
    const result = await run(agent, agentInput);
    conversationHistory[convId] = result.history;

    // Same handoff-tool detection as handleMessageReady — this handler had
    // no mechanism at all for marking handoffTriggered before, which was
    // the root cause of the AI staying in the conversation after a
    // handoff on the email channel.
    const handoffToolWasCalled = result.output?.some(
      (item: any) => item.type === 'function_call' && item.name === 'handoff'
    );
    if (handoffToolWasCalled && !state.handoffTriggered) {
      state.handoffTriggered = true;
      console.log(`[email][${convId}] Handoff tool was called — marking handoffTriggered.`);
    }

    const replyText = result.finalOutput || "Thanks for your message — we'll follow up shortly.";
    console.log(`[email][${conversationSid}] Assistant said: ${replyText}`);

    const htmlContent = replyText
      .split('\n\n')
      .map((p: string) => `<p style="color: #333333; font-size: 14px; line-height: 1.7; margin: 0 0 14px 0;">${p.replace(/\n/g, '<br>')}</p>`)
      .join('');

    const htmlReply = wrapInEmailTemplate(htmlContent);

    try {
      const mediaSid = await uploadHtmlToMcs(htmlReply);
      await twilioClient.conversations.v1
        .conversations(conversationSid)
        .messages.create({
          author: AI_AUTHOR_IDENTITY,
          body: replyText,
          mediaSid: [mediaSid],
        } as any);
      console.log(`[email][${conversationSid}] Sent HTML reply via MCS MediaSid: ${mediaSid}`);
    } catch (mcsErr) {
      console.warn(`[email][${conversationSid}] MCS upload failed, falling back to plain text:`, mcsErr);
      await twilioClient.conversations.v1
        .conversations(conversationSid)
        .messages.create({
          author: AI_AUTHOR_IDENTITY,
          body: replyText,
        });
    }
  } catch (err) {
    console.error('[email] Error processing inbound email:', err);
  }
});

server
  .start()
  .then(() => {
    console.log('Clear Insurance Claims Assistant started successfully');
  })
  .catch(error => {
    console.error('Failed to start server:', error);
    process.exit(1);
  });