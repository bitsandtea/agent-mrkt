import { useCallback } from "react";
import { getContract } from "viem";
import { usePublicClient, useWalletClient } from "wagmi";
import {
  getMessageTransmitterContractAddress,
  SupportedChainId,
} from "../config/tokens";

// Message Transmitter ABI - minimal interface for receiveMessage
const MESSAGE_TRANSMITTER_ABI = [
  {
    inputs: [
      { name: "message", type: "bytes" },
      { name: "signature", type: "bytes" },
    ],
    name: "receiveMessage",
    outputs: [{ name: "success", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "message", type: "bytes" }],
    name: "usedNonces",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

/**
 * Hook for interacting with the Message Transmitter contract
 * @param chainId The chain ID to use for the contract
 */
export const useMessageTransmitter = (chainId: SupportedChainId) => {
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();

  const contractAddress = getMessageTransmitterContractAddress(chainId);

  /**
   * Receive and process a cross-chain message
   * @param message The message bytes from the source chain
   * @param signature The attestation signature from Circle
   * @returns Transaction hash
   */
  const receiveMessage = useCallback(
    async (message: `0x${string}`, signature: `0x${string}`) => {
      if (!walletClient || !publicClient) {
        throw new Error("Wallet not connected");
      }

      const contract = getContract({
        address: contractAddress as `0x${string}`,
        abi: MESSAGE_TRANSMITTER_ABI,
        client: { public: publicClient, wallet: walletClient },
      });

      const hash = await contract.write.receiveMessage([message, signature]);

      return hash;
    },
    [contractAddress, walletClient, publicClient]
  );

  /**
   * Check if a message has already been used/processed
   * @param message The message bytes to check
   * @returns Whether the message has been used
   */
  const isMessageUsed = useCallback(
    async (message: `0x${string}`): Promise<boolean> => {
      if (!publicClient) {
        throw new Error("Public client not available");
      }

      const contract = getContract({
        address: contractAddress as `0x${string}`,
        abi: MESSAGE_TRANSMITTER_ABI,
        client: publicClient,
      });

      const nonce = await contract.read.usedNonces([message]);
      return nonce > 0n;
    },
    [contractAddress, publicClient]
  );

  /**
   * Simulate receiveMessage transaction to estimate gas
   */
  const simulateReceiveMessage = useCallback(
    async (message: `0x${string}`, signature: `0x${string}`) => {
      if (!walletClient || !publicClient) {
        throw new Error("Wallet not connected");
      }

      const contract = getContract({
        address: contractAddress as `0x${string}`,
        abi: MESSAGE_TRANSMITTER_ABI,
        client: { public: publicClient, wallet: walletClient },
      });

      return await contract.simulate.receiveMessage([message, signature]);
    },
    [contractAddress, walletClient, publicClient]
  );

  return {
    receiveMessage,
    isMessageUsed,
    simulateReceiveMessage,
    contractAddress,
  };
};
