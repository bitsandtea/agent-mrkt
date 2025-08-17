import { useCallback, useEffect, useState } from "react";
import { useAccount } from "wagmi";

interface User {
  id: string;
  wallet_address: string;
  username?: string;
  api_key: string;
  is_approved: boolean;
  wallet_info?: {
    ens_name?: string;
    avatar?: string;
  };
}

export function useUser() {
  const { address } = useAccount();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchUser = useCallback(async () => {
    if (!address) {
      setUser(null);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/users?walletAddress=${encodeURIComponent(address)}`
      );

      if (!response.ok) {
        if (response.status === 404) {
          // User not found is not an error, just means they haven't registered
          setUser(null);
          setError(null);
          return;
        }
        throw new Error(`Failed to fetch user: ${response.statusText}`);
      }

      const result = await response.json();
      if (!result.success) {
        throw new Error(result.error || "Failed to fetch user");
      }

      setUser(result.user);
    } catch (err) {
      console.error("Failed to fetch user:", err);
      setError(err instanceof Error ? err.message : "Failed to fetch user");
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, [address]);

  // Fetch user when address changes
  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  return {
    user,
    loading,
    error,
    refetch: fetchUser,
    apiKey: user?.api_key || null,
    isRegistered: !!user,
    isApproved: user?.is_approved || false,
  };
}
