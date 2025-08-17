export interface UserPermit {
  id: string;
  userAddress: string;
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
