import { UserPermit } from "@/hooks/usePermits";

export function savePermit(permit: any) {
  // Get existing permits from localStorage
  const existingPermits = JSON.parse(
    localStorage.getItem("userPermits") || "[]"
  );

  // Add new permit
  existingPermits.push(permit);

  // Save back to localStorage
  localStorage.setItem("userPermits", JSON.stringify(existingPermits));
}

export function getPermits(): UserPermit[] {
  return JSON.parse(localStorage.getItem("userPermits") || "[]");
}

export function getActivePermitsForUser(userAddress: string): UserPermit[] {
  const permits = getPermits();
  return permits.filter(
    (permit) =>
      permit.userAddress.toLowerCase() === userAddress.toLowerCase() &&
      permit.status === "active" &&
      Date.now() < permit.expiresAt
  );
}
