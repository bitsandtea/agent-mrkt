import { createPermit, getPermitsByUser } from "@/lib/db";
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
