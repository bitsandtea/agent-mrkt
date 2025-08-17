import { NextResponse } from "next/server";

export async function GET() {
  // Random delay between 4-8 seconds
  const delay = Math.floor(Math.random() * 4000) + 4000;

  await new Promise((resolve) => setTimeout(resolve, delay));

  return NextResponse.json({
    success: true,
    audit_url:
      "https://github.com/blocksecteam/audit-reports/blob/main/solidity/blocksec_staketogether_v1.1-signed.pdf",
  });
}

export async function POST() {
  // Random delay between 4-8 seconds
  const delay = Math.floor(Math.random() * 4000) + 4000;

  await new Promise((resolve) => setTimeout(resolve, delay));

  return NextResponse.json({
    success: true,
    audit_url:
      "https://github.com/blocksecteam/audit-reports/blob/main/solidity/blocksec_staketogether_v1.1-signed.pdf",
  });
}
