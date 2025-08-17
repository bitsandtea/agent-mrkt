import {
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
  keccak256,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia, sepolia } from "viem/chains";
import {
  getDestinationDomain,
  getTokenAddress,
  getTokenMessengerContractAddress,
  RPC_URLS,
  SupportedChainId,
} from "../config/tokens";
import { CCTPService } from "./cctp/service";
import { parseAmount } from "./cctp/utils";
import * as db from "./db";
import { getPermitsByUser } from "./db";
import { CrossChainPayment } from "./permits/types";

// Types for the router system
export interface RouterRequest {
  method: string;
  parameters: Record<string, unknown>;
  metadata?: {
    source?: string;
    version?: string;
  };
}

export interface RouterResponse {
  success: boolean;
  data?: {
    response: unknown;
    publisher_response: {
      status_code: number;
      response_time_ms: number;
    };
  };
  billing: {
    call_type: "free_trial" | "paid";
    cost_usd: number;
    free_trials_remaining: number;
    balance_after_call: number;
  };
  metadata: {
    request_id: string;
    agent_id: string;
    timestamp: string;
  };
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export interface PreAuthorizationResult {
  authorized: boolean;
  call_type: "free_trial" | "paid";
  cost_usd: number;
  cost_tokens: number;
  free_trials_remaining: number;
  balance_after_call: number;
  crossChainRequired?: boolean;
  paymentDetails?: {
    sourceChain: number;
    targetChain: number;
    token: string;
    permitId: string;
  };
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

// Network configurations (for future use)
// const NETWORK_CONFIGS = {
//   arbitrum: {
//     chain: arbitrum,
//     rpc: process.env.ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc',
//   },
//   base: {
//     chain: base,
//     rpc: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
//   },
//   ethereum: {
//     chain: mainnet,
//     rpc: process.env.ETHEREUM_RPC_URL || 'https://eth.llamarpc.com',
//   },
// };

export class APIRouter {
  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // Add on-chain balance validation
  private async validateOnChainBalance(
    userAddress: string,
    token: string,
    chainId: number,
    requiredAmount: number
  ): Promise<{ hasBalance: boolean; actualBalance: number; error?: string }> {
    try {
      // Get RPC client for the chain
      const client = this.getPublicClient(chainId);
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
        abi: [
          {
            inputs: [{ name: "account", type: "address" }],
            name: "balanceOf",
            outputs: [{ name: "", type: "uint256" }],
            stateMutability: "view",
            type: "function",
          },
        ],
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

  private async validateAdminAllowance(
    userAddress: string,
    token: string,
    chainId: number,
    requiredAmount: number
  ): Promise<{
    hasAllowance: boolean;
    actualAllowance: number;
    error?: string;
  }> {
    try {
      const client = this.getPublicClient(chainId);
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
        abi: [
          {
            inputs: [
              { name: "owner", type: "address" },
              { name: "spender", type: "address" },
            ],
            name: "allowance",
            outputs: [{ name: "", type: "uint256" }],
            stateMutability: "view",
            type: "function",
          },
        ],
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

  private getPublicClient(chainId: number) {
    switch (chainId) {
      case SupportedChainId.BASE_SEPOLIA:
        return createPublicClient({
          chain: baseSepolia,
          transport: http(RPC_URLS[SupportedChainId.BASE_SEPOLIA]),
        });
      case SupportedChainId.ETH_SEPOLIA:
        return createPublicClient({
          chain: sepolia,
          transport: http(RPC_URLS[SupportedChainId.ETH_SEPOLIA]),
        });
      default:
        return null;
    }
  }

  private getWalletClient(chainId: number, privateKey: string) {
    const account = privateKeyToAccount(privateKey as `0x${string}`);

    switch (chainId) {
      case SupportedChainId.BASE_SEPOLIA:
        return createWalletClient({
          chain: baseSepolia,
          transport: http(RPC_URLS[SupportedChainId.BASE_SEPOLIA]),
          account,
        });
      case SupportedChainId.ETH_SEPOLIA:
        return createWalletClient({
          chain: sepolia,
          transport: http(RPC_URLS[SupportedChainId.ETH_SEPOLIA]),
          account,
        });
      default:
        return null;
    }
  }

  // Execute permit-based transfer from user to admin wallet
  private async executePermitTransfer(
    permit: db.UserPermit,
    amount: bigint,
    chainId: SupportedChainId,
    adminPrivateKey: string
  ): Promise<void> {
    const client = this.getWalletClient(chainId, adminPrivateKey);
    if (!client) {
      throw new Error(`Unsupported chain ID: ${chainId}`);
    }

    const tokenAddress = getTokenAddress(permit.token, chainId);
    if (!tokenAddress) {
      throw new Error(
        `Token ${permit.token} not supported on chain ${chainId}`
      );
    }

    // ERC20 transferFrom ABI - we only need transferFrom since permit was already signed by user
    const transferFromABI = [
      {
        inputs: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "amount", type: "uint256" },
        ],
        name: "transferFrom",
        outputs: [{ name: "", type: "bool" }],
        stateMutability: "nonpayable",
        type: "function",
      },
    ] as const;

    // The permit was already signed by the user and gives the admin wallet (spender)
    // permission to transfer tokens. We just need to execute transferFrom.
    const transferHash = await client.writeContract({
      address: tokenAddress as `0x${string}`,
      abi: transferFromABI,
      functionName: "transferFrom",
      args: [
        permit.userAddress as `0x${string}`,
        permit.spenderAddress as `0x${string}`, // This is the admin wallet
        amount,
      ],
    });

    // Wait for transfer transaction to be mined
    const publicClient = this.getPublicClient(chainId);
    if (!publicClient) {
      throw new Error(`Unsupported chain ID: ${chainId}`);
    }

    const transferReceipt = await publicClient.waitForTransactionReceipt({
      hash: transferHash,
    });

    if (transferReceipt.status !== "success") {
      throw new Error("TransferFrom transaction failed");
    }
  }

  // Approve TokenMessenger to spend admin's USDC
  private async approveTokenMessenger(
    tokenAddress: string,
    amount: bigint,
    chainId: SupportedChainId,
    adminPrivateKey: string
  ): Promise<void> {
    const client = this.getWalletClient(chainId, adminPrivateKey);
    if (!client) {
      throw new Error(`Unsupported chain ID: ${chainId}`);
    }

    const tokenMessengerAddress = getTokenMessengerContractAddress(chainId);

    // ERC20 approve ABI
    const approveABI = [
      {
        inputs: [
          { name: "spender", type: "address" },
          { name: "amount", type: "uint256" },
        ],
        name: "approve",
        outputs: [{ name: "", type: "bool" }],
        stateMutability: "nonpayable",
        type: "function",
      },
    ] as const;

    const approveHash = await client.writeContract({
      address: tokenAddress as `0x${string}`,
      abi: approveABI,
      functionName: "approve",
      args: [tokenMessengerAddress as `0x${string}`, amount],
    });

    // Wait for approval transaction to be mined
    const publicClient = this.getPublicClient(chainId);
    if (!publicClient) {
      throw new Error(`Unsupported chain ID: ${chainId}`);
    }

    const approveReceipt = await publicClient.waitForTransactionReceipt({
      hash: approveHash,
    });

    if (approveReceipt.status !== "success") {
      throw new Error("Approve transaction failed");
    }
  }

  // Extract messageHash from transaction receipt by parsing MessageSent event
  private async extractMessageHashFromReceipt(
    transactionHash: string,
    chainId: SupportedChainId
  ): Promise<string> {
    const client = this.getPublicClient(chainId);
    if (!client) {
      throw new Error(`Unsupported chain ID: ${chainId}`);
    }

    // Get transaction receipt
    const receipt = await client.getTransactionReceipt({
      hash: transactionHash as `0x${string}`,
    });

    // MessageSent event signature: MessageSent(bytes message)
    const messageSentEventSignature =
      "0x8c5261668696ce22758910d05bab8f186d6eb247ceac2af2e82c7dc17669b036";

    // Find MessageSent event in logs
    const messageSentLog = receipt.logs.find(
      (log) => log.topics[0] === messageSentEventSignature
    );

    if (!messageSentLog) {
      throw new Error("MessageSent event not found in transaction receipt");
    }

    // The messageHash is the keccak256 hash of the message data
    // For CCTP, the message data is in the log's data field
    const messageData = messageSentLog.data;

    // Hash the message data to get the messageHash
    const messageHash = keccak256(messageData);

    return messageHash;
  }

  private needsCrossChainTransfer(
    permit: db.UserPermit,
    agent: db.Agent
  ): boolean {
    const targetChainId = this.getTargetChainId(
      agent.payment_preferences.payout_network
    );
    const targetToken = agent.payment_preferences.payout_token;

    // If chains or tokens differ, we need cross-chain transfer
    const chainsDiffer = permit.chainId !== targetChainId;
    const tokensDiffer = permit.token !== targetToken;

    // IMPORTANT: CCTP v2 only supports USDC for cross-chain transfers
    // If user has PYUSD and needs cross-chain, it's only possible if:
    // 1. Publisher accepts PYUSD on the same chain as user, OR
    // 2. User has USDC that can be used for CCTP transfer
    if (chainsDiffer && permit.token !== "USDC") {
      // This will be handled as an error in the validation step
      // since non-USDC tokens cannot do cross-chain transfers via CCTP
      return true; // Mark as needing cross-chain to trigger validation error
    }

    return chainsDiffer || tokensDiffer;
  }

  // Authentication layer - validates user API key and permissions
  async authenticateUser(
    apiKey: string
  ): Promise<{ success: boolean; user?: db.User; error?: string }> {
    try {
      const users = await db.getUsers();
      const user = users.find((u) => u.api_key === apiKey);

      if (!user) {
        return { success: false, error: "Invalid API key" };
      }

      if (!user.is_approved) {
        return { success: false, error: "User not approved" };
      }

      return { success: true, user };
    } catch (error) {
      console.error("Authentication error:", error);
      return { success: false, error: "Authentication failed" };
    }
  }

  // Validate user subscription to agent
  async validateSubscription(
    userId: string,
    agentId: string
  ): Promise<{
    success: boolean;
    subscription?: db.Subscription;
    error?: string;
  }> {
    try {
      const subscriptions = await db.getSubscriptions();
      const subscription = subscriptions.find(
        (s) =>
          s.user_id === userId &&
          s.agent_id === agentId &&
          s.status === "active"
      );

      if (!subscription) {
        return { success: false, error: "No active subscription found" };
      }

      return { success: true, subscription };
    } catch (error) {
      console.error("Subscription validation error:", error);
      return { success: false, error: "Subscription validation failed" };
    }
  }

  // Pre-authorization check for billing with enhanced on-chain validation
  async preAuthorizeCall(
    userId: string,
    agentId: string,
    subscription: db.Subscription
  ): Promise<PreAuthorizationResult> {
    const logPrefix = `[PRE-AUTH-${agentId}]`;

    console.log(`${logPrefix} Starting pre-authorization validation:`, {
      userId,
      agentId,
      subscriptionId: subscription.id,
      subscriptionStatus: subscription.status,
      freeTrialsRemaining: subscription.free_trials_remaining,
      timestamp: new Date().toISOString(),
    });

    try {
      const agents = await db.getAgents();
      const agent = agents.find((a) => a.id === agentId);
      const user = await db.getUserById(userId);

      console.log(`${logPrefix} Database lookup results:`, {
        agentFound: !!agent,
        userFound: !!user,
        userWallet: user?.wallet_address,
        agentPrice: agent?.price_per_call_usd,
      });

      if (!agent || !user?.wallet_address) {
        console.error(
          `${logPrefix} Validation failed - missing agent or user:`,
          {
            agentFound: !!agent,
            userFound: !!user,
            userHasWallet: !!user?.wallet_address,
          }
        );
        return {
          authorized: false,
          call_type: "paid",
          cost_usd: 0,
          cost_tokens: 0,
          free_trials_remaining: 0,
          balance_after_call: 0,
          error: {
            code: "AGENT_OR_USER_NOT_FOUND",
            message: "Agent or user not found",
          },
        };
      }

      const costUsd = agent.price_per_call_usd;
      const freeTrialsRemaining = subscription.free_trials_remaining;

      console.log(`${logPrefix} Call pricing details:`, {
        costUsd,
        freeTrialsRemaining,
        qualifiesForFreeTrial: freeTrialsRemaining > 0,
      });

      // Check if this qualifies for free trial
      if (freeTrialsRemaining > 0) {
        console.log(`${logPrefix} ✅ Authorized via free trial:`, {
          trialsUsed: 1,
          trialsRemaining: freeTrialsRemaining - 1,
        });
        return {
          authorized: true,
          call_type: "free_trial",
          cost_usd: 0,
          cost_tokens: 0,
          free_trials_remaining: freeTrialsRemaining - 1,
          balance_after_call: 0,
        };
      }

      // For paid calls, get user's active permits
      console.log(`${logPrefix} Fetching user permits for paid call...`);
      const userPermits = await getPermitsByUser(user.wallet_address);
      const activePermits = userPermits.filter(
        (permit) => permit.status === "active"
      );

      console.log(`${logPrefix} User permits analysis:`, {
        totalPermits: userPermits.length,
        activePermits: activePermits.length,
        permits: activePermits.map((p) => ({
          id: p.id,
          token: p.token,
          chainId: p.chainId,
          status: p.status,
          remainingCalls: p.maxCalls - p.callsUsed,
          remainingValue: (p.maxCalls - p.callsUsed) * p.costPerCall,
          costPerCall: p.costPerCall,
        })),
      });

      if (activePermits.length === 0) {
        console.error(`${logPrefix} ❌ No active permits found for payment`);
        return {
          authorized: false,
          call_type: "paid",
          cost_usd: costUsd,
          cost_tokens: costUsd,
          free_trials_remaining: 0,
          balance_after_call: 0,
          error: {
            code: "NO_VALID_PERMITS",
            message: "No active permits found for payment",
          },
        };
      }

      // Find best permit for payment (highest balance, matching token/chain preferences)
      console.log(
        `${logPrefix} Finding best permit for payment amount: $${costUsd}`
      );
      const bestPermit = this.findBestPermitForPayment(
        activePermits,
        agent,
        costUsd
      );

      if (!bestPermit) {
        console.error(`${logPrefix} ❌ No permit has sufficient balance:`, {
          requiredAmount: costUsd,
          availablePermits: activePermits.map((p) => ({
            id: p.id,
            remainingValue: (p.maxCalls - p.callsUsed) * p.costPerCall,
          })),
        });
        return {
          authorized: false,
          call_type: "paid",
          cost_usd: costUsd,
          cost_tokens: costUsd,
          free_trials_remaining: 0,
          balance_after_call: 0,
          error: {
            code: "INSUFFICIENT_PERMIT_BALANCE",
            message: "No permit has sufficient balance for this operation",
          },
        };
      }

      console.log(`${logPrefix} Selected permit for payment:`, {
        permitId: bestPermit.id,
        token: bestPermit.token,
        chainId: bestPermit.chainId,
        remainingCalls: bestPermit.maxCalls - bestPermit.callsUsed,
        remainingValue:
          (bestPermit.maxCalls - bestPermit.callsUsed) * bestPermit.costPerCall,
        costPerCall: bestPermit.costPerCall,
      });

      // Validate actual on-chain balance
      console.log(`${logPrefix} Validating on-chain balance...`);
      const balanceCheck = await this.validateOnChainBalance(
        user.wallet_address,
        bestPermit.token,
        bestPermit.chainId,
        costUsd
      );

      console.log(`${logPrefix} On-chain balance validation result:`, {
        hasBalance: balanceCheck.hasBalance,
        actualBalance: balanceCheck.actualBalance,
        requiredAmount: costUsd,
        token: bestPermit.token,
        chainId: bestPermit.chainId,
        error: balanceCheck.error,
      });

      if (!balanceCheck.hasBalance) {
        console.error(`${logPrefix} ❌ Insufficient on-chain balance:`, {
          token: bestPermit.token,
          required: costUsd,
          available: balanceCheck.actualBalance,
          shortfall: costUsd - balanceCheck.actualBalance,
        });
        return {
          authorized: false,
          call_type: "paid",
          cost_usd: costUsd,
          cost_tokens: costUsd,
          free_trials_remaining: 0,
          balance_after_call: balanceCheck.actualBalance,
          error: {
            code: "INSUFFICIENT_BALANCE",
            message: `Insufficient ${bestPermit.token} balance. Required: ${costUsd}, Available: ${balanceCheck.actualBalance}`,
            details: balanceCheck.error
              ? { onChainError: balanceCheck.error }
              : undefined,
          },
        };
      }

      // Validate admin allowance
      console.log(`${logPrefix} Validating admin allowance...`);
      const allowanceCheck = await this.validateAdminAllowance(
        user.wallet_address,
        bestPermit.token,
        bestPermit.chainId,
        costUsd
      );

      console.log(`${logPrefix} Admin allowance validation result:`, {
        hasAllowance: allowanceCheck.hasAllowance,
        actualAllowance: allowanceCheck.actualAllowance,
        requiredAmount: costUsd,
        token: bestPermit.token,
        chainId: bestPermit.chainId,
        error: allowanceCheck.error,
      });

      if (!allowanceCheck.hasAllowance) {
        console.error(`${logPrefix} ❌ Insufficient admin allowance:`, {
          token: bestPermit.token,
          required: costUsd,
          allowed: allowanceCheck.actualAllowance,
          shortfall: costUsd - allowanceCheck.actualAllowance,
        });
        return {
          authorized: false,
          call_type: "paid",
          cost_usd: costUsd,
          cost_tokens: costUsd,
          free_trials_remaining: 0,
          balance_after_call: balanceCheck.actualBalance,
          error: {
            code: "INSUFFICIENT_ALLOWANCE",
            message: `Insufficient ${bestPermit.token} allowance to admin. Required: ${costUsd}, Allowed: ${allowanceCheck.actualAllowance}`,
            details: allowanceCheck.error
              ? { allowanceError: allowanceCheck.error }
              : undefined,
          },
        };
      }

      // Check if cross-chain transfer is needed
      console.log(`${logPrefix} Checking cross-chain transfer requirements...`);
      const needsCrossChain = this.needsCrossChainTransfer(bestPermit, agent);
      const targetChainId = this.getTargetChainId(
        agent.payment_preferences.payout_network
      );

      console.log(`${logPrefix} Cross-chain analysis:`, {
        needsCrossChain,
        sourceChain: bestPermit.chainId,
        targetChain: targetChainId,
        sourceToken: bestPermit.token,
        targetToken: agent.payment_preferences.payout_token,
        publisherNetwork: agent.payment_preferences.payout_network,
      });

      console.log(`${logPrefix} ✅ Pre-authorization successful:`, {
        callType: "paid",
        costUsd,
        balanceAfter: balanceCheck.actualBalance - costUsd,
        crossChainRequired: needsCrossChain,
        paymentRoute: `${bestPermit.token} on chain ${bestPermit.chainId} → ${agent.payment_preferences.payout_token} on chain ${targetChainId}`,
      });

      return {
        authorized: true,
        call_type: "paid",
        cost_usd: costUsd,
        cost_tokens: costUsd,
        free_trials_remaining: 0,
        balance_after_call: balanceCheck.actualBalance - costUsd,
        crossChainRequired: needsCrossChain,
        paymentDetails: {
          sourceChain: bestPermit.chainId,
          targetChain: targetChainId,
          token: bestPermit.token,
          permitId: bestPermit.id,
        },
      };
    } catch (error) {
      console.error("Pre-authorization error:", error);
      return {
        authorized: false,
        call_type: "paid",
        cost_usd: 0,
        cost_tokens: 0,
        free_trials_remaining: 0,
        balance_after_call: 0,
        error: { code: "PREAUTH_FAILED", message: "Pre-authorization failed" },
      };
    }
  }

  // Forward request to publisher API
  async forwardRequest(
    agent: db.Agent,
    request: RouterRequest
  ): Promise<{
    success: boolean;
    response?: unknown;
    status_code: number;
    response_time_ms: number;
    error?: string;
  }> {
    const startTime = Date.now();

    try {
      if (!agent.api_endpoint) {
        throw new Error("Agent API endpoint not configured");
      }

      // Transform request parameters to match publisher's expected format
      const transformedRequest = this.transformRequestParameters(
        request,
        agent
      );

      // Make actual HTTP request to publisher API

      const response = await fetch(agent.api_endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${agent.publisher_api_key || ""}`,
          "User-Agent": "Agent-Marketplace-Router/1.0",
        },
        body: JSON.stringify(transformedRequest),
        signal: AbortSignal.timeout(13000), // 30 second timeout
      });

      const responseTime = Date.now() - startTime;
      console.log("response fetched", response);

      let responseData;
      try {
        responseData = await response.json();
      } catch (error) {
        console.error("Failed to parse response as JSON:", error);
        // If JSON parsing fails, try to get text response
        try {
          const textResponse = await response.text();
          console.log("response text: ", textResponse);
          responseData = {
            error: "Invalid JSON response",
            raw_response: textResponse,
          };
        } catch (textError) {
          console.error("Failed to get text response:", textError);
          responseData = { error: "Failed to parse response" };
        }
      }

      return {
        success: response.ok,
        response: responseData,
        status_code: response.status,
        response_time_ms: responseTime,
        error: response.ok
          ? undefined
          : `Publisher API error: ${response.statusText}`,
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;
      console.error("Request forwarding error:", error);

      // Handle different types of errors with appropriate status codes
      let statusCode = 500;
      let errorMessage = "Failed to forward request to publisher API";

      if (error instanceof Error) {
        if (error.name === "AbortError" || error.message.includes("timeout")) {
          statusCode = 504;
          errorMessage = "Publisher API request timeout";
        } else if (
          error.message.includes("fetch") ||
          error.message.includes("network")
        ) {
          statusCode = 502;
          errorMessage = "Publisher API unavailable";
        } else if (
          error.message.includes("JSON") ||
          error.message.includes("parse")
        ) {
          statusCode = 502;
          errorMessage = "Invalid response from publisher API";
        } else {
          errorMessage = error.message;
        }
      }

      return {
        success: false,
        status_code: statusCode,
        response_time_ms: responseTime,
        error: errorMessage,
      };
    }
  }

  // Transform request parameters to match publisher's expected format
  private transformRequestParameters(
    request: RouterRequest,
    agent: db.Agent
  ): unknown {
    // For now, pass through the request as-is
    // In the future, this could be customized per agent based on their API specification
    return {
      method: request.method,
      parameters: request.parameters,
      metadata: {
        ...request.metadata,
        router_version: "1.0",
        agent_id: agent.id,
      },
    };
  }

  // Process billing after successful API call
  async processBilling(
    userId: string,
    agentId: string,
    subscriptionId: string,
    preAuth: PreAuthorizationResult,
    apiCallId: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Update subscription usage
      if (preAuth.call_type === "free_trial") {
        await db.updateSubscriptionUsage(subscriptionId, true);
      } else {
        // For paid calls, process CCTP cross-chain payment
        await this.processCCTPPayment(
          userId,
          agentId,
          preAuth.cost_usd,
          apiCallId
        );
        await db.updateSubscriptionUsage(subscriptionId, false);
      }

      return { success: true };
    } catch (error) {
      console.error("Billing processing error:", error);
      return { success: false, error: "Billing processing failed" };
    }
  }

  // Process CCTP cross-chain payment from user to publisher
  private async processCCTPPayment(
    userId: string,
    agentId: string,
    costUsd: number,
    apiCallId: string
  ): Promise<void> {
    const logPrefix = `[CCTP-PAYMENT-${apiCallId}]`;

    console.log(`${logPrefix} Starting CCTP payment processing:`, {
      userId,
      agentId,
      costUsd,
      apiCallId,
      timestamp: new Date().toISOString(),
    });

    try {
      const user = await db.getUserById(userId);
      const agents = await db.getAgents();
      const agent = agents.find((a) => a.id === agentId);

      if (!user?.wallet_address) {
        console.error(
          `${logPrefix} User wallet address not found for user: ${userId}`
        );
        throw new Error("User wallet address not found");
      }

      if (!agent) {
        console.error(`${logPrefix} Agent not found: ${agentId}`);
        throw new Error("Agent not found");
      }

      console.log(`${logPrefix} User and agent validated:`, {
        userWallet: user.wallet_address,
        agentId: agent.id,
        publisherWallet: agent.publisher_wallet_address,
        paymentPreferences: agent.payment_preferences,
      });

      // Get user's active permits to find the best payment source
      const userPermits = await getPermitsByUser(user.wallet_address);
      const activePermits = userPermits.filter(
        (permit) => permit.status === "active"
      );

      console.log(`${logPrefix} User permits found:`, {
        totalPermits: userPermits.length,
        activePermits: activePermits.length,
        permits: activePermits.map((p) => ({
          id: p.id,
          token: p.token,
          chainId: p.chainId,
          remainingCalls: p.maxCalls - p.callsUsed,
          remainingValue: (p.maxCalls - p.callsUsed) * p.costPerCall,
        })),
      });

      if (activePermits.length === 0) {
        console.error(
          `${logPrefix} No active permits found for user: ${user.wallet_address}`
        );
        throw new Error("No active permits found for payment");
      }

      // Find the best permit to use based on publisher preferences and balance
      const bestPermit = this.findBestPermitForPayment(
        activePermits,
        agent,
        costUsd
      );

      if (!bestPermit) {
        console.error(
          `${logPrefix} No suitable permit found for payment amount: ${costUsd}`
        );
        throw new Error("Insufficient permit balance for payment");
      }

      console.log(`${logPrefix} Selected permit for payment:`, {
        permitId: bestPermit.id,
        token: bestPermit.token,
        chainId: bestPermit.chainId,
        remainingCalls: bestPermit.maxCalls - bestPermit.callsUsed,
        remainingValue:
          (bestPermit.maxCalls - bestPermit.callsUsed) * bestPermit.costPerCall,
      });

      // Get publisher's wallet address from agent
      if (!agent.publisher_wallet_address) {
        console.error(
          `${logPrefix} Publisher wallet address not configured for agent: ${agentId}`
        );
        throw new Error(
          "Publisher wallet address not configured for this agent"
        );
      }

      // Determine target chain based on publisher preferences
      const targetChainId = this.getTargetChainId(
        agent.payment_preferences.payout_network
      );

      console.log(`${logPrefix} Payment routing details:`, {
        sourceChain: bestPermit.chainId,
        targetChain: targetChainId,
        sourceToken: bestPermit.token,
        targetToken: agent.payment_preferences.payout_token,
        crossChainRequired:
          bestPermit.chainId !== targetChainId ||
          bestPermit.token !== agent.payment_preferences.payout_token,
      });

      // Execute the transfer (cross-chain or same-chain)
      const paymentResult = await this.executeCCTPTransfer({
        fromAddress: user.wallet_address,
        toAddress: agent.publisher_wallet_address,
        amount: costUsd,
        sourceChainId: bestPermit.chainId,
        targetChainId,
        token: bestPermit.token,
        permit: bestPermit,
      });

      console.log(`${logPrefix} Transfer completed:`, {
        transactionHash: paymentResult.transactionHash,
        messageHash: paymentResult.messageHash,
        blockNumber: paymentResult.blockNumber,
        gasUsed: paymentResult.gasUsed,
        crossChainPaymentId: paymentResult.crossChainPaymentId,
      });

      // Only update permit usage after successful transfer completion
      // For cross-chain transfers, this happens after attestation and redemption
      // For same-chain transfers, this happens immediately
      if (!paymentResult.messageHash) {
        // Same-chain transfer completed immediately
        await db.updatePermitUsage(bestPermit.id, bestPermit.callsUsed + 1);
        console.log(
          `${logPrefix} Permit usage updated for same-chain transfer:`,
          {
            permitId: bestPermit.id,
            callsUsedBefore: bestPermit.callsUsed,
            callsUsedAfter: bestPermit.callsUsed + 1,
          }
        );
      } else {
        // Cross-chain transfer - permit usage will be updated after attestation/redemption
        console.log(
          `${logPrefix} Cross-chain transfer initiated - permit usage will be updated after completion`
        );
      }

      // Create payment record
      const paymentData = {
        id: `payment_${Date.now()}`,
        user_id: userId,
        agent_id: agentId,
        subscription_id: "", // Not needed for API calls
        amount_usd: costUsd,
        amount_tokens: costUsd, // 1:1 for stablecoins
        token: bestPermit.token,
        network: agent.payment_preferences.payout_network,
        transaction_hash: paymentResult.transactionHash,
        status: paymentResult.messageHash ? "pending_attestation" : "completed",
        payment_type: "api_call",
        api_call_id: apiCallId,
        timestamp: new Date().toISOString(),
        block_number: paymentResult.blockNumber || 0,
        gas_used: paymentResult.gasUsed || 50000,
        gas_price: "20000000000",
        message_hash: paymentResult.messageHash,
        cross_chain_payment_id: paymentResult.crossChainPaymentId,
      };

      await db.createPayment(paymentData);

      console.log(`${logPrefix} Payment record created:`, {
        paymentId: paymentData.id,
        status: paymentData.status,
        messageHash: paymentData.message_hash,
        crossChainPaymentId: paymentData.cross_chain_payment_id,
      });

      console.log(
        `${logPrefix} CCTP payment processing completed successfully`
      );
    } catch (error) {
      console.error(`${logPrefix} CCTP payment processing failed:`, {
        error: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : undefined,
        userId,
        agentId,
        costUsd,
      });

      // Provide more specific error messages for common failure scenarios
      if (error instanceof Error) {
        if (error.message.includes("wallet address not found")) {
          throw new Error(
            "Payment failed: User or publisher wallet not configured"
          );
        } else if (error.message.includes("permit")) {
          throw new Error(
            "Payment failed: Invalid or insufficient permit balance"
          );
        } else if (error.message.includes("CCTP")) {
          throw new Error("Payment failed: Cross-chain transfer error");
        }
      }

      throw new Error(
        "Payment processing failed: " +
          (error instanceof Error ? error.message : "Unknown error")
      );
    }
  }

  // Find the best permit for payment based on publisher preferences and balance
  private findBestPermitForPayment(
    permits: db.UserPermit[],
    agent: db.Agent,
    costUsd: number
  ): db.UserPermit | null {
    // Filter permits that have enough balance
    const viablePermits = permits.filter((permit) => {
      const remainingCalls = permit.maxCalls - permit.callsUsed;
      const remainingValue = remainingCalls * permit.costPerCall;
      return remainingValue >= costUsd;
    });

    if (viablePermits.length === 0) return null;

    // Prefer permits that match publisher's preferred token and network
    const targetChainId = this.getTargetChainId(
      agent.payment_preferences.payout_network
    );
    const preferredPermits = viablePermits.filter(
      (permit) =>
        permit.token === agent.payment_preferences.payout_token &&
        permit.chainId === targetChainId
    );

    if (preferredPermits.length > 0) {
      // Return the one with highest balance
      return preferredPermits.sort((a, b) => {
        const aBalance = (a.maxCalls - a.callsUsed) * a.costPerCall;
        const bBalance = (b.maxCalls - b.callsUsed) * b.costPerCall;
        return bBalance - aBalance;
      })[0];
    }

    // If no preferred permits, prioritize USDC permits for cross-chain capability
    const usdcPermits = viablePermits.filter(
      (permit) => permit.token === "USDC"
    );
    if (usdcPermits.length > 0) {
      return usdcPermits.sort((a, b) => {
        const aBalance = (a.maxCalls - a.callsUsed) * a.costPerCall;
        const bBalance = (b.maxCalls - b.callsUsed) * b.costPerCall;
        return bBalance - aBalance;
      })[0];
    }

    // If no USDC permits, return the one with highest balance
    return viablePermits.sort((a, b) => {
      const aBalance = (a.maxCalls - a.callsUsed) * a.costPerCall;
      const bBalance = (b.maxCalls - b.callsUsed) * b.costPerCall;
      return bBalance - aBalance;
    })[0];
  }

  // Get target chain ID from network name
  private getTargetChainId(network: string): number {
    switch (network.toLowerCase()) {
      case "base":
      case "base_sepolia":
        return SupportedChainId.BASE_SEPOLIA;
      case "ethereum":
      case "eth_sepolia":
        return SupportedChainId.ETH_SEPOLIA;
      case "arbitrum":
      case "arbitrum_sepolia":
        return SupportedChainId.ARB_MAINNET; // Use mainnet ID for arbitrum
      default:
        return SupportedChainId.BASE_SEPOLIA; // Default to Base Sepolia
    }
  }

  // Execute CCTP cross-chain transfer
  private async executeCCTPTransfer(params: {
    fromAddress: string;
    toAddress: string;
    amount: number;
    sourceChainId: number;
    targetChainId: number;
    token: string;
    permit: db.UserPermit;
  }): Promise<{
    transactionHash: string;
    blockNumber?: number;
    gasUsed?: number;
    messageHash?: string;
    crossChainPaymentId?: string;
  }> {
    const logPrefix = `[CCTP-TRANSFER]`;

    console.log(`${logPrefix} Initiating transfer:`, {
      from: params.fromAddress,
      to: params.toAddress,
      amount: params.amount,
      sourceChain: params.sourceChainId,
      targetChain: params.targetChainId,
      token: params.token,
      permitId: params.permit.id,
      timestamp: new Date().toISOString(),
    });

    // Check if this is actually a cross-chain transfer
    if (
      params.sourceChainId === params.targetChainId &&
      params.token === params.token
    ) {
      console.log(
        `${logPrefix} Same-chain transfer detected, using direct transfer`
      );
      return this.executeSameChainTransfer(params);
    }

    // Validate CCTP transfer parameters
    const transferParams = {
      sourceChainId: params.sourceChainId as SupportedChainId,
      targetChainId: params.targetChainId as SupportedChainId,
      amount: params.amount.toString(),
      token: params.token,
      recipient: params.toAddress,
      sender: params.fromAddress,
    };

    console.log(`${logPrefix} Validating CCTP transfer parameters...`);
    const validation = CCTPService.validateTransfer(transferParams);

    if (!validation.valid) {
      console.error(`${logPrefix} CCTP validation failed:`, validation.error);
      throw new Error(`CCTP transfer validation failed: ${validation.error}`);
    }

    console.log(
      `${logPrefix} CCTP validation passed, proceeding with transfer`
    );

    try {
      // Create cross-chain payment record
      const crossChainPayment: CrossChainPayment = {
        id: `cctp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        agentId: "", // Will be set by caller
        userId: "", // Will be set by caller
        sourceChainId: params.sourceChainId,
        targetChainId: params.targetChainId,
        amount: parseAmount(params.amount.toString(), 6).toString(),
        token: params.token,
        messageHash: "", // Will be set after depositForBurn
        attestationStatus: "pending",
        permitId: params.permit.id,
        createdAt: Date.now(),
      };

      console.log(`${logPrefix} Created cross-chain payment record:`, {
        paymentId: crossChainPayment.id,
        sourceChain: crossChainPayment.sourceChainId,
        targetChain: crossChainPayment.targetChainId,
        amount: crossChainPayment.amount,
        token: crossChainPayment.token,
      });

      // Step 1: Execute depositForBurn on source chain
      console.log(
        `${logPrefix} Step 1: Executing depositForBurn on source chain ${params.sourceChainId}`
      );

      const adminPrivateKey = process.env.ADMIN_PKEY;
      if (!adminPrivateKey) {
        throw new Error("ADMIN_PKEY environment variable not set");
      }

      // Get destination domain for target chain
      const destinationDomain = getDestinationDomain(params.targetChainId);
      if (!destinationDomain) {
        throw new Error(
          `Unsupported target chain for CCTP: ${params.targetChainId}`
        );
      }

      // Get token address on source chain
      const burnTokenAddress = getTokenAddress(
        params.token,
        params.sourceChainId
      );
      if (!burnTokenAddress) {
        throw new Error(
          `Token ${params.token} not supported on chain ${params.sourceChainId}`
        );
      }

      console.log(`${logPrefix} Calling TokenMessenger.depositForBurn with:`, {
        amount: crossChainPayment.amount,
        destinationDomain: destinationDomain,
        mintRecipient: params.toAddress,
        burnToken: burnTokenAddress,
        transferType: "standard",
      });

      // Step 1: Transfer USDC from user to admin wallet using permit
      console.log(
        `${logPrefix} Step 1: Transferring USDC from user to admin wallet using permit...`
      );
      try {
        await this.executePermitTransfer(
          params.permit,
          BigInt(crossChainPayment.amount),
          params.sourceChainId as SupportedChainId,
          adminPrivateKey
        );
        console.log(
          `${logPrefix} ✅ USDC transferred from user to admin wallet`
        );
      } catch (error) {
        console.error(`${logPrefix} Permit transfer failed:`, {
          error: error instanceof Error ? error.message : "Unknown error",
          permitId: params.permit.id,
          amount: crossChainPayment.amount,
        });
        throw new Error(
          `Failed to transfer USDC using permit: ${
            error instanceof Error ? error.message : "Unknown error"
          }`
        );
      }

      // Step 2: Approve TokenMessenger to spend admin's USDC
      console.log(
        `${logPrefix} Step 2: Approving TokenMessenger to spend USDC...`
      );
      try {
        await this.approveTokenMessenger(
          burnTokenAddress,
          BigInt(crossChainPayment.amount),
          params.sourceChainId as SupportedChainId,
          adminPrivateKey
        );
        console.log(`${logPrefix} ✅ TokenMessenger approved to spend USDC`);
      } catch (error) {
        console.error(`${logPrefix} TokenMessenger approval failed:`, {
          error: error instanceof Error ? error.message : "Unknown error",
          tokenAddress: burnTokenAddress,
          amount: crossChainPayment.amount,
        });
        throw new Error(
          `Failed to approve TokenMessenger: ${
            error instanceof Error ? error.message : "Unknown error"
          }`
        );
      }

      // Step 3: Execute depositForBurn transaction
      console.log(
        `${logPrefix} Step 3: Executing depositForBurn transaction...`
      );
      let depositResult;
      try {
        depositResult = await CCTPService.depositForBurn(
          params.sourceChainId as SupportedChainId,
          {
            amount: BigInt(crossChainPayment.amount),
            destinationDomain: destinationDomain,
            mintRecipient: params.toAddress,
            burnToken: burnTokenAddress,
            transferType: "standard",
          },
          adminPrivateKey
        );
      } catch (error) {
        console.error(`${logPrefix} DepositForBurn transaction failed:`, {
          error: error instanceof Error ? error.message : "Unknown error",
          stack: error instanceof Error ? error.stack : undefined,
          sourceChainId: params.sourceChainId,
          amount: crossChainPayment.amount,
          destinationDomain,
          burnToken: burnTokenAddress,
        });
        throw new Error(
          `Failed to execute depositForBurn: ${
            error instanceof Error ? error.message : "Unknown error"
          }`
        );
      }

      const transactionHash = depositResult.transactionHash;
      let messageHash = depositResult.messageHash;

      // Extract real messageHash from transaction receipt
      if (!messageHash) {
        try {
          messageHash = await this.extractMessageHashFromReceipt(
            transactionHash,
            params.sourceChainId as SupportedChainId
          );
          console.log(
            `${logPrefix} ✅ Extracted messageHash from receipt: ${messageHash}`
          );
        } catch (error) {
          console.error(
            `${logPrefix} Failed to extract messageHash from receipt:`,
            error
          );
          // Fallback to placeholder for now
          messageHash = `0x${transactionHash.slice(2, 66)}`;
          console.log(
            `${logPrefix} Using fallback messageHash: ${messageHash}`
          );
        }
      }

      console.log(`${logPrefix} Step 1 completed:`, {
        sourceTransactionHash: transactionHash,
        messageHash: messageHash,
        realTransaction: true,
      });

      // Update cross-chain payment record with initial status
      crossChainPayment.sourceTransactionHash = transactionHash;
      crossChainPayment.messageHash = messageHash;
      crossChainPayment.attestationStatus = "pending";

      // Store the cross-chain payment record in database
      await db.createCrossChainPayment(crossChainPayment);

      console.log(`${logPrefix} Cross-chain payment record stored:`, {
        paymentId: crossChainPayment.id,
        sourceTransactionHash: crossChainPayment.sourceTransactionHash,
        messageHash: crossChainPayment.messageHash,
        attestationStatus: crossChainPayment.attestationStatus,
      });

      // Step 4: Poll for attestation completion
      console.log(`${logPrefix} Step 4: Polling for attestation...`);
      let attestationResult;
      try {
        attestationResult = await CCTPService.waitForAttestation(messageHash);
        if (!attestationResult.success) {
          throw new Error(attestationResult.error || "Attestation failed");
        }
        console.log(`${logPrefix} ✅ Attestation completed`);
      } catch (error) {
        console.error(`${logPrefix} Attestation polling failed:`, error);
        crossChainPayment.attestationStatus = "failed";
        crossChainPayment.errorMessage =
          error instanceof Error ? error.message : "Attestation failed";
        // Note: updateCrossChainPayment doesn't exist, would need to be implemented
        throw new Error(
          `Attestation polling failed: ${
            error instanceof Error ? error.message : "Unknown error"
          }`
        );
      }

      // Step 5: Execute receiveMessage on destination chain
      console.log(
        `${logPrefix} Step 5: Executing receiveMessage on destination chain...`
      );
      let redemptionResult;
      try {
        // Parse attestation response - Circle API returns message and attestation
        const attestationData = JSON.parse(attestationResult.attestation!);
        redemptionResult = await CCTPService.receiveMessage(
          params.targetChainId as SupportedChainId,
          {
            message: attestationData.message as `0x${string}`,
            attestation: attestationData.attestation as `0x${string}`,
          },
          adminPrivateKey
        );
        console.log(
          `${logPrefix} ✅ ReceiveMessage completed: ${redemptionResult.transactionHash}`
        );
      } catch (error) {
        console.error(`${logPrefix} ReceiveMessage failed:`, error);
        crossChainPayment.attestationStatus = "failed";
        crossChainPayment.errorMessage =
          error instanceof Error ? error.message : "Redemption failed";
        // Note: updateCrossChainPayment doesn't exist, would need to be implemented
        throw new Error(
          `Redemption failed: ${
            error instanceof Error ? error.message : "Unknown error"
          }`
        );
      }

      // Update payment status to completed
      crossChainPayment.attestationStatus = "complete";
      crossChainPayment.targetTransactionHash =
        redemptionResult.transactionHash;
      crossChainPayment.completedAt = Date.now();
      // Note: updateCrossChainPayment doesn't exist, would need to be implemented

      // Update permit usage after successful cross-chain transfer completion
      await db.updatePermitUsage(params.permit.id, params.permit.callsUsed + 1);
      console.log(
        `${logPrefix} ✅ Permit usage updated after successful cross-chain transfer:`,
        {
          permitId: params.permit.id,
          callsUsedBefore: params.permit.callsUsed,
          callsUsedAfter: params.permit.callsUsed + 1,
        }
      );

      console.log(
        `${logPrefix} ✅ Cross-chain transfer completed successfully`
      );

      console.log(`${logPrefix} CCTP transfer initiated successfully`);

      return {
        transactionHash,
        messageHash,
        blockNumber: undefined, // Will be filled when transaction is mined
        gasUsed: undefined, // Will be filled when transaction is mined
        crossChainPaymentId: crossChainPayment.id,
      };
    } catch (error) {
      console.error(`${logPrefix} CCTP transfer execution failed:`, {
        error: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : undefined,
        params: transferParams,
      });
      throw new Error(
        `CCTP transfer failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  // Execute same-chain transfer using permit
  private async executeSameChainTransfer(params: {
    fromAddress: string;
    toAddress: string;
    amount: number;
    sourceChainId: number;
    token: string;
    permit: db.UserPermit;
  }): Promise<{
    transactionHash: string;
    blockNumber?: number;
    gasUsed?: number;
  }> {
    const logPrefix = `[SAME-CHAIN-TRANSFER]`;

    console.log(`${logPrefix} Executing same-chain transfer:`, {
      from: params.fromAddress,
      to: params.toAddress,
      amount: params.amount,
      chain: params.sourceChainId,
      token: params.token,
      permitId: params.permit.id,
      timestamp: new Date().toISOString(),
    });

    const adminPrivateKey = process.env.ADMIN_PKEY;
    if (!adminPrivateKey) {
      throw new Error("ADMIN_PKEY environment variable not set");
    }

    // Get token contract address
    const tokenAddress = getTokenAddress(params.token, params.sourceChainId);
    if (!tokenAddress) {
      throw new Error(
        `Token ${params.token} not supported on chain ${params.sourceChainId}`
      );
    }

    console.log(`${logPrefix} Using permit for authorization:`, {
      permitId: params.permit.id,
      spenderAddress: params.permit.spenderAddress,
      amount: params.permit.amount.toString(),
      deadline: params.permit.deadline.toString(),
      nonce: params.permit.nonce.toString(),
    });

    // Create wallet client for admin
    const client = this.getPublicClient(params.sourceChainId);
    if (!client) {
      throw new Error(`Unsupported chain: ${params.sourceChainId}`);
    }

    // Get viem chain config
    let chain;
    switch (params.sourceChainId) {
      case SupportedChainId.BASE_SEPOLIA:
        chain = baseSepolia;
        break;
      case SupportedChainId.ETH_SEPOLIA:
        chain = sepolia;
        break;
      default:
        throw new Error(`Unsupported chain: ${params.sourceChainId}`);
    }

    const account = privateKeyToAccount(adminPrivateKey as `0x${string}`);
    const walletClient = createWalletClient({
      chain,
      transport: http(RPC_URLS[params.sourceChainId as keyof typeof RPC_URLS]),
      account,
    });

    // Convert amount to token units (assuming 6 decimals for stablecoins)
    const amountInTokenUnits = parseAmount(params.amount.toString(), 6);

    console.log(`${logPrefix} Executing transferFrom with permit:`, {
      tokenAddress,
      from: params.fromAddress,
      to: params.toAddress,
      amount: amountInTokenUnits.toString(),
    });

    // Execute transferFrom using the permit
    let transactionHash;
    try {
      transactionHash = await walletClient.writeContract({
        address: getAddress(tokenAddress),
        abi: [
          {
            inputs: [
              { name: "from", type: "address" },
              { name: "to", type: "address" },
              { name: "amount", type: "uint256" },
            ],
            name: "transferFrom",
            outputs: [{ name: "", type: "bool" }],
            stateMutability: "nonpayable",
            type: "function",
          },
        ],
        functionName: "transferFrom",
        args: [
          getAddress(params.fromAddress),
          getAddress(params.toAddress),
          amountInTokenUnits,
        ],
      });
    } catch (error) {
      console.error(`${logPrefix} TransferFrom transaction failed:`, {
        error: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : undefined,
        tokenAddress,
        from: params.fromAddress,
        to: params.toAddress,
        amount: amountInTokenUnits.toString(),
        permitId: params.permit.id,
      });
      throw new Error(
        `Failed to execute transferFrom: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }

    console.log(`${logPrefix} Same-chain transfer completed:`, {
      transactionHash,
      permitUsed: params.permit.id,
      realTransaction: true,
    });

    return {
      transactionHash,
      blockNumber: undefined, // Will be filled when transaction is mined
      gasUsed: undefined, // Will be filled when transaction is mined
    };
  }

  // Log API call for tracking and analytics
  async logApiCall(
    userId: string,
    agentId: string,
    subscriptionId: string,
    request: RouterRequest,
    response: unknown,
    preAuth: PreAuthorizationResult,
    publisherResponse: { status_code: number; response_time_ms: number }
  ): Promise<string> {
    try {
      const apiCallData = {
        id: `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        user_id: userId,
        agent_id: agentId,
        subscription_id: subscriptionId,
        endpoint: `router/${agentId}`,
        method: "POST",
        parameters: request.parameters,
        request_timestamp: new Date().toISOString(),
        response_timestamp: new Date().toISOString(),
        http_status: publisherResponse.status_code,
        response_time_ms: publisherResponse.response_time_ms,
        is_free_trial: preAuth.call_type === "free_trial",
        charged_amount_usd: preAuth.call_type === "paid" ? preAuth.cost_usd : 0,
        payment_id:
          preAuth.call_type === "paid" ? `payment_${Date.now()}` : undefined,
        user_agent: "API Router v1.0",
        ip_address: "127.0.0.1", // Would be extracted from request in production
      };

      await db.logApiCall(apiCallData);
      return apiCallData.id;
    } catch (error) {
      console.error("API call logging error:", error);
      return `call_error_${Date.now()}`;
    }
  }

  // Main router method that orchestrates the entire flow
  async routeRequest(
    apiKey: string,
    agentId: string,
    request: RouterRequest
  ): Promise<RouterResponse> {
    const requestId = this.generateRequestId();
    const timestamp = new Date().toISOString();
    const logPrefix = `[ROUTER-${requestId}]`;

    console.log(`${logPrefix} 🚀 Starting API request routing:`, {
      requestId,
      agentId,
      method: request.method,
      timestamp,
      metadata: request.metadata,
      parameterKeys: Object.keys(request.parameters || {}),
    });

    try {
      // 1. Authenticate user
      console.log(`${logPrefix} Step 1: Authenticating user...`);
      const authResult = await this.authenticateUser(apiKey);

      if (!authResult.success) {
        console.error(`${logPrefix} ❌ Authentication failed:`, {
          error: authResult.error,
          apiKeyProvided: !!apiKey,
          apiKeyLength: apiKey?.length,
        });
        return {
          success: false,
          billing: {
            call_type: "paid",
            cost_usd: 0,
            free_trials_remaining: 0,
            balance_after_call: 0,
          },
          metadata: { request_id: requestId, agent_id: agentId, timestamp },
          error: {
            code: "UNAUTHORIZED",
            message: authResult.error || "Authentication failed",
          },
        };
      }

      const user = authResult.user!;
      console.log(`${logPrefix} ✅ User authenticated:`, {
        userId: user.id,
        userWallet: user.wallet_address,
        isApproved: user.is_approved,
      });

      // 2. Validate subscription
      console.log(`${logPrefix} Step 2: Validating subscription...`);
      const subResult = await this.validateSubscription(user.id, agentId);

      if (!subResult.success) {
        console.error(`${logPrefix} ❌ Subscription validation failed:`, {
          userId: user.id,
          agentId,
          error: subResult.error,
        });
        return {
          success: false,
          billing: {
            call_type: "paid",
            cost_usd: 0,
            free_trials_remaining: 0,
            balance_after_call: 0,
          },
          metadata: { request_id: requestId, agent_id: agentId, timestamp },
          error: {
            code: "SUBSCRIPTION_REQUIRED",
            message: subResult.error || "Subscription required",
          },
        };
      }

      const subscription = subResult.subscription!;
      console.log(`${logPrefix} ✅ Subscription validated:`, {
        subscriptionId: subscription.id,
        status: subscription.status,
        freeTrialsRemaining: subscription.free_trials_remaining,
      });

      // 3. Pre-authorize the call
      console.log(`${logPrefix} Step 3: Pre-authorizing call...`);
      const preAuth = await this.preAuthorizeCall(
        user.id,
        agentId,
        subscription
      );

      if (!preAuth.authorized) {
        console.error(`${logPrefix} ❌ Pre-authorization failed:`, {
          callType: preAuth.call_type,
          costUsd: preAuth.cost_usd,
          freeTrialsRemaining: preAuth.free_trials_remaining,
          balanceAfter: preAuth.balance_after_call,
          error: preAuth.error,
        });
        return {
          success: false,
          billing: {
            call_type: preAuth.call_type,
            cost_usd: preAuth.cost_usd,
            free_trials_remaining: preAuth.free_trials_remaining,
            balance_after_call: preAuth.balance_after_call,
          },
          metadata: { request_id: requestId, agent_id: agentId, timestamp },
          error: preAuth.error,
        };
      }

      console.log(`${logPrefix} ✅ Pre-authorization successful:`, {
        callType: preAuth.call_type,
        costUsd: preAuth.cost_usd,
        crossChainRequired: preAuth.crossChainRequired,
        paymentDetails: preAuth.paymentDetails,
      });

      // 4. Get agent details
      console.log(`${logPrefix} Step 4: Loading agent details...`);
      const agents = await db.getAgents();
      const agent = agents.find((a) => a.id === agentId);

      if (!agent) {
        console.error(`${logPrefix} ❌ Agent not found:`, { agentId });
        return {
          success: false,
          billing: {
            call_type: preAuth.call_type,
            cost_usd: preAuth.cost_usd,
            free_trials_remaining: preAuth.free_trials_remaining,
            balance_after_call: preAuth.balance_after_call,
          },
          metadata: { request_id: requestId, agent_id: agentId, timestamp },
          error: { code: "AGENT_NOT_FOUND", message: "Agent not found" },
        };
      }

      console.log(`${logPrefix} ✅ Agent loaded:`, {
        agentName: agent.name,
        publisherEndpoint: agent.api_endpoint,
        pricePerCall: agent.price_per_call_usd,
        paymentPreferences: agent.payment_preferences,
      });

      // 5. Forward request to publisher API
      console.log(
        `${logPrefix} Step 5: Forwarding request to publisher API...`
      );
      const forwardResult = await this.forwardRequest(agent, request);

      console.log(`${logPrefix} Publisher API response:`, {
        success: forwardResult.success,
        statusCode: forwardResult.status_code,
        responseTimeMs: forwardResult.response_time_ms,
        error: forwardResult.error,
      });

      if (!forwardResult.success) {
        console.error(`${logPrefix} ❌ Publisher API call failed:`, {
          statusCode: forwardResult.status_code,
          responseTime: forwardResult.response_time_ms,
          error: forwardResult.error,
        });
        return {
          success: false,
          billing: {
            call_type: preAuth.call_type,
            cost_usd: preAuth.cost_usd,
            free_trials_remaining: preAuth.free_trials_remaining,
            balance_after_call: preAuth.balance_after_call,
          },
          metadata: { request_id: requestId, agent_id: agentId, timestamp },
          error: {
            code: "API_CALL_FAILED",
            message: forwardResult.error || "API call failed",
          },
        };
      }

      // 6. Log the API call
      console.log(`${logPrefix} Step 6: Logging API call...`);
      const apiCallId = await this.logApiCall(
        user.id,
        agentId,
        subscription.id,
        request,
        forwardResult.response,
        preAuth,
        {
          status_code: forwardResult.status_code,
          response_time_ms: forwardResult.response_time_ms,
        }
      );

      console.log(`${logPrefix} ✅ API call logged:`, { apiCallId });

      // 7. Process billing (only for successful calls)
      const isSuccessfulCall =
        forwardResult.status_code >= 200 && forwardResult.status_code < 300;

      if (isSuccessfulCall) {
        console.log(
          `${logPrefix} Step 7: Processing billing for successful call...`
        );
        await this.processBilling(
          user.id,
          agentId,
          subscription.id,
          preAuth,
          apiCallId
        );
        console.log(`${logPrefix} ✅ Billing processed successfully`);
      } else {
        console.log(
          `${logPrefix} Step 7: Skipping billing for failed call (status: ${forwardResult.status_code})`
        );
      }

      // 8. Return successful response
      const finalCostUsd =
        isSuccessfulCall && preAuth.call_type === "paid" ? preAuth.cost_usd : 0;

      console.log(`${logPrefix} 🎉 Request completed successfully:`, {
        requestId,
        agentId,
        statusCode: forwardResult.status_code,
        responseTime: forwardResult.response_time_ms,
        callType: preAuth.call_type,
        finalCostUsd,
        billingProcessed: isSuccessfulCall,
      });

      return {
        success: true,
        data: {
          response: forwardResult.response,
          publisher_response: {
            status_code: forwardResult.status_code,
            response_time_ms: forwardResult.response_time_ms,
          },
        },
        billing: {
          call_type: preAuth.call_type,
          cost_usd: finalCostUsd,
          free_trials_remaining:
            preAuth.call_type === "free_trial"
              ? preAuth.free_trials_remaining
              : subscription!.free_trials_remaining,
          balance_after_call: preAuth.balance_after_call,
        },
        metadata: { request_id: requestId, agent_id: agentId, timestamp },
      };
    } catch (error) {
      console.error(`${logPrefix} 💥 Router error:`, {
        error: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : undefined,
        requestId,
        agentId,
        timestamp,
      });
      return {
        success: false,
        billing: {
          call_type: "paid",
          cost_usd: 0,
          free_trials_remaining: 0,
          balance_after_call: 0,
        },
        metadata: { request_id: requestId, agent_id: agentId, timestamp },
        error: { code: "INTERNAL_ERROR", message: "Internal server error" },
      };
    }
  }
}

// Export singleton instance
export const apiRouter = new APIRouter();
