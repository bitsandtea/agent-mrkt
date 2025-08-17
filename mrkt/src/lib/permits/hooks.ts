"use client";

import { DEFAULT_DECIMALS, getTokenAddress } from "@/config/tokens";
import {
  getAddress,
  parseUnits,
  PublicClient,
  recoverTypedDataAddress,
} from "viem";
import { usePublicClient, useWalletClient } from "wagmi";
import { UserPermit } from "./types";

const ADMIN_ADDRESS = process.env.NEXT_PUBLIC_ADMIN_ADDRESS as `0x${string}`;

export function useSubscriptionPermit(
  token: string,
  chainId: number,
  costPerCall: number = 2.0
) {
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();
  const contractAddress = getTokenAddress(token, chainId) as `0x${string}`;

  const createSubscriptionPermit = async (maxAmount: number) => {
    if (!walletClient?.account?.address || !contractAddress) {
      throw new Error("Wallet or contract not ready");
    }

    const amount = parseUnits(maxAmount.toString(), DEFAULT_DECIMALS);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60); // 30 days

    // Fetch the current nonce from the contract
    let currentNonce = BigInt(0);
    if (publicClient && contractAddress) {
      try {
        currentNonce = await fetchCurrentNonce(
          walletClient.account.address,
          token,
          chainId,
          publicClient
        );
      } catch (error) {
        console.warn("Failed to fetch current nonce, using 0:", error);
      }
    }

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
      owner: getAddress(walletClient.account.address),
      spender: getAddress(ADMIN_ADDRESS),
      value: amount,
      nonce: currentNonce,
      deadline,
    };

    // Sign the permit using wallet client
    const signature = await walletClient.signTypedData({
      account: walletClient.account.address,
      domain,
      types,
      primaryType: "Permit",
      message,
    });

    // Parse the signature into r, s, v components
    const r = signature.slice(0, 66) as `0x${string}`;
    const s = `0x${signature.slice(66, 130)}` as `0x${string}`;
    const v = parseInt(signature.slice(130, 132), 16);

    // Return both the signature and the nonce for storage
    return {
      r,
      s,
      v,
      nonce: currentNonce,
    };
  };

  return {
    createSubscriptionPermit,
    signature: null, // We don't have a signature until permit is created
    error: null,
    maxCalls: 0, // Will be calculated when permit is created
    isReady: !!walletClient?.account?.address && !!contractAddress,
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

    // Get token name from contract (for domain)
    let tokenName = "USD Coin"; // Default for USDC
    if (permit.token === "PYUSD") {
      tokenName = "PayPal USD";
    }

    // Determine permit version based on chain and token
    let version = "1";
    if (permit.token === "USDC" && permit.chainId === 11155111) {
      version = "2"; // USDC on ETH Sepolia uses version 2
    }

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
