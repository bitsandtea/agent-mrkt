import { apiRouter, RouterRequest } from "@/lib/router";
import { NextRequest, NextResponse } from "next/server";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  try {
    // Extract API key from Authorization header
    const authHeader = request.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "UNAUTHORIZED",
            message: "Missing or invalid Authorization header",
          },
        },
        { status: 401 }
      );
    }

    const apiKey = authHeader.substring(7); // Remove 'Bearer ' prefix
    const { agentId } = await params;

    // Parse request body
    let routerRequest: RouterRequest;
    try {
      const body = await request.json();
      routerRequest = {
        method: body.method,
        parameters: body.parameters || {},
        metadata: body.metadata || {},
      };

      // Validate required fields
      if (!routerRequest.method) {
        return NextResponse.json(
          {
            success: false,
            error: {
              code: "INVALID_PARAMETERS",
              message: "Method is required",
            },
          },
          { status: 400 }
        );
      }
    } catch {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "INVALID_JSON",
            message: "Invalid JSON in request body",
          },
        },
        { status: 400 }
      );
    }

    // Add request ID header if provided
    const requestId = request.headers.get("x-request-id");
    if (requestId) {
      routerRequest.metadata = {
        ...routerRequest.metadata,
        source: routerRequest.metadata?.source || "api_client",
      };
    }

    // Route the request through our API router
    const result = await apiRouter.routeRequest(apiKey, agentId, routerRequest);

    // Return appropriate HTTP status based on result
    const statusCode = result.success
      ? 200
      : getErrorStatusCode(result.error?.code);

    return NextResponse.json(result, { status: statusCode });
  } catch (error) {
    console.error("Router endpoint error:", error);
    return NextResponse.json(
      {
        success: false,
        billing: {
          call_type: "paid",
          cost_usd: 0,
          free_trials_remaining: 0,
          balance_after_call: 0,
        },
        metadata: {
          request_id: `error_${Date.now()}`,
          agent_id: (await params).agentId,
          timestamp: new Date().toISOString(),
        },
        error: {
          code: "INTERNAL_ERROR",
          message: "Internal server error",
        },
      },
      { status: 500 }
    );
  }
}

// Map error codes to HTTP status codes
function getErrorStatusCode(errorCode?: string): number {
  switch (errorCode) {
    case "UNAUTHORIZED":
      return 401;
    case "SUBSCRIPTION_REQUIRED":
      return 403;
    case "AGENT_NOT_FOUND":
      return 404;
    case "INSUFFICIENT_BALANCE":
      return 402; // Payment Required
    case "INVALID_PARAMETERS":
    case "INVALID_JSON":
      return 400;
    case "RATE_LIMITED":
      return 429;
    case "API_CALL_FAILED":
      return 502; // Bad Gateway
    default:
      return 500;
  }
}

// Handle OPTIONS for CORS
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type, Authorization, X-Request-ID",
    },
  });
}
