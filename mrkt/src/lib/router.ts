import * as db from "./db";

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

  // Pre-authorization check for billing
  async preAuthorizeCall(
    userId: string,
    agentId: string,
    subscription: db.Subscription
  ): Promise<PreAuthorizationResult> {
    try {
      const agents = await db.getAgents();
      const agent = agents.find((a) => a.id === agentId);

      if (!agent) {
        return {
          authorized: false,
          call_type: "paid",
          cost_usd: 0,
          cost_tokens: 0,
          free_trials_remaining: 0,
          balance_after_call: 0,
          error: { code: "AGENT_NOT_FOUND", message: "Agent not found" },
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
          balance_after_call: 0, // Will be calculated from actual balance
        };
      }

      // For paid calls, we would check balance and Permit2 allowance here
      // For MVP, we'll simulate this check
      const simulatedBalance = 20.0; // This would come from blockchain

      if (simulatedBalance < costUsd) {
        return {
          authorized: false,
          call_type: "paid",
          cost_usd: costUsd,
          cost_tokens: costUsd, // 1:1 for stablecoins
          free_trials_remaining: 0,
          balance_after_call: simulatedBalance,
          error: {
            code: "INSUFFICIENT_BALANCE",
            message: "Insufficient balance for this operation",
            details: {
              required: costUsd.toString(),
              available: simulatedBalance.toString(),
            },
          },
        };
      }

      return {
        authorized: true,
        call_type: "paid",
        cost_usd: costUsd,
        cost_tokens: costUsd,
        free_trials_remaining: 0,
        balance_after_call: simulatedBalance - costUsd,
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
      // For MVP, we'll simulate the API call to the publisher
      // In production, this would make actual HTTP requests to agent.api_endpoint

      // Simulate processing time
      await new Promise((resolve) =>
        setTimeout(resolve, 100 + Math.random() * 200)
      );

      // Mock response based on the request
      const mockResponse = this.generateMockResponse(request);
      const responseTime = Date.now() - startTime;

      return {
        success: true,
        response: mockResponse,
        status_code: 200,
        response_time_ms: responseTime,
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;
      console.error("Request forwarding error:", error);

      return {
        success: false,
        status_code: 500,
        response_time_ms: responseTime,
        error: "Failed to forward request to publisher API",
      };
    }
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
        // For paid calls, we would process payment through smart contract here
        await db.updateSubscriptionUsage(subscriptionId, false);

        // Create payment record
        const paymentData = {
          id: `payment_${Date.now()}`,
          user_id: userId,
          agent_id: agentId,
          subscription_id: subscriptionId,
          amount_usd: preAuth.cost_usd,
          amount_tokens: preAuth.cost_tokens,
          token: "USDC", // Default for MVP
          network: "arbitrum", // Default for MVP
          transaction_hash: `0x${Math.random().toString(16).substr(2, 64)}`, // Mock hash
          status: "completed",
          payment_type: "api_call",
          api_call_id: apiCallId,
          timestamp: new Date().toISOString(),
          block_number: Math.floor(Math.random() * 1000000),
          gas_used: 50000,
          gas_price: "20000000000",
        };

        await db.createPayment(paymentData);
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
    // requestId: string // Unused for now but kept for future logging enhancements
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
        },
        requestId
      );

      // 7. Process billing (only for successful calls)
      if (forwardResult.status_code >= 200 && forwardResult.status_code < 300) {
        await this.processBilling(
          user.id,
          agentId,
          subscription.id,
          preAuth,
          apiCallId
        );
      }

      // 8. Return successful response
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
          cost_usd:
            forwardResult.status_code >= 200 && forwardResult.status_code < 300
              ? preAuth.call_type === "paid"
                ? preAuth.cost_usd
                : 0
              : 0,
          free_trials_remaining:
            preAuth.call_type === "free_trial"
              ? preAuth.free_trials_remaining
              : subscription!.free_trials_remaining,
          balance_after_call: preAuth.balance_after_call,
        },
        metadata: { request_id: requestId, agent_id: agentId, timestamp },
      };
    } catch (error) {
      console.error("Router error:", error);
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
