import { defineTool, TACTool } from 'twilio-agent-connect';
import { getState } from '../state.js';

interface RecordAccidentDetailsArgs {
  injuryReported: boolean;
  whatHappened?: string;
  dateTime?: string;
  location?: string;
  otherVehicleInvolved?: boolean;
  otherVehicleDetails?: string;
  witnesses?: string;
  gardaReported?: boolean;
  gardaReference?: string;
  vehicleDriveable?: boolean;
}

interface RecordAccidentDetailsResult {
  success: boolean;
  reason?: string;
  injuryReported?: boolean;
}

/**
 * Call this in two passes:
 * 1. As soon as the welfare check is answered — pass ONLY injuryReported
 *    (leave the rest undefined). This can happen BEFORE identity is
 *    verified, since welfare/safety always comes first.
 * 2. After identity is verified and the remaining accident details are
 *    collected — call again with the full set of fields, injuryReported
 *    repeated as false.
 */
export function makeRecordAccidentDetailsTool(conversationId: string): TACTool {
  return defineTool(
    'record_accident_details',
    'Records the welfare check result and accident details for a motor claim. Call this ' +
      'FIRST with only injuryReported as soon as the customer answers the welfare check ' +
      '("is everyone okay?") — this can happen before identity verification, since safety ' +
      'comes first. If injuryReported is true, do not continue collecting details or ask for ' +
      'identity; the handoff tool will be used instead. If injuryReported is false, call this ' +
      'again later (after identity is verified) with the full accident details once collected.',
    {
      type: 'object',
      properties: {
        injuryReported: {
          type: 'boolean',
          description: 'Whether the customer indicated anyone was hurt',
        },
        whatHappened: { type: 'string', description: "Brief description in customer's own words" },
        dateTime: { type: 'string', description: 'Date and time of the accident' },
        location: { type: 'string', description: 'Exact location of the accident' },
        otherVehicleInvolved: { type: 'boolean' },
        otherVehicleDetails: {
          type: 'string',
          description: 'Registration and insurance details of other vehicle(s), if any',
        },
        witnesses: { type: 'string', description: 'Contact details of independent witnesses, if any' },
        gardaReported: { type: 'boolean', description: 'Whether Gardaí were called or attended' },
        gardaReference: { type: 'string', description: 'Garda incident/PULSE reference number, if any' },
        vehicleDriveable: { type: 'boolean', description: 'Whether the vehicle is driveable now' },
      },
      required: ['injuryReported'],
    },
    async (args: RecordAccidentDetailsArgs): Promise<RecordAccidentDetailsResult> => {
      const state = getState(conversationId);

      const isWelfareCheckOnly = args.whatHappened === undefined && args.dateTime === undefined;
      if (!isWelfareCheckOnly && !state.verified) {
        return { success: false, reason: 'Customer not verified yet. Call verify_customer first.' };
      }

      state.injuryReported = args.injuryReported;

      if (!args.injuryReported) {
        state.accident = {
          ...state.accident,
          whatHappened: args.whatHappened ?? state.accident?.whatHappened,
          dateTime: args.dateTime ?? state.accident?.dateTime,
          location: args.location ?? state.accident?.location,
          otherVehicleInvolved: args.otherVehicleInvolved ?? state.accident?.otherVehicleInvolved,
          otherVehicleDetails: args.otherVehicleDetails ?? state.accident?.otherVehicleDetails,
          witnesses: args.witnesses ?? state.accident?.witnesses,
          gardaReported: args.gardaReported ?? state.accident?.gardaReported,
          gardaReference: args.gardaReference ?? state.accident?.gardaReference,
          vehicleDriveable: args.vehicleDriveable ?? state.accident?.vehicleDriveable,
        };
      }

      return { success: true, injuryReported: args.injuryReported };
    }
  );
}