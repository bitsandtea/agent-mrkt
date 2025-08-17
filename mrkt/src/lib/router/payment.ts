import { SupportedChainId } from "../../config/tokens";
import * as db from "../db";
import { getPermitsByUser } from "../db";
import { executeCCTPTransfer } from "./transfers";

// Find the best permit for payment based on publisher preferences and balance
export function findBestPermitForPayment(
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
  const targetChainId = getTargetChainId(
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
export function getTargetChainId(network: string): number {
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

// Check if cross-chain transfer is needed
export function needsCrossChainTransfer(
  permit: db.UserPermit,
  agent: db.Agent
): boolean {
  const targetChainId = getTargetChainId(
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

// Process CCTP cross-chain payment from user to publisher
export async function processCCTPPayment(
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
    const bestPermit = findBestPermitForPayment(
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
    const targetChainId = getTargetChainId(
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
    const paymentResult = await executeCCTPTransfer({
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
