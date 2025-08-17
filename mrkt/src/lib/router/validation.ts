import { getAddress } from "viem";
import {
  formatTokenAmount,
  getTokenAddress,
  PERMIT2_ADDRESS,
} from "../../config/tokens";
import { createRouterPublicClient } from "../router/clients";
import { ERC20_ABI, PERMIT2_ABI } from "./abis";

// Custom error types for pre-transfer validation
export class InsufficientBalanceError extends Error {
  constructor(
    public token: string,
    public required: number,
    public actual: number,
    public userAddress: string
  ) {
    super(
      `Insufficient ${token} balance: user ${userAddress} has ${actual} ${token}, needs ${required} ${token}`
    );
    this.name = "InsufficientBalanceError";
  }
}

export class InsufficientPermit2AllowanceError extends Error {
  constructor(
    public token: string,
    public required: number,
    public actual: number,
    public userAddress: string
  ) {
    super(
      `Insufficient token allowance to Permit2: user ${userAddress} has approved ${actual} ${token} to Permit2 (${PERMIT2_ADDRESS}), needs ${required} ${token}. User must call approve() or permit() on the token contract.`
    );
    this.name = "InsufficientPermit2AllowanceError";
  }
}

export class PreTransferValidationError extends Error {
  constructor(
    public validationErrors: string[],
    public balanceCheck: BalanceValidationResult,
    public permit2AllowanceCheck: AllowanceValidationResult
  ) {
    super(`Pre-transfer validation failed: ${validationErrors.join("; ")}`);
    this.name = "PreTransferValidationError";
  }
}

// Balance validation result interface
export interface BalanceValidationResult {
  hasBalance: boolean;
  actualBalance: number;
  error?: string;
}

// Allowance validation result interface
export interface AllowanceValidationResult {
  hasAllowance: boolean;
  actualAllowance: number;
  error?: string;
}

// Permit2 validation result interface
export interface Permit2ValidationResult {
  hasAllowance: boolean;
  actualAllowance: number;
  expiration: number;
  nonce: number;
  error?: string;
}

// Validate on-chain balance
export async function validateOnChainBalance(
  userAddress: string,
  token: string,
  chainId: number,
  requiredAmount: number
): Promise<BalanceValidationResult> {
  try {
    // Get RPC client for the chain
    const client = createRouterPublicClient(chainId);
    if (!client) {
      return {
        hasBalance: false,
        actualBalance: 0,
        error: "Unsupported chain",
      };
    }

    // Get token contract address
    const tokenAddress = getTokenAddress(token, chainId);
    if (!tokenAddress) {
      return {
        hasBalance: false,
        actualBalance: 0,
        error: "Token not supported on this chain",
      };
    }

    // Check token balance
    const balance = await client.readContract({
      address: getAddress(tokenAddress),
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [getAddress(userAddress)],
    });

    const actualBalance = formatTokenAmount(balance, token);
    const hasBalance = actualBalance >= requiredAmount;

    return { hasBalance, actualBalance };
  } catch {
    return {
      hasBalance: false,
      actualBalance: 0,
      error: "Failed to check balance on-chain",
    };
  }
}

// Validate admin allowance
export async function validateAdminAllowance(
  userAddress: string,
  token: string,
  chainId: number,
  requiredAmount: number
): Promise<AllowanceValidationResult> {
  try {
    const client = createRouterPublicClient(chainId);
    const tokenAddress = getTokenAddress(token, chainId);
    const adminAddress = process.env.NEXT_PUBLIC_ADMIN_ADDRESS; // Backend env var

    if (!client || !tokenAddress || !adminAddress) {
      return {
        hasAllowance: false,
        actualAllowance: 0,
        error: "Configuration error",
      };
    }

    // Check allowance to admin address
    const allowance = await client.readContract({
      address: getAddress(tokenAddress),
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [getAddress(userAddress), getAddress(adminAddress)],
    });

    const actualAllowance = formatTokenAmount(allowance, token);
    const hasAllowance = actualAllowance >= requiredAmount;

    return { hasAllowance, actualAllowance };
  } catch {
    return {
      hasAllowance: false,
      actualAllowance: 0,
      error: "Failed to check allowance",
    };
  }
}

// Validate Permit2 allowance (signature-based approvals)
export async function validatePermit2Allowance(
  userAddress: string,
  token: string,
  chainId: number,
  spenderAddress: string,
  requiredAmount: number
): Promise<Permit2ValidationResult> {
  try {
    const client = createRouterPublicClient(chainId);
    const tokenAddress = getTokenAddress(token, chainId);

    if (!client || !tokenAddress) {
      return {
        hasAllowance: false,
        actualAllowance: 0,
        expiration: 0,
        nonce: 0,
        error: "Configuration error",
      };
    }

    // Check Permit2 allowance
    console.log("checking permit 2 allowance", {
      usr: userAddress,
      token: tokenAddress,
      spender: spenderAddress,
    });
    const allowanceData = await client.readContract({
      address: getAddress(PERMIT2_ADDRESS),
      abi: PERMIT2_ABI,
      functionName: "allowance",
      args: [
        getAddress(userAddress),
        getAddress(tokenAddress),
        getAddress(spenderAddress),
      ],
    });

    const [amount, expiration, nonce] = allowanceData;
    const actualAllowance = formatTokenAmount(amount, token);
    const currentTime = Math.floor(Date.now() / 1000);
    const hasAllowance =
      actualAllowance >= requiredAmount && Number(expiration) > currentTime;

    return {
      hasAllowance,
      actualAllowance,
      expiration: Number(expiration),
      nonce: Number(nonce),
    };
  } catch {
    return {
      hasAllowance: false,
      actualAllowance: 0,
      expiration: 0,
      nonce: 0,
      error: "Failed to check Permit2 allowance",
    };
  }
}

// Validate user's token allowance to Permit2 contract
export async function validateTokenToPermit2Allowance(
  userAddress: string,
  token: string,
  chainId: number,
  requiredAmount: number
): Promise<AllowanceValidationResult> {
  try {
    const client = createRouterPublicClient(chainId);
    const tokenAddress = getTokenAddress(token, chainId);

    if (!client || !tokenAddress) {
      return {
        hasAllowance: false,
        actualAllowance: 0,
        error: "Configuration error",
      };
    }

    // Check token allowance to Permit2
    const allowance = await client.readContract({
      address: getAddress(tokenAddress),
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [getAddress(userAddress), getAddress(PERMIT2_ADDRESS)],
    });

    const actualAllowance = formatTokenAmount(allowance, token);
    const hasAllowance = actualAllowance >= requiredAmount;

    return { hasAllowance, actualAllowance };
  } catch {
    return {
      hasAllowance: false,
      actualAllowance: 0,
      error: "Failed to check token allowance to Permit2",
    };
  }
}

// Pre-transfer validation combining balance and allowance checks
export interface PreTransferValidationResult {
  isValid: boolean;
  balanceCheck: BalanceValidationResult;
  permit2AllowanceCheck: AllowanceValidationResult;
  errors: string[];
}

export async function validatePreTransferRequirements(
  userAddress: string,
  token: string,
  chainId: number,
  requiredAmount: number
): Promise<PreTransferValidationResult> {
  const errors: string[] = [];

  // Check user balance
  const balanceCheck = await validateOnChainBalance(
    userAddress,
    token,
    chainId,
    requiredAmount
  );

  // Check token allowance to Permit2
  const permit2AllowanceCheck = await validateTokenToPermit2Allowance(
    userAddress,
    token,
    chainId,
    requiredAmount
  );

  // Collect errors
  if (!balanceCheck.hasBalance) {
    errors.push(
      `Insufficient balance: has ${balanceCheck.actualBalance} ${token}, needs ${requiredAmount} ${token}`
    );
  }

  if (!permit2AllowanceCheck.hasAllowance) {
    errors.push(
      `Insufficient token allowance to Permit2: has ${permit2AllowanceCheck.actualAllowance} ${token}, needs ${requiredAmount} ${token}. User must approve Permit2 contract (${PERMIT2_ADDRESS}) to spend tokens.`
    );
  }

  if (balanceCheck.error) {
    errors.push(`Balance check error: ${balanceCheck.error}`);
  }

  if (permit2AllowanceCheck.error) {
    errors.push(
      `Permit2 allowance check error: ${permit2AllowanceCheck.error}`
    );
  }

  return {
    isValid: errors.length === 0,
    balanceCheck,
    permit2AllowanceCheck,
    errors,
  };
}
