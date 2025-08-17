import { updatePermitStatus } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const { originalPermitId, revocationPermit } = await request.json();

    // Validate required fields
    if (!originalPermitId || !revocationPermit) {
      return NextResponse.json(
        { success: false, error: "Missing required fields" },
        { status: 400 }
      );
    }

    // Validate revocation permit structure
    if (
      !revocationPermit.userAddress ||
      !revocationPermit.token ||
      !revocationPermit.chainId ||
      !revocationPermit.signature ||
      revocationPermit.amount !== "0"
    ) {
      return NextResponse.json(
        { success: false, error: "Invalid revocation permit" },
        { status: 400 }
      );
    }

    // TODO: Validate the revocation permit signature
    // This would involve:
    // 1. Reconstructing the EIP-712 message
    // 2. Verifying the signature matches the user address
    // 3. Checking the nonce is current
    // 4. Verifying the amount is 0

    // For now, we'll trust the frontend validation and proceed
    // In production, you should implement full signature validation here

    // Update the original permit status to revoked
    const updatedPermit = await updatePermitStatus(originalPermitId, "revoked");

    if (!updatedPermit) {
      return NextResponse.json(
        { success: false, error: "Failed to revoke permit" },
        { status: 500 }
      );
    }

    // TODO: Execute the revocation permit on-chain
    // This would involve:
    // 1. Using the admin wallet to call the token contract's permit function
    // 2. With the revocation permit signature and amount=0
    // 3. This effectively sets the allowance to 0 on-chain

    // For now, we'll just mark it as revoked in the database
    // In production, you should implement the on-chain execution here

    return NextResponse.json({
      success: true,
      message: "Permit revoked successfully",
      permitId: originalPermitId,
    });
  } catch (error) {
    console.error("Error revoking permit:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
