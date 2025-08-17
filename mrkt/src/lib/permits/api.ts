"use client";

import { UserPermit } from "./types";

// Convert BigInt fields to strings for API storage
function serializePermitForApi(permit: UserPermit): UserPermit {
  return {
    ...permit,
    amount: permit.amount.toString(),
    nonce: permit.nonce.toString(),
    deadline: permit.deadline.toString(),
  } as UserPermit;
}

// Convert string fields back to BigInt from API
function deserializePermitFromApi(permit: UserPermit): UserPermit {
  return {
    ...permit,
    amount: BigInt(permit.amount),
    nonce: BigInt(permit.nonce),
    deadline: BigInt(permit.deadline),
  };
}

export async function savePermitToApi(permit: UserPermit): Promise<UserPermit> {
  const serializedPermit = serializePermitForApi(permit);

  const response = await fetch("/api/permits", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(serializedPermit),
  });

  if (!response.ok) {
    throw new Error(`Failed to save permit: ${response.statusText}`);
  }

  const result = await response.json();
  if (!result.success) {
    throw new Error(result.error || "Failed to save permit");
  }

  return deserializePermitFromApi(result.permit);
}

export async function getPermitsFromApi(
  userAddress: string
): Promise<UserPermit[]> {
  const response = await fetch(
    `/api/permits?userAddress=${encodeURIComponent(userAddress)}`
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch permits: ${response.statusText}`);
  }

  const result = await response.json();
  if (!result.success) {
    throw new Error(result.error || "Failed to fetch permits");
  }

  return result.permits.map(deserializePermitFromApi);
}

export async function updatePermitStatusApi(
  permitId: string,
  status: "active" | "expired" | "revoked"
): Promise<UserPermit> {
  const response = await fetch(`/api/permits/${permitId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ status }),
  });

  if (!response.ok) {
    throw new Error(`Failed to update permit: ${response.statusText}`);
  }

  const result = await response.json();
  if (!result.success) {
    throw new Error(result.error || "Failed to update permit");
  }

  return deserializePermitFromApi(result.permit);
}
