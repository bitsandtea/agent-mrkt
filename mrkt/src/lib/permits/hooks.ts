"use client";

import { DEFAULT_DECIMALS, getTokenAddress } from "@/config/tokens";
import { useCallback, useEffect, useState } from "react";
import {
  getAddress,
  parseUnits,
  PublicClient,
  recoverTypedDataAddress,
} from "viem";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { UserPermit } from "./types";

const ADMIN_ADDRESS = process.env.NEXT_PUBLIC_ADMIN_ADDRESS as `0x${string}`;

// Helper function to get token domain info
function getTokenDomainInfo(token: string, chainId: number) {
  let tokenName = "USD Coin"; // Default for USDC
  let version = "1";

  if (token === "PYUSD") {
    tokenName = "PayPal USD";
  }
  if (token === "USDC" && chainId === 11155111) {
    version = "2"; // USDC on ETH Sepolia uses version 2
  }

  return { tokenName, version };
}

export function useSubscriptionPermit(
  token: string,
  chainId: number,
  costPerCall: number = 2.0
) {
  const { data: walletClient } = useWalletClient();
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const [isLoading, setIsLoading] = useState(false);

  const contractAddress = getTokenAddress(token, chainId) as `0x${string}`;
  const spenderAddress = ADMIN_ADDRESS;

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

        // Fetch the current nonce from the contract
        let currentNonce = BigInt(0);
        if (publicClient && contractAddress) {
          try {
            currentNonce = await fetchCurrentNonce(
              address,
              token,
              chainId,
              publicClient
            );
          } catch (error) {
            console.warn("Failed to fetch current nonce, using 0:", error);
          }
        }

        // Get token name and version for EIP-712 domain
        const { tokenName, version } = getTokenDomainInfo(token, chainId);

        // EIP-712 domain for permit
        const domain = {
          name: tokenName,
          version,
          chainId,
          verifyingContract: getAddress(contractAddress),
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
          owner: getAddress(address),
          spender: getAddress(spenderAddress),
          value: amount,
          nonce: currentNonce,
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
          nonce: currentNonce,
          deadline,
          signature: { r, s, v },
          status: "active",
          createdAt: Date.now(),
          expiresAt: Number(deadline) * 1000,
          maxCalls: Math.floor(maxAmountUSD / costPerCall),
          callsUsed: 0,
          costPerCall,
        };

        // Store permit using API
        try {
          const response = await fetch("/api/permits", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              ...userPermit,
              amount: userPermit.amount.toString(),
              nonce: userPermit.nonce.toString(),
              deadline: userPermit.deadline.toString(),
            }),
          });

          if (!response.ok) {
            throw new Error(`Failed to save permit: ${response.statusText}`);
          }

          const result = await response.json();
          if (!result.success) {
            throw new Error(result.error || "Failed to save permit");
          }
        } catch (error) {
          console.error("Failed to save permit to database:", error);
          // Continue anyway, the permit was created successfully
        }

        return { r, s, v, nonce: currentNonce };
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
      publicClient,
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

export function usePermitValidation() {
  const publicClient = usePublicClient();

  const validatePermitWithClient = async (
    permit: UserPermit,
    currentNonce?: bigint
  ): Promise<boolean> => {
    // If no current nonce provided, fetch it from the contract
    let nonce = currentNonce;
    if (!nonce && publicClient) {
      try {
        const contractAddress = getTokenAddress(permit.token, permit.chainId);
        if (contractAddress) {
          nonce = await publicClient.readContract({
            address: getAddress(contractAddress),
            abi: [
              {
                inputs: [{ name: "owner", type: "address" }],
                name: "nonces",
                outputs: [{ name: "", type: "uint256" }],
                stateMutability: "view",
                type: "function",
              },
            ],
            functionName: "nonces",
            args: [getAddress(permit.userAddress)],
          });
        }
      } catch (error) {
        console.error("Failed to fetch nonce:", error);
        nonce = BigInt(0); // Default to 0 if we can't fetch
      }
    }

    return validatePermit(permit, nonce || BigInt(0), publicClient);
  };

  return {
    validatePermit: validatePermitWithClient,
    publicClient,
  };
}

export function usePermitRevocation() {
  const { data: walletClient } = useWalletClient();
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const [isRevoking, setIsRevoking] = useState(false);

  const revokePermitOnChain = async (permit: UserPermit) => {
    if (!walletClient || !address) {
      throw new Error("Wallet not connected");
    }

    const contractAddress = getTokenAddress(permit.token, permit.chainId);
    if (!contractAddress) {
      throw new Error("Contract address not found");
    }

    setIsRevoking(true);
    try {
      // Fetch the current nonce from the contract
      let currentNonce = BigInt(0);
      if (publicClient && contractAddress) {
        try {
          currentNonce = await fetchCurrentNonce(
            address,
            permit.token,
            permit.chainId,
            publicClient
          );
        } catch (error) {
          console.warn("Failed to fetch current nonce, using 0:", error);
        }
      }

      // Get token name and version for EIP-712 domain
      const { tokenName, version } = getTokenDomainInfo(
        permit.token,
        permit.chainId
      );

      // Create a new deadline (short-lived for revocation)
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 60 * 60); // 1 hour

      // EIP-712 domain for permit
      const domain = {
        name: tokenName,
        version,
        chainId: permit.chainId,
        verifyingContract: getAddress(contractAddress),
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

      // Permit message with amount 0 for revocation
      const message = {
        owner: getAddress(address),
        spender: getAddress(permit.spenderAddress),
        value: BigInt(0), // Set to 0 for revocation
        nonce: currentNonce,
        deadline,
      };

      // Sign the revocation permit using wallet client
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

      // Create revocation permit object
      const revocationPermit: UserPermit = {
        id: `${address}-${permit.token}-${permit.chainId}-revoke-${Date.now()}`,
        userAddress: address,
        token: permit.token,
        chainId: permit.chainId,
        spenderAddress: permit.spenderAddress,
        amount: BigInt(0), // 0 amount for revocation
        nonce: currentNonce,
        deadline,
        signature: { r, s, v },
        status: "active",
        createdAt: Date.now(),
        expiresAt: Number(deadline) * 1000,
        maxCalls: 0,
        callsUsed: 0,
        costPerCall: 0,
      };

      // Send the revocation permit to the admin for execution
      try {
        const response = await fetch("/api/permits/revoke", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            originalPermitId: permit.id,
            revocationPermit: {
              ...revocationPermit,
              amount: revocationPermit.amount.toString(),
              nonce: revocationPermit.nonce.toString(),
              deadline: revocationPermit.deadline.toString(),
            },
          }),
        });

        if (!response.ok) {
          throw new Error(
            `Failed to submit revocation permit: ${response.statusText}`
          );
        }

        const result = await response.json();
        if (!result.success) {
          throw new Error(result.error || "Failed to submit revocation permit");
        }

        return result;
      } catch (error) {
        console.error("Failed to submit revocation permit:", error);
        throw error;
      }
    } catch (error) {
      console.error("Failed to create revocation permit:", error);
      throw error;
    } finally {
      setIsRevoking(false);
    }
  };

  return {
    revokePermitOnChain,
    isRevoking,
    isReady: !!walletClient && !!address,
  };
}

export async function validatePermit(
  permit: UserPermit,
  currentNonce: bigint,
  publicClient?: PublicClient
): Promise<boolean> {
  // Check if permit is expired
  if (BigInt(Math.floor(Date.now() / 1000)) > permit.deadline) {
    return false;
  }

  // Check if nonce is still valid
  if (permit.nonce < currentNonce) {
    return false;
  }

  // Verify the permit signature on-chain
  try {
    const contractAddress = getTokenAddress(permit.token, permit.chainId);
    if (!contractAddress) {
      return false;
    }

    // Get token name and version for EIP-712 domain
    const { tokenName, version } = getTokenDomainInfo(
      permit.token,
      permit.chainId
    );

    // EIP-712 domain for permit
    const domain = {
      name: tokenName,
      version,
      chainId: permit.chainId,
      verifyingContract: getAddress(contractAddress),
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
      owner: getAddress(permit.userAddress),
      spender: getAddress(permit.spenderAddress),
      value: permit.amount,
      nonce: permit.nonce,
      deadline: permit.deadline,
    };

    // Reconstruct the signature
    const signature = `${permit.signature.r}${permit.signature.s.slice(
      2
    )}${permit.signature.v.toString(16).padStart(2, "0")}` as `0x${string}`;

    // Recover the address from the signature
    const recoveredAddress = await recoverTypedDataAddress({
      domain,
      types,
      primaryType: "Permit",
      message,
      signature,
    });

    // Verify the recovered address matches the permit owner
    const isValidSignature =
      getAddress(recoveredAddress) === getAddress(permit.userAddress);

    if (!isValidSignature) {
      console.error("Invalid permit signature");
      return false;
    }

    // If we have a public client, also verify the nonce on-chain
    if (publicClient) {
      try {
        const onChainNonce = await publicClient.readContract({
          address: getAddress(contractAddress),
          abi: [
            {
              inputs: [{ name: "owner", type: "address" }],
              name: "nonces",
              outputs: [{ name: "", type: "uint256" }],
              stateMutability: "view",
              type: "function",
            },
          ],
          functionName: "nonces",
          args: [getAddress(permit.userAddress)],
        });

        // Check if the permit nonce matches the current on-chain nonce
        if (permit.nonce !== onChainNonce) {
          console.error("Permit nonce mismatch", {
            permitNonce: permit.nonce,
            onChainNonce,
          });
          return false;
        }
      } catch (error) {
        console.error("Failed to verify nonce on-chain:", error);
        // Don't fail validation if we can't check nonce - signature verification is sufficient
      }
    }

    return true;
  } catch (error) {
    console.error("Error validating permit signature:", error);
    return false;
  }
}

export async function fetchCurrentNonce(
  userAddress: string,
  token: string,
  chainId: number,
  publicClient: PublicClient
): Promise<bigint> {
  try {
    const contractAddress = getTokenAddress(token, chainId);
    if (!contractAddress || !publicClient) {
      throw new Error("Contract address or public client not available");
    }

    const nonce = await publicClient.readContract({
      address: getAddress(contractAddress),
      abi: [
        {
          inputs: [{ name: "owner", type: "address" }],
          name: "nonces",
          outputs: [{ name: "", type: "uint256" }],
          stateMutability: "view",
          type: "function",
        },
      ],
      functionName: "nonces",
      args: [getAddress(userAddress)],
    });

    return nonce;
  } catch (error) {
    console.error("Failed to fetch nonce:", error);
    return BigInt(0);
  }
}

export function useUserPermits() {
  const { address } = useAccount();
  const [permits, setPermits] = useState<UserPermit[]>([]);
  const { revokePermitOnChain, isRevoking } = usePermitRevocation();

  const fetchUserPermits = useCallback(async () => {
    if (!address) return [];

    try {
      // Get permits from API
      const response = await fetch(
        `/api/permits?userAddress=${encodeURIComponent(address)}`
      );
      if (!response.ok) {
        throw new Error(`Failed to fetch permits: ${response.statusText}`);
      }

      const result = await response.json();
      if (!result.success) {
        throw new Error(result.error || "Failed to fetch permits");
      }

      // Convert string fields back to BigInt
      const userPermits = result.permits.map(
        (
          permit: UserPermit & {
            amount: string;
            nonce: string;
            deadline: string;
          }
        ) => ({
          ...permit,
          amount: BigInt(permit.amount),
          nonce: BigInt(permit.nonce),
          deadline: BigInt(permit.deadline),
        })
      );

      // Update status based on expiration
      const updatedPermits = userPermits.map((permit: UserPermit) => ({
        ...permit,
        status: Date.now() > permit.expiresAt ? "expired" : permit.status,
      })) as UserPermit[];

      setPermits(updatedPermits);
      return updatedPermits;
    } catch (error) {
      console.error("Failed to fetch user permits:", error);
      setPermits([]);
      return [];
    }
  }, [address]);

  // Fetch permits when address changes
  useEffect(() => {
    if (address) {
      fetchUserPermits();
    } else {
      setPermits([]);
    }
  }, [address, fetchUserPermits]);

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
    async (permitId: string) => {
      try {
        const response = await fetch(`/api/permits/${permitId}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ status: "revoked" }),
        });

        if (!response.ok) {
          throw new Error(`Failed to revoke permit: ${response.statusText}`);
        }

        const result = await response.json();
        if (!result.success) {
          throw new Error(result.error || "Failed to revoke permit");
        }

        // Refresh permits after successful revocation
        fetchUserPermits();
      } catch (error) {
        console.error("Failed to revoke permit:", error);
        throw error;
      }
    },
    [fetchUserPermits]
  );

  const revokePermitWithOnChain = useCallback(
    async (permit: UserPermit) => {
      try {
        // First revoke on-chain (sets allowance to 0)
        await revokePermitOnChain(permit);

        // Then refresh permits to reflect the change
        fetchUserPermits();
      } catch (error) {
        console.error("Failed to revoke permit on-chain:", error);
        throw error;
      }
    },
    [revokePermitOnChain, fetchUserPermits]
  );

  return {
    permits,
    fetchUserPermits,
    getPermitForTokenAndChain,
    revokePermit,
    revokePermitWithOnChain,
    isRevoking,
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

export function useAgentSubscription() {
  const { permits, fetchUserPermits } = useUserPermits();

  const getAgentPermits = useCallback(() => {
    // Return all active permits since users can pay with any supported token
    return permits.filter((permit) => permit.status === "active");
  }, [permits]);

  const hasActiveSubscription = useCallback(() => {
    return getAgentPermits().length > 0;
  }, [getAgentPermits]);

  const getSubscriptionSummary = useCallback(() => {
    const agentPermits = getAgentPermits();
    if (agentPermits.length === 0) return null;

    const totalValue = agentPermits.reduce(
      (sum, permit) =>
        sum + Number(permit.amount) / Math.pow(10, DEFAULT_DECIMALS),
      0
    );
    const totalCalls = agentPermits.reduce(
      (sum, permit) => sum + permit.maxCalls,
      0
    );
    const usedCalls = agentPermits.reduce(
      (sum, permit) => sum + permit.callsUsed,
      0
    );

    return {
      permits: agentPermits,
      totalValue,
      totalCalls,
      usedCalls,
      remainingCalls: totalCalls - usedCalls,
    };
  }, [getAgentPermits]);

  return {
    hasActiveSubscription: hasActiveSubscription(),
    subscriptionSummary: getSubscriptionSummary(),
    refreshSubscription: fetchUserPermits,
  };
}
