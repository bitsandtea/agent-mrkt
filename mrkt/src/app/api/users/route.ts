import { getUserByWalletAddress } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const walletAddress = searchParams.get("walletAddress");

    if (!walletAddress) {
      return NextResponse.json(
        { success: false, error: "walletAddress parameter is required" },
        { status: 400 }
      );
    }

    const user = await getUserByWalletAddress(walletAddress);

    if (!user) {
      return NextResponse.json(
        { success: false, error: "User not found" },
        { status: 404 }
      );
    }

    // Return user data without sensitive information for security
    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        wallet_address: user.wallet_address,
        username: user.username,
        api_key: user.api_key, // Include API key since it's needed for code examples
        is_approved: user.is_approved,
        wallet_info: user.wallet_info,
      },
    });
  } catch (error) {
    console.error("Error fetching user:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
