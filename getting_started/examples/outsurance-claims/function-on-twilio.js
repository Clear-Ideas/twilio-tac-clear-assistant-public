/**
 * create-flex-task-from-handoff.protected.js
 *
 * Replaces the "Send to Flex" Studio widget for the REST API trigger path
 * (used when the TAC AI assistant calls createStudioHandoffTool for
 * SMS/WhatsApp/Chat handoffs — voice already works fine with the native
 * "Send to Flex" widget since it redirects a live call).
 *
 * Why this exists: "Send to Flex" only supports Incoming Call and Incoming
 * Chat trigger types (error 81020 otherwise). This Function uses the Flex
 * Interactions API directly instead — the same API "Send to Flex" calls
 * under the hood — which correctly binds to the EXISTING Conversation
 * (created by the TAC assistant) and lets Flex add the agent as a
 * participant automatically once the task is accepted.
 *
 * Console setup:
 *  - Create as a new Function in this Service, protected.
 *  - In the Studio Flow, add a "Run Function" widget on the REST API
 *    trigger output, pointing to this function.
 *  - Parameters to pass in from the Studio widget:
 *      conversationId         -> {{trigger.request.parameters.HandoffData.conversationId}}
 *      conversationSid        -> {{trigger.request.parameters.HandoffData.attributes.conversationSid}}
 *      conversationSummary    -> {{trigger.request.parameters.HandoffData.attributes.conversationSummary}}
 *      conversationSentiment  -> {{trigger.request.parameters.HandoffData.attributes.conversationSentiment}}
 *      department             -> {{trigger.request.parameters.HandoffData.attributes.department}}
 *      priority                -> {{trigger.request.parameters.HandoffData.attributes.priority}}
 *      reason                  -> {{trigger.request.parameters.HandoffData.attributes.reason}}
 *      channelType             -> pass the TAC channel type if available, else defaults to "chat"
 *
 * Environment variables needed:
 *  - TWILIO_FLEX_WORKSPACE_SID (same one already used by update-call-summary)
 *  - TWILIO_FLEX_WORKFLOW_SID  (WW07e3feb83be74cf12fec307aede2f2cb in this project)
 */


const TASK_CHANNEL_MAP = {
  whatsapp: 'chat',
};

exports.handler = async function (context, event, callback) {
  const client = context.getTwilioClient();
  const workspaceSid = context.TWILIO_FLEX_WORKSPACE_SID;
  const workflowSid = context.TWILIO_FLEX_WORKFLOW_SID;

  const response = new Twilio.Response();
  response.appendHeader('Content-Type', 'application/json');

  const conversationId = event.conversationId;
  if (!conversationId) {
    response.setStatusCode(400);
    response.setBody({ success: false, error: 'Missing conversationId' });
    return callback(null, response);
  }

  // media_channel_sid needs the real Conversation SID (CH...), not the
  // internal TAC id — fall back to conversationId only if conversationSid
  // wasn't passed (shouldn't normally happen now that the Studio widget
  // sends both parameters).
  const conversationSid = event.conversationSid || conversationId;

  // The TAC's own channelType (e.g. "whatsapp", "chat", "sms") is kept as
  // the customer-facing channel value, but the TaskChannel it's routed
  // into on this Workspace may differ — map it via TASK_CHANNEL_MAP.
  const rawChannelType = event.channelType || 'chat';
  const taskChannelUniqueName = TASK_CHANNEL_MAP[rawChannelType] || rawChannelType;

  const interactionPayload = {
    channel: {
      type: taskChannelUniqueName,
      initiated_by: 'customer',
      properties: {
        media_channel_sid: conversationSid,
      },
    },
    routing: {
      properties: {
        workspace_sid: workspaceSid,
        workflow_sid: workflowSid,
        task_channel_unique_name: taskChannelUniqueName,
        attributes: {
          conversationSummary: event.conversationSummary || '',
          conversationSentiment: event.conversationSentiment || 'neutral',
          department: event.department || 'general',
          handoffReason: event.reason || '',
          customerName: event.customerName || 'Unknown',
          name: event.customerName || 'Unknown',
          // Needed by the CRM Container (Custom URL template uses
          // {{task.conversationSid}}) and by crm-form-submit's manual task
          // matching — without these, the CRM form/email-capture flow has
          // no way to find or bind to this task.
          conversationSid: conversationSid,
          channel: rawChannelType,
        },
      },
    },
  };

  // Debug logging — added while diagnosing WhatsApp handoff failures.
  // Shows exactly what's being sent to the Interactions API, so a Bad
  // Request/invalid-parameters error can be traced to the specific field.
  console.log('[create-flex-task] rawChannelType:', rawChannelType, 'taskChannelUniqueName:', taskChannelUniqueName);
  console.log('[create-flex-task] conversationSid used:', conversationSid);
  console.log('[create-flex-task] full interaction payload:', JSON.stringify(interactionPayload, null, 2));

  try {
    const interaction = await client.flexApi.v1.interaction.create(interactionPayload);

    console.log('Flex Interaction created from AI handoff:', interaction.sid);

    response.setBody({ success: true, interactionSid: interaction.sid });
    return callback(null, response);
  } catch (error) {
    console.error('[create-flex-task] Failed to create Flex interaction:', {
      message: error.message,
      code: error.code,
      status: error.status,
      moreInfo: error.moreInfo,
      details: error.details,
    });
    response.setStatusCode(500);
    response.setBody({ success: false, error: error.message });
    return callback(null, response);
  }
};