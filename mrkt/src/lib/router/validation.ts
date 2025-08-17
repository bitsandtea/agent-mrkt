import { getAddress } from "viem";
import { getTokenAddress, SupportedChainId } from "../../config/tokens";
import { ERC20_ABI } from "./abis";
import { createPublicClient } from "./clients";

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

// Validate on-chain balance
export async function validateOnChainBalance(
  userAddress: string,
  token: string,
  chainId: number,
  requiredAmount: number
): Promise<BalanceValidationResult> {
  try {
    // Get RPC client for the chain
    const client = createPublicClient(chainId);
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

    const actualBalance = Number(balance) / 1e6; // Assuming 6 decimals for stablecoins
    const hasBalance = actualBalance >= requiredAmount;

    return { hasBalance, actualBalance };
  } catch (error) {
    console.error("Error checking on-chain balance:", error);
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
    const client = createPublicClient(chainId);
    const tokenAddress = getTokenAddress(token, chainId);
    const adminAddress = process.env.ADMIN_ADDRESS; // Backend env var

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

    const actualAllowance = Number(allowance) / 1e6;
    const hasAllowance = actualAllowance >= requiredAmount;

    return { hasAllowance, actualAllowance };
  } catch (error) {
    console.error("Error checking admin allowance:", error);
    return {
      hasAllowance: false,
      actualAllowance: 0,
      error: "Failed to check allowance",
    };
  }
}
