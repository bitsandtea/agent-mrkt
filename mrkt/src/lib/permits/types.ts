export interface UserPermit {
  id: string;
  userAddress: string;
  agentId?: string; // Agent ID for subscription creation
  token: string;
  chainId: number;
  spenderAddress: string; // Admin address
  amount: bigint;
  nonce: bigint;
  deadline: bigint;
  signature: {
    r: string;
    s: string;
    v: number;
  };
  tokenPermitSig?: {
    r: string;
    s: string;
    v: number;
    deadline: string;
  };
  status: "active" | "expired" | "revoked";
  createdAt: number;
  expiresAt: number;
  maxCalls: number;
  callsUsed: number;
  costPerCall: number;
}

export interface PermitConfig {
  token: string; // USDC, PYUSD
  chainId: number;
  maxAmount: bigint; // Maximum spendable amount
  costPerCall: number; // USD cost per API call (each agent has their own)
  maxCalls: number; // Calculated from maxAmount / costPerCall
  deadline: bigint; // Permit expiration timestamp
}

/**
 * Cross-chain payment tracking for CCTP transfers
 */
export interface CrossChainPayment {
  id: string;
  agentId: string;
  userId: string;
  sourceChainId: number;
  targetChainId: number;
  amount: string;
  token: string;
  messageHash: string;
  attestationStatus: "pending" | "complete" | "failed";
  sourceTransactionHash?: string;
  targetTransactionHash?: string;
  permitId?: string;
  createdAt: number;
  completedAt?: number;
  errorMessage?: string;
}

/**
 * CCTP transaction details
 */
export interface CCTPTransactionDetails {
  messageHash: string;
  message: string;
  sourceChainId: number;
  targetChainId: number;
  amount: string;
  token: string;
  sender: string;
  recipient: string;
  nonce: string;
}
