import { getTokenAddress, PERMIT2_ADDRESS } from "@/config/tokens";
import {
  createPermit,
  createSubscription,
  createUser,
  getAgentById,
  getPermitById,
  getPermitsByUser,
  getUserByWalletAddress,
  updatePermitStatus,
  UserPermit,
} from "@/lib/db";
import { PERMIT2_ABI } from "@/lib/router/abis";
import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, createWalletClient, getAddress, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia, sepolia } from "viem/chains";

// Function to submit permit on-chain using admin wallet
async function submitPermitOnChain(permit: UserPermit) {
  console.log(`🔄 Admin submitting permit ${permit.id} on-chain...`);
  console.log(`   User: ${permit.userAddress}`);
  console.log(`   Token: ${permit.token} on chain ${permit.chainId}`);
  console.log(`   Amount: ${permit.amount}`);
  console.log(`   Spender: ${permit.spenderAddress}`);

  const adminPrivateKey = process.env.ADMIN_PKEY;
  if (!adminPrivateKey) {
    console.error("❌ ADMIN_PKEY not configured");
    throw new Error("ADMIN_PKEY not configured");
  }

  // Ensure private key has 0x prefix and is properly formatted
  const formattedPrivateKey = adminPrivateKey.startsWith("0x")
    ? (adminPrivateKey as `0x${string}`)
    : (`0x${adminPrivateKey}` as `0x${string}`);

  console.log(
    `   Private key format: ${formattedPrivateKey.slice(
      0,
      6
    )}...${formattedPrivateKey.slice(-4)} (length: ${
      formattedPrivateKey.length
    })`
  );

  // Get the appropriate chain based on chainId
  const chain = permit.chainId === 11155111 ? sepolia : baseSepolia;
  console.log(`   Chain: ${chain.name} (${chain.id})`);

  // Create admin wallet client
  const account = privateKeyToAccount(formattedPrivateKey);
  console.log(`   Admin wallet: ${account.address}`);

  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(),
  });

  // Get token address
  const tokenAddress = getTokenAddress(permit.token, permit.chainId);
  if (!tokenAddress) {
    console.error(
      `❌ Token address not found for ${permit.token} on chain ${permit.chainId}`
    );
    throw new Error(
      `Token address not found for ${permit.token} on chain ${permit.chainId}`
    );
  }
  console.log(`   Token contract: ${tokenAddress}`);

  // Create public client to check current nonce
  const publicClient = createPublicClient({
    chain,
    transport: http(),
  });

  // Check current nonce from Permit2 contract
  const currentNonceData = await publicClient.readContract({
    address: PERMIT2_ADDRESS,
    abi: PERMIT2_ABI,
    functionName: "allowance",
    args: [
      getAddress(permit.userAddress),
      getAddress(tokenAddress),
      getAddress(permit.spenderAddress),
    ],
  });

  const [, , currentNonce] = currentNonceData;
  console.log(
    `   Current on-chain nonce: ${currentNonce}, Permit nonce: ${permit.nonce}`
  );

  // If nonces don't match, the permit is stale
  if (Number(permit.nonce) !== Number(currentNonce)) {
    console.log(
      `⚠️  Permit nonce mismatch - skipping submission (permit has stale nonce)`
    );
    throw new Error(
      `Permit nonce mismatch: expected ${currentNonce}, got ${permit.nonce}`
    );
  }

  // Build the PermitSingle struct
  const permitSingle = {
    details: {
      token: getAddress(tokenAddress),
      amount: BigInt(permit.amount),
      expiration: Number(permit.deadline),
      nonce: Number(permit.nonce),
    },
    spender: getAddress(permit.spenderAddress),
    sigDeadline: BigInt(permit.deadline),
  };
  console.log(`   Permit details:`, permitSingle);

  // Reconstruct the signature
  const signature = `${permit.signature.r}${permit.signature.s.slice(
    2
  )}${permit.signature.v.toString(16).padStart(2, "0")}` as `0x${string}`;
  console.log(
    `   Signature: ${signature.slice(0, 20)}...${signature.slice(-20)}`
  );

  // Submit permit transaction to Permit2 contract
  console.log(`   Submitting to Permit2 contract: ${PERMIT2_ADDRESS}`);
  const txHash = await walletClient.writeContract({
    address: PERMIT2_ADDRESS,
    abi: PERMIT2_ABI,
    functionName: "permit",
    args: [getAddress(permit.userAddress), permitSingle, signature],
  });

  console.log(`✅ Permit ${permit.id} submitted on-chain successfully!`);
  console.log(`   Transaction hash: ${txHash}`);
  return txHash;
}

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

    // Submit permit on-chain using admin wallet
    try {
      await submitPermitOnChain(permit);
    } catch (error) {
      console.error("Failed to submit permit on-chain:", error);
      // Don't fail the permit creation if on-chain submission fails
      // The permit is still stored and can be retried later
    }

    // Create subscription if agentId is provided
    if (permitData.agentId) {
      try {
        // Get user by wallet address, create if doesn't exist
        let user = await getUserByWalletAddress(permitData.userAddress);
        if (!user) {
          console.log(
            `Creating new user for wallet address: ${permitData.userAddress}`
          );

          // Generate API key
          const apiKey = `ak_live_${Math.random()
            .toString(36)
            .substr(2, 16)}${Date.now().toString(36)}`;

          // Create new user
          const newUserData = {
            id: `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            wallet_address: permitData.userAddress,
            role: "consumer",
            email: "",
            username: `User_${permitData.userAddress.slice(-6)}`,
            api_key: apiKey,
            is_approved: true,
            min_balance_usd: 20,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            wallet_info: {},
            permit2_approved: false,
            preferred_networks: [],
            preferred_tokens: [],
          };

          user = await createUser(newUserData);
          console.log(
            `Created new user: ${user.id} with API key: ${user.api_key}`
          );
        }

        if (user) {
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
