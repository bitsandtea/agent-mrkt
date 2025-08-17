import { getAllAgents, getUserById } from "@/lib/db";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const agents = await getAllAgents();

    // Get publisher info for each agent
    const agentsWithPublishers = await Promise.all(
      agents.map(async (agent) => {
        const publisher = await getUserById(agent.publisher_id);
        return {
          ...agent,
          publisher: publisher
            ? {
                username: publisher.username,
                wallet_info: publisher.wallet_info,
              }
            : null,
        };
      })
    );

    return NextResponse.json({
      success: true,
      agents: agentsWithPublishers,
    });
  } catch (error) {
    console.error("Error fetching agents:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
