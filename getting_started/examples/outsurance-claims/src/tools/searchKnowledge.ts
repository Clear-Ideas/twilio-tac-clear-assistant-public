import { defineTool, TACTool } from 'twilio-agent-connect';
import { getState } from '../state.js';

interface SearchKnowledgeArgs {
  query: string;
}

interface SearchKnowledgeResult {
  success: boolean;
  reason?: string;
  results?: string[];
}


/**
 * Searches the Enterprise Knowledge base — same integration validated on
 * the Clear Insurance project. Point TWILIO_KNOWLEDGE_BASE_ID at a
 * knowledge base loaded with the real Clear Insurance Agent Call Scripts +
 * Policy FAQ documents.
 */
export function makeSearchKnowledgeTool(conversationId: string): TACTool {
  return defineTool(
    'search_knowledge',
    'Searches the Clear Insurance knowledge base for general policy questions, or claim-type ' +
      "guidance outside the current motor-accident flow (e.g. windscreen damage, theft, " +
      'home claims, excess, ClearBonus). Call this instead of guessing.',
    {
      type: 'object',
      properties: {
        query: { type: 'string', description: "The customer's question, in their own words" },
      },
      required: ['query'],
    },
    async (args: SearchKnowledgeArgs): Promise<SearchKnowledgeResult> => {
      
      const state = getState(conversationId);
      state.topicsDiscussed = [...(state.topicsDiscussed ?? []), args.query];

      const kbId = process.env.TWILIO_KNOWLEDGE_BASE_ID;
      if (!kbId) {
        return { success: false, reason: 'No knowledge base configured.' };
      }

      const auth = Buffer.from(
        `${process.env.TWILIO_API_KEY}:${process.env.TWILIO_API_SECRET}`
      ).toString('base64');


      try {
        const response = await fetch(
          `https://knowledge.twilio.com/v2/KnowledgeBases/${kbId}/Search`,
          {
            method: 'POST',
            headers: {
              Authorization: `Basic ${auth}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ query: args.query, top: 3 }),
          }
        );

        if (!response.ok) {
          const text = await response.text();
          console.error(`[search_knowledge] HTTP ${response.status}: ${text}`);
          return { success: false, reason: `Search failed with status ${response.status}` };
        }

        const data = (await response.json()) as { chunks?: { content: string }[] };
        const results: string[] = (data.chunks ?? []).map((c) => c.content);

        return { success: true, results };
      } catch (err) {
        return { success: false, reason: err instanceof Error ? err.message : String(err) };
      }
    }
  );
}