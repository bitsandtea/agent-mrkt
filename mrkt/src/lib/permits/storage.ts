"use client";

import {
  getPermitsFromApi,
  savePermitToApi,
  updatePermitStatusApi,
} from "./api";
import { UserPermit } from "./types";

export async function savePermit(permit: UserPermit): Promise<UserPermit> {
  try {
    return await savePermitToApi(permit);
  } catch (error) {
    console.error("Failed to save permit to API:", error);
    throw error;
  }
}

export async function getUserPermits(
  userAddress: string
): Promise<UserPermit[]> {
  try {
    return await getPermitsFromApi(userAddress);
  } catch (error) {
    console.error("Failed to get permits from API:", error);
    return [];
  }
}

export async function getPermitForTokenChain(
  userAddress: string,
  token: string,
  chainId: number
): Promise<UserPermit | null> {
  try {
    const permits = await getUserPermits(userAddress);
    return (
      permits.find(
        (permit) =>
          permit.token === token &&
          permit.chainId === chainId &&
          permit.status === "active"
      ) || null
    );
  } catch (error) {
    console.error("Failed to get permit for token and chain:", error);
    return null;
  }
}

export async function revokePermit(
  permitId: string
): Promise<UserPermit | null> {
  try {
    return await updatePermitStatusApi(permitId, "revoked");
  } catch (error) {
    console.error("Failed to revoke permit:", error);
    return null;
  }
}

// Legacy function for backward compatibility - now returns empty array since we use API
export function getStoredPermits(): UserPermit[] {
  return [];
}

export async function clearExpiredPermits(): Promise<void> {
  // This would need to be implemented as a server-side job or API endpoint
  // For now, we'll handle expiration checks in the getUserPermits function
  console.log("clearExpiredPermits: This should be handled server-side");
}
