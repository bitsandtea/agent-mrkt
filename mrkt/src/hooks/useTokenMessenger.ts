import { useCallback } from "react";
import { getContract } from "viem";
import { usePublicClient, useWalletClient } from "wagmi";
import {
  DestinationDomain,
  getTokenMessengerContractAddress,
  SupportedChainId,
} from "../config/tokens";
import { addressToBytes32 } from "../lib/cctp/utils";

// Token Messenger ABI - CCTP v2 interface for depositForBurn
const TOKEN_MESSENGER_ABI = [
  {
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "destinationDomain", type: "uint32" },
      { name: "mintRecipient", type: "bytes32" },
      { name: "burnToken", type: "address" },
      { name: "hookData", type: "bytes32" },
      { name: "maxFee", type: "uint256" },
      { name: "finalityThreshold", type: "uint32" },
    ],
    name: "depositForBurn",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

/**
 * Hook for interacting with the Token Messenger contract
 * @param chainId The chain ID to use for the contract
 */
export const useTokenMessenger = (chainId: SupportedChainId) => {
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();

  const contractAddress = getTokenMessengerContractAddress(chainId);

  /**
   * Deposit tokens for burn on source chain (CCTP v2)
   * @param amount Amount to burn (in token's smallest unit)
   * @param destinationDomain Circle's destination domain ID
   * @param mintRecipient Recipient address on destination chain
   * @param burnToken Token contract address to burn
   * @param transferType Transfer speed type ("fast" or "standard")
   * @returns Transaction hash
   */
  const depositForBurn = useCallback(
    async (
      amount: bigint,
      destinationDomain: DestinationDomain,
      mintRecipient: string,
      burnToken: string,
      transferType: "fast" | "standard" = "standard"
    ) => {
      if (!walletClient || !publicClient) {
        throw new Error("Wallet not connected");
      }

      const contract = getContract({
        address: contractAddress as `0x${string}`,
        abi: TOKEN_MESSENGER_ABI,
        client: { public: publicClient, wallet: walletClient },
      });

      // CCTP v2 parameters
      const finalityThreshold = transferType === "fast" ? 1000 : 2000;
      const maxFee = (amount * BigInt(5)) / BigInt(1000); // Max fee is 0.5% of amount
      const hookData =
        "0x0000000000000000000000000000000000000000000000000000000000000000"; // Empty hook data

      const hash = await contract.write.depositForBurn([
        amount,
        destinationDomain,
        addressToBytes32(mintRecipient),
        burnToken as `0x${string}`,
        hookData as `0x${string}`,
        maxFee,
        finalityThreshold,
      ]);

      return hash;
    },
    [contractAddress, walletClient, publicClient]
  );

  /**
   * Simulate depositForBurn transaction to estimate gas (CCTP v2)
   */
  const simulateDepositForBurn = useCallback(
    async (
      amount: bigint,
      destinationDomain: DestinationDomain,
      mintRecipient: string,
      burnToken: string,
      transferType: "fast" | "standard" = "standard"
    ) => {
      if (!walletClient || !publicClient) {
        throw new Error("Wallet not connected");
      }

      const contract = getContract({
        address: contractAddress as `0x${string}`,
        abi: TOKEN_MESSENGER_ABI,
        client: { public: publicClient, wallet: walletClient },
      });

      // CCTP v2 parameters
      const finalityThreshold = transferType === "fast" ? 1000 : 2000;
      const maxFee = (amount * BigInt(5)) / BigInt(1000); // Max fee is 0.5% of amount
      const hookData =
        "0x0000000000000000000000000000000000000000000000000000000000000000"; // Empty hook data

      return await contract.simulate.depositForBurn([
        amount,
        destinationDomain,
        addressToBytes32(mintRecipient),
        burnToken as `0x${string}`,
        hookData as `0x${string}`,
        maxFee,
        finalityThreshold,
      ]);
    },
    [contractAddress, walletClient, publicClient]
  );

  return {
    depositForBurn,
    simulateDepositForBurn,
    contractAddress,
  };
};
