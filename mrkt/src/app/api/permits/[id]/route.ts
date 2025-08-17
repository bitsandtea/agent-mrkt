import { getPermitById, updatePermitStatus } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const permit = await getPermitById(id);

    if (!permit) {
      return NextResponse.json(
        { success: false, error: "Permit not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      permit,
    });
  } catch (error) {
    console.error("Error fetching permit:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { status } = await request.json();

    if (!status || !["active", "expired", "revoked"].includes(status)) {
      return NextResponse.json(
        { success: false, error: "Invalid status" },
        { status: 400 }
      );
    }

    const permit = await updatePermitStatus(id, status);

    if (!permit) {
      return NextResponse.json(
        { success: false, error: "Permit not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      permit,
    });
  } catch (error) {
    console.error("Error updating permit:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
