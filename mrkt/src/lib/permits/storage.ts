"use client";

import { UserPermit } from "./types";

const PERMITS_STORAGE_KEY = "user_permits";

export function savePermit(permit: UserPermit): void {
  if (typeof window === "undefined") return;

  const permits = getStoredPermits();
  const existingIndex = permits.findIndex(
    (p) =>
      p.id === permit.id ||
      (p.userAddress === permit.userAddress &&
        p.token === permit.token &&
        p.chainId === permit.chainId)
  );

  if (existingIndex >= 0) {
    permits[existingIndex] = permit;
  } else {
    permits.push(permit);
  }

  localStorage.setItem(PERMITS_STORAGE_KEY, JSON.stringify(permits));
}

export function getStoredPermits(): UserPermit[] {
  if (typeof window === "undefined") return [];

  try {
    const stored = localStorage.getItem(PERMITS_STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

export function getUserPermits(userAddress: string): UserPermit[] {
  return getStoredPermits().filter(
    (permit) => permit.userAddress.toLowerCase() === userAddress.toLowerCase()
  );
}

export function getPermitForTokenChain(
  userAddress: string,
  token: string,
  chainId: number
): UserPermit | null {
  const permits = getUserPermits(userAddress);
  return (
    permits.find(
      (permit) => permit.token === token && permit.chainId === chainId
    ) || null
  );
}

export function revokePermit(permitId: string): void {
  if (typeof window === "undefined") return;

  const permits = getStoredPermits();
  const permitIndex = permits.findIndex((p) => p.id === permitId);

  if (permitIndex >= 0) {
    permits[permitIndex].status = "revoked";
    localStorage.setItem(PERMITS_STORAGE_KEY, JSON.stringify(permits));
  }
}

export function clearExpiredPermits(): void {
  if (typeof window === "undefined") return;

  const permits = getStoredPermits();
  const now = Math.floor(Date.now() / 1000);

  const validPermits = permits.map((permit) => {
    if (permit.expiresAt < now && permit.status === "active") {
      return { ...permit, status: "expired" as const };
    }
    return permit;
  });

  localStorage.setItem(PERMITS_STORAGE_KEY, JSON.stringify(validPermits));
}
