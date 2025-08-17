import { getAgentById, getUserById } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const agent = await getAgentById(id);

    if (!agent) {
      return NextResponse.json(
        { success: false, error: "Agent not found" },
        { status: 404 }
      );
    }

    // Get publisher info
    const publisher = await getUserById(agent.publisher_id);

    return NextResponse.json({
      success: true,
      agent: {
        ...agent,
        publisher: publisher
          ? {
              username: publisher.username,
              wallet_info: publisher.wallet_info,
            }
          : null,
      },
    });
  } catch (error) {
    console.error("Error fetching agent:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
