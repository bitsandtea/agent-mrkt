import * as db from "./db";
import { getPermitsByUser } from "./db";
import {
  findBestPermitForPayment,
  getTargetChainId,
  needsCrossChainTransfer,
  processCCTPPayment,
} from "./router/payment";
import {
  validateOnChainBalance,
  validatePermit2Allowance,
} from "./router/validation";

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

export class APIRouter {
  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
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

    try {
      const agents = await db.getAgents();
      const agent = agents.find((a) => a.id === agentId);
      const user = await db.getUserById(userId);

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

      // Check if this qualifies for free trial
      if (freeTrialsRemaining > 0) {
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
      const userPermits = await getPermitsByUser(user.wallet_address);
      const activePermits = userPermits.filter(
        (permit) => permit.status === "active"
      );

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
      const bestPermit = findBestPermitForPayment(
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

      // Validate actual on-chain balance
      const balanceCheck = await validateOnChainBalance(
        user.wallet_address,
        bestPermit.token,
        bestPermit.chainId,
        costUsd
      );

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

      // Validate Permit2 allowance
      const adminAddress = process.env.NEXT_PUBLIC_ADMIN_ADDRESS;
      if (!adminAddress) {
        return {
          authorized: false,
          call_type: "paid",
          cost_usd: costUsd,
          cost_tokens: costUsd,
          free_trials_remaining: 0,
          balance_after_call: balanceCheck.actualBalance,
          error: {
            code: "CONFIGURATION_ERROR",
            message: "Admin address not configured",
          },
        };
      }

      const permit2Check = await validatePermit2Allowance(
        user.wallet_address,
        bestPermit.token,
        bestPermit.chainId,
        adminAddress,
        costUsd
      );

      if (!permit2Check.hasAllowance) {
        console.error(`${logPrefix} ❌ Insufficient Permit2 allowance:`, {
          token: bestPermit.token,
          required: costUsd,
          allowed: permit2Check.actualAllowance,
          shortfall: costUsd - permit2Check.actualAllowance,
          expiration: permit2Check.expiration,
          nonce: permit2Check.nonce,
        });
        return {
          authorized: false,
          call_type: "paid",
          cost_usd: costUsd,
          cost_tokens: costUsd,
          free_trials_remaining: 0,
          balance_after_call: balanceCheck.actualBalance,
          error: {
            code: "INSUFFICIENT_PERMIT2_ALLOWANCE",
            message: `Insufficient ${bestPermit.token} Permit2 allowance. Required: ${costUsd}, Allowed: ${permit2Check.actualAllowance}`,
            details: permit2Check.error
              ? { permit2Error: permit2Check.error }
              : undefined,
          },
        };
      }

      // Check if cross-chain transfer is needed
      const needsCrossChain = needsCrossChainTransfer(bestPermit, agent);
      const targetChainId = getTargetChainId(
        agent.payment_preferences.payout_network
      );

      // Log CCTP cross-chain transfer details if needed
      if (needsCrossChain) {
        console.log(`${logPrefix} 🔄 CCTP cross-chain transfer required:`, {
          sourceChain: bestPermit.chainId,
          targetChain: targetChainId,
          sourceToken: bestPermit.token,
          targetToken: agent.payment_preferences.payout_token,
          amount: costUsd,
        });
      }

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
        await processCCTPPayment(userId, agentId, preAuth.cost_usd, apiCallId);
        await db.updateSubscriptionUsage(subscriptionId, false);
      }

      return { success: true };
    } catch (error) {
      console.error("Billing processing error:", error);
      return { success: false, error: "Billing processing failed" };
    }
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

    try {
      // 1. Authenticate user
      const authResult = await this.authenticateUser(apiKey);

      if (!authResult.success) {
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

      // 2. Validate subscription
      const subResult = await this.validateSubscription(user.id, agentId);

      if (!subResult.success) {
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

      // 3. Pre-authorize the call
      const preAuth = await this.preAuthorizeCall(
        user.id,
        agentId,
        subscription
      );

      if (!preAuth.authorized) {
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

      // 4. Get agent details
      const agents = await db.getAgents();
      const agent = agents.find((a) => a.id === agentId);

      if (!agent) {
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

      // 5. Forward request to publisher API
      const forwardResult = await this.forwardRequest(agent, request);

      if (!forwardResult.success) {
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

      // 7. Process billing (only for successful calls)
      const isSuccessfulCall =
        forwardResult.status_code >= 200 && forwardResult.status_code < 300;

      if (isSuccessfulCall) {
        await this.processBilling(
          user.id,
          agentId,
          subscription.id,
          preAuth,
          apiCallId
        );
      }

      // 8. Return successful response
      const finalCostUsd =
        isSuccessfulCall && preAuth.call_type === "paid" ? preAuth.cost_usd : 0;

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
