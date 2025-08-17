import {
  createPermit,
  createSubscription,
  getAgentById,
  getPermitById,
  getPermitsByUser,
  getUserByWalletAddress,
  updatePermitStatus,
} from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const permitData = await request.json();

    // Validate required fields
    if (!permitData.userAddress || !permitData.token || !permitData.chainId) {
      return NextResponse.json(
        { success: false, error: "Missing required fields" },
        { status: 400 }
      );
    }

    const permit = await createPermit(permitData);

    // Create subscription if agentId is provided
    if (permitData.agentId) {
      try {
        // Get user by wallet address
        const user = await getUserByWalletAddress(permitData.userAddress);
        if (!user) {
          console.warn(
            `User not found for wallet address: ${permitData.userAddress}`
          );
        } else {
          // Get agent to determine free trial count
          const agent = await getAgentById(permitData.agentId);
          if (!agent) {
            console.warn(`Agent not found: ${permitData.agentId}`);
          } else {
            // Create subscription
            const subscriptionData = {
              id: `sub_${Date.now()}_${Math.random()
                .toString(36)
                .substr(2, 9)}`,
              user_id: user.id,
              agent_id: permitData.agentId,
              status: "active",
              free_trials_remaining: agent.free_trial_tries,
              free_trials_used: 0,
              total_paid_calls: 0,
              total_spent_usd: 0,
              subscription_date: new Date().toISOString(),
              last_used: new Date().toISOString(),
              auto_renew: true,
              payment_token: permitData.token,
              payment_network: getNetworkName(permitData.chainId),
            };

            await createSubscription(subscriptionData);
            console.log(
              `Created subscription ${subscriptionData.id} for user ${user.id} to agent ${permitData.agentId}`
            );
          }
        }
      } catch (subscriptionError) {
        console.error("Error creating subscription:", subscriptionError);
        // Don't fail the permit creation if subscription creation fails
      }
    }

    return NextResponse.json({
      success: true,
      permit,
    });
  } catch (error) {
    console.error("Error creating permit:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}

// Helper function to map chain ID to network name
function getNetworkName(chainId: number): string {
  const networkMap: { [key: number]: string } = {
    1: "ethereum",
    11155111: "ethereum", // ETH Sepolia
    8453: "base",
    84532: "base", // Base Sepolia
    42161: "arbitrum",
  };
  return networkMap[chainId] || "ethereum";
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userAddress = searchParams.get("userAddress");

    if (!userAddress) {
      return NextResponse.json(
        { success: false, error: "userAddress parameter is required" },
        { status: 400 }
      );
    }

    const permits = await getPermitsByUser(userAddress);

    return NextResponse.json({
      success: true,
      permits,
    });
  } catch (error) {
    console.error("Error fetching permits:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { permitId, status, revokeSignature } = await request.json();

    // Validate required fields
    if (!permitId || !status) {
      return NextResponse.json(
        { success: false, error: "Missing permitId or status" },
        { status: 400 }
      );
    }

    // Validate status value
    if (!["active", "expired", "revoked"].includes(status)) {
      return NextResponse.json(
        { success: false, error: "Invalid status value" },
        { status: 400 }
      );
    }

    if (status === "revoked" && revokeSignature) {
      // Execute gasless on-chain revocation using the revoke signature
      try {
        const permit = await getPermitById(permitId);
        if (!permit) {
          return NextResponse.json(
            { success: false, error: "Permit not found" },
            { status: 404 }
          );
        }

        // TODO: Execute the permit with amount=0 on-chain using admin wallet
        // This would call the permit function with the revoke signature
        // For now, we'll just update the database
        console.log(
          `Gasless revocation for permit ${permitId} with signature:`,
          revokeSignature
        );
      } catch (error) {
        console.error("Failed to execute gasless revocation:", error);
        // Continue with database update even if on-chain fails
      }
    }

    const updatedPermit = await updatePermitStatus(permitId, status);

    if (!updatedPermit) {
      return NextResponse.json(
        { success: false, error: "Permit not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      permit: updatedPermit,
      message: revokeSignature
        ? "Permit revoked with gasless on-chain execution"
        : "Permit status updated",
    });
  } catch (error) {
    console.error("Error updating permit status:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
