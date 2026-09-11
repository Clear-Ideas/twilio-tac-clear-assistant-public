export interface AccidentDetails {
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

export interface ConversationState {
  verified: boolean;
  customerName?: string;
  policyNumber?: string;
  phoneNumber?: string;
  email?: string;
  injuryReported?: boolean;
  accident?: AccidentDetails;
  claimChecklistSent?: boolean;
  handoffTriggered?: boolean;
  topicsDiscussed?: string[];
}

const conversationState = new Map<string, ConversationState>();

export function getState(conversationId: string): ConversationState {
  let state = conversationState.get(conversationId);
  if (!state) {
    state = { verified: false };
    conversationState.set(conversationId, state);
  }
  return state;
}

export function clearState(conversationId: string): void {
  conversationState.delete(conversationId);
}