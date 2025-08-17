"use client";

import { DEFAULT_DECIMALS, getTokenAddress } from "@/config/tokens";
import { useCallback, useState } from "react";
import { parseUnits } from "viem";
import { useAccount, useWalletClient } from "wagmi";
// Removed wagmi-permit import - using direct implementation

export interface PermitConfig {
  token: string;
  chainId: number;
  maxAmount: bigint;
  costPerCall: number;
  maxCalls: number;
  deadline: bigint;
}

export interface UserPermit {
  id: string;
  userAddress: string;
  token: string;
  chainId: number;
  spenderAddress: string;
  amount: bigint;
  nonce: bigint;
  deadline: bigint;
  signature: {
    r: string;
    s: string;
    v: number;
  };
  status: "active" | "expired" | "revoked";
  createdAt: number;
  expiresAt: number;
  maxCalls: number;
  callsUsed: number;
  costPerCall: number;
}

export function useSubscriptionPermit(
  token: string,
  chainId: number,
  costPerCall: number = 2.0
) {
  const { data: walletClient } = useWalletClient();
  const { address } = useAccount();
  const [isLoading, setIsLoading] = useState(false);

  const contractAddress = getTokenAddress(token, chainId);
  const spenderAddress = process.env.NEXT_PUBLIC_ADMIN_ADDRESS;

  const createSubscriptionPermit = useCallback(
    async (maxAmountUSD: number) => {
      if (!walletClient || !contractAddress || !spenderAddress || !address) {
        throw new Error("Wallet or contract not ready");
      }

      setIsLoading(true);
      try {
        const amount = parseUnits(maxAmountUSD.toString(), DEFAULT_DECIMALS);
        const deadline = BigInt(
          Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60
        ); // 30 days

        // Get token name and version for EIP-712 domain
        let tokenName = "USD Coin"; // Default for USDC
        let version = "1";

        if (token === "PYUSD") {
          tokenName = "PayPal USD";
        }
        if (token === "USDC" && chainId === 11155111) {
          version = "2"; // USDC on ETH Sepolia uses version 2
        }

        // EIP-712 domain for permit
        const domain = {
          name: tokenName,
          version,
          chainId,
          verifyingContract: contractAddress as `0x${string}`,
        };

        // EIP-712 types for permit
        const types = {
          Permit: [
            { name: "owner", type: "address" },
            { name: "spender", type: "address" },
            { name: "value", type: "uint256" },
            { name: "nonce", type: "uint256" },
            { name: "deadline", type: "uint256" },
          ],
        };

        // Permit message
        const message = {
          owner: address,
          spender: spenderAddress,
          value: amount,
          nonce: BigInt(0), // Will be fetched from contract in production
          deadline,
        };

        // Sign the permit using wallet client
        const signature = await walletClient.signTypedData({
          account: address,
          domain,
          types,
          primaryType: "Permit",
          message,
        });

        // Parse the signature into r, s, v components
        const r = signature.slice(0, 66) as `0x${string}`;
        const s = `0x${signature.slice(66, 130)}` as `0x${string}`;
        const v = parseInt(signature.slice(130, 132), 16);

        // Store permit locally for quick access
        const userPermit: UserPermit = {
          id: `${address}-${token}-${chainId}-${Date.now()}`,
          userAddress: address,
          token,
          chainId,
          spenderAddress: spenderAddress,
          amount,
          nonce: BigInt(0), // Will be filled from contract
          deadline,
          signature: { r, s, v },
          status: "active",
          createdAt: Date.now(),
          expiresAt: Number(deadline) * 1000,
          maxCalls: Math.floor(maxAmountUSD / costPerCall),
          callsUsed: 0,
          costPerCall,
        };

        // Store in localStorage
        const existingPermits = JSON.parse(
          localStorage.getItem("userPermits") || "[]"
        );
        existingPermits.push(userPermit);
        localStorage.setItem("userPermits", JSON.stringify(existingPermits));

        return { r, s, v };
      } finally {
        setIsLoading(false);
      }
    },
    [
      walletClient,
      contractAddress,
      spenderAddress,
      address,
      token,
      chainId,
      costPerCall,
    ]
  );

  return {
    createSubscriptionPermit,
    signature: null, // We don't have a signature until permit is created
    error: null,
    isLoading,
    maxCalls: 0, // Will be calculated when permit is created
    isReady:
      !!walletClient && !!contractAddress && !!spenderAddress && !!address,
  };
}

export function useUserPermits() {
  const { address } = useAccount();
  const [permits, setPermits] = useState<UserPermit[]>([]);

  const fetchUserPermits = useCallback(async () => {
    if (!address) return [];

    // Get permits from localStorage
    const storedPermits = JSON.parse(
      localStorage.getItem("userPermits") || "[]"
    ) as UserPermit[];

    // Filter permits for current user
    const userPermits = storedPermits.filter(
      (permit) => permit.userAddress.toLowerCase() === address.toLowerCase()
    );

    // Update status based on expiration
    const updatedPermits = userPermits.map((permit) => ({
      ...permit,
      status: Date.now() > permit.expiresAt ? "expired" : permit.status,
    })) as UserPermit[];

    setPermits(updatedPermits);
    return updatedPermits;
  }, [address]);

  const getPermitForTokenAndChain = useCallback(
    (token: string, chainId: number) => {
      return permits.find(
        (permit) =>
          permit.token === token &&
          permit.chainId === chainId &&
          permit.status === "active"
      );
    },
    [permits]
  );

  const revokePermit = useCallback(
    (permitId: string) => {
      const storedPermits = JSON.parse(
        localStorage.getItem("userPermits") || "[]"
      ) as UserPermit[];

      const updatedPermits = storedPermits.map((permit) =>
        permit.id === permitId
          ? { ...permit, status: "revoked" as const }
          : permit
      );

      localStorage.setItem("userPermits", JSON.stringify(updatedPermits));
      fetchUserPermits();
    },
    [fetchUserPermits]
  );

  return {
    permits,
    fetchUserPermits,
    getPermitForTokenAndChain,
    revokePermit,
  };
}

export function usePermitStatus() {
  const { permits } = useUserPermits();

  const getPermitSummary = useCallback(() => {
    const activePermits = permits.filter((p) => p.status === "active");
    const totalValue = activePermits.reduce(
      (sum, permit) =>
        sum + Number(permit.amount) / Math.pow(10, DEFAULT_DECIMALS),
      0
    );
    const totalCalls = activePermits.reduce(
      (sum, permit) => sum + permit.maxCalls,
      0
    );
    const usedCalls = activePermits.reduce(
      (sum, permit) => sum + permit.callsUsed,
      0
    );

    return {
      activePermits: activePermits.length,
      totalValue,
      totalCalls,
      usedCalls,
      remainingCalls: totalCalls - usedCalls,
    };
  }, [permits]);

  return {
    permits,
    summary: getPermitSummary(),
  };
}
