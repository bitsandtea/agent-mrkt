import { getPermitsFromApi, savePermitToApi } from "@/lib/permits/api";
import { UserPermit } from "@/lib/permits/types";

export async function savePermit(permit: UserPermit): Promise<UserPermit> {
  try {
    return await savePermitToApi(permit);
  } catch (error) {
    console.error("Failed to save permit:", error);
    throw error;
  }
}

export async function getPermits(): Promise<UserPermit[]> {
  // This function would need a userAddress parameter in a real implementation
  // For now, return empty array as this function is deprecated
  return [];
}

export async function getActivePermitsForUser(
  userAddress: string
): Promise<UserPermit[]> {
  try {
    const permits = await getPermitsFromApi(userAddress);
    return permits.filter(
      (permit) => permit.status === "active" && Date.now() < permit.expiresAt
    );
  } catch (error) {
    console.error("Failed to get active permits for user:", error);
    return [];
  }
}
