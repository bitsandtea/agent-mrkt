// CCTP Core Components
export {
  AttestationStatus,
  getAttestation,
  pollAttestation,
  pollAttestationPromise,
  type Attestation,
  type AttestationResponse,
} from "./attestationService";
export { CCTPService } from "./service";

// CCTP Utilities
export {
  addressToBytes32,
  bytes32ToAddress,
  formatAmount,
  isValidAddress,
  parseAmount,
} from "./utils";

// CCTP Types (re-exported from permits/types)
export type {
  CCTPTransactionDetails,
  CrossChainPayment,
} from "../permits/types";
