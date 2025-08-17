import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, sepolia } from "viem/chains";
import {
  getDestinationDomain,
  getMessageTransmitterContractAddress,
  getTokenAddress,
  getTokenMessengerContractAddress,
  RPC_URLS,
  SupportedChainId,
} from "../../config/tokens";
import { CCTPTransactionDetails } from "../permits/types";
import {
  AttestationStatus,
  getAttestation,
  pollAttestationPromise,
} from "./attestationService";
import { addressToBytes32, parseAmount } from "./utils";

export interface CCTPTransferParams {
  sourceChainId: SupportedChainId;
  targetChainId: SupportedChainId;
  amount: string; // Amount in USD (e.g., "10.50")
  token: string; // Token symbol (e.g., "USDC")
  recipient: string; // Recipient address on target chain
  sender: string; // Sender address on source chain
}

export interface CCTPTransferResult {
  success: boolean;
  transactionHash?: string;
  messageHash?: string;
  error?: string;
}

export interface DepositForBurnParams {
  amount: bigint;
  destinationDomain: number;
  mintRecipient: string;
  burnToken: string;
  transferType?: "fast" | "standard";
}

export interface ReceiveMessageParams {
  message: `0x${string}`;
  attestation: `0x${string}`;
}

// Token Messenger ABI for depositForBurn
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

// Message Transmitter ABI for receiveMessage
const MESSAGE_TRANSMITTER_ABI = [
  {
    inputs: [
      { name: "message", type: "bytes" },
      { name: "attestation", type: "bytes" },
    ],
    name: "receiveMessage",
    outputs: [{ name: "success", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

/**
 * CCTP Service for handling cross-chain transfers
 */
export class CCTPService {
  /**
   * Get viem chain configuration for supported chain ID
   */
  private static getViemChain(chainId: SupportedChainId) {
    switch (chainId) {
      case SupportedChainId.ETH_SEPOLIA:
        return sepolia;
      case SupportedChainId.BASE_SEPOLIA:
        return base;
      default:
        throw new Error(`Unsupported chain ID: ${chainId}`);
    }
  }

  /**
   * Create public client for chain
   */
  private static createPublicClient(chainId: SupportedChainId) {
    const chain = this.getViemChain(chainId);
    const rpcUrl = RPC_URLS[chainId as keyof typeof RPC_URLS];

    if (!rpcUrl) {
      throw new Error(`No RPC URL configured for chain ID: ${chainId}`);
    }

    return createPublicClient({
      chain,
      transport: http(rpcUrl),
    });
  }

  /**
   * Create wallet client for chain (for backend operations)
   */
  private static createWalletClient(
    chainId: SupportedChainId,
    privateKey: string
  ) {
    const chain = this.getViemChain(chainId);
    const rpcUrl = RPC_URLS[chainId as keyof typeof RPC_URLS];

    if (!rpcUrl) {
      throw new Error(`No RPC URL configured for chain ID: ${chainId}`);
    }

    // Ensure private key has 0x prefix and is properly formatted
    const formattedPrivateKey = privateKey.startsWith("0x")
      ? (privateKey as `0x${string}`)
      : (`0x${privateKey}` as `0x${string}`);

    const account = privateKeyToAccount(formattedPrivateKey);

    return createWalletClient({
      chain,
      transport: http(rpcUrl),
      account,
    });
  }

  /**
   * Execute depositForBurn transaction on source chain
   */
  static async depositForBurn(
    chainId: SupportedChainId,
    params: DepositForBurnParams,
    privateKey?: string
  ): Promise<{ transactionHash: string; messageHash?: string }> {
    const logPrefix = `[CCTP-SERVICE-DEPOSIT]`;

    console.log(`${logPrefix} Starting depositForBurn on chain ${chainId}:`, {
      chainId,
      amount: params.amount.toString(),
      destinationDomain: params.destinationDomain,
      mintRecipient: params.mintRecipient,
      burnToken: params.burnToken,
      transferType: params.transferType || "standard",
      hasPrivateKey: !!privateKey,
      timestamp: new Date().toISOString(),
    });

    try {
      const {
        amount,
        destinationDomain,
        mintRecipient,
        burnToken,
        transferType = "standard",
      } = params;

      // CCTP v2 parameters
      const finalityThreshold = transferType === "fast" ? 1000 : 2000;
      const maxFee = (amount * BigInt(5)) / BigInt(1000); // Max fee is 0.5% of amount
      const hookData =
        "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`;

      const contractAddress = getTokenMessengerContractAddress(chainId);

      console.log(`${logPrefix} CCTP v2 parameters calculated:`, {
        finalityThreshold,
        maxFee: maxFee.toString(),
        hookData,
        contractAddress,
        mintRecipientBytes32: addressToBytes32(mintRecipient),
      });

      if (privateKey) {
        // Server-side execution with private key
        console.log(
          `${logPrefix} Creating wallet client for server-side execution`
        );
        const walletClient = this.createWalletClient(chainId, privateKey);

        console.log(`${logPrefix} Executing depositForBurn contract call:`, {
          contractAddress,
          functionName: "depositForBurn",
          args: {
            amount: amount.toString(),
            destinationDomain,
            mintRecipient: addressToBytes32(mintRecipient),
            burnToken,
            hookData,
            maxFee: maxFee.toString(),
            finalityThreshold,
          },
        });

        const hash = await walletClient.writeContract({
          address: contractAddress as `0x${string}`,
          abi: TOKEN_MESSENGER_ABI,
          functionName: "depositForBurn",
          args: [
            amount,
            destinationDomain,
            addressToBytes32(mintRecipient),
            burnToken as `0x${string}`,
            hookData,
            maxFee,
            finalityThreshold,
          ],
        });

        console.log(`${logPrefix} ✅ DepositForBurn transaction submitted:`, {
          transactionHash: hash,
          chainId,
          realTransaction: true,
        });

        return { transactionHash: hash };
      } else {
        // Client-side execution - return encoded data for frontend
        console.log(
          `${logPrefix} Encoding depositForBurn data for client-side execution`
        );

        const data = encodeFunctionData({
          abi: TOKEN_MESSENGER_ABI,
          functionName: "depositForBurn",
          args: [
            amount,
            destinationDomain,
            addressToBytes32(mintRecipient),
            burnToken as `0x${string}`,
            hookData,
            maxFee,
            finalityThreshold,
          ],
        });

        console.log(
          `${logPrefix} ✅ DepositForBurn data encoded for frontend:`,
          {
            encodedData: data,
            contractAddress,
            chainId,
          }
        );

        return {
          transactionHash: data, // Return encoded data for frontend to execute
        };
      }
    } catch (error) {
      console.error(`${logPrefix} DepositForBurn execution failed:`, {
        error: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : undefined,
        chainId,
        params,
        hasPrivateKey: !!privateKey,
      });

      throw new Error(
        `DepositForBurn failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Execute receiveMessage transaction on destination chain
   */
  static async receiveMessage(
    chainId: SupportedChainId,
    params: ReceiveMessageParams,
    privateKey?: string
  ): Promise<{ transactionHash: string }> {
    const logPrefix = `[CCTP-SERVICE-RECEIVE]`;

    console.log(`${logPrefix} Starting receiveMessage on chain ${chainId}:`, {
      chainId,
      messageLength: params.message.length,
      attestationLength: params.attestation.length,
      hasPrivateKey: !!privateKey,
      timestamp: new Date().toISOString(),
    });

    try {
      const { message, attestation } = params;
      const contractAddress = getMessageTransmitterContractAddress(chainId);

      console.log(`${logPrefix} Message Transmitter contract details:`, {
        contractAddress,
        messagePreview: `${message.slice(0, 20)}...${message.slice(-10)}`,
        attestationPreview: `${attestation.slice(0, 20)}...${attestation.slice(
          -10
        )}`,
      });

      if (privateKey) {
        // Server-side execution with private key
        console.log(
          `${logPrefix} Creating wallet client for server-side execution`
        );
        const walletClient = this.createWalletClient(chainId, privateKey);

        console.log(`${logPrefix} Executing receiveMessage contract call:`, {
          contractAddress,
          functionName: "receiveMessage",
          messageLength: message.length,
          attestationLength: attestation.length,
        });

        const hash = await walletClient.writeContract({
          address: contractAddress as `0x${string}`,
          abi: MESSAGE_TRANSMITTER_ABI,
          functionName: "receiveMessage",
          args: [message, attestation],
        });

        console.log(`${logPrefix} ✅ ReceiveMessage transaction submitted:`, {
          transactionHash: hash,
          chainId,
          realTransaction: true,
        });

        return { transactionHash: hash };
      } else {
        // Client-side execution - return encoded data for frontend
        console.log(
          `${logPrefix} Encoding receiveMessage data for client-side execution`
        );

        const data = encodeFunctionData({
          abi: MESSAGE_TRANSMITTER_ABI,
          functionName: "receiveMessage",
          args: [message, attestation],
        });

        console.log(
          `${logPrefix} ✅ ReceiveMessage data encoded for frontend:`,
          {
            encodedData: `${data.slice(0, 20)}...${data.slice(-10)}`,
            contractAddress,
            chainId,
          }
        );

        return {
          transactionHash: data, // Return encoded data for frontend to execute
        };
      }
    } catch (error) {
      console.error(`${logPrefix} ReceiveMessage execution failed:`, {
        error: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : undefined,
        chainId,
        messageLength: params.message.length,
        attestationLength: params.attestation.length,
        hasPrivateKey: !!privateKey,
      });

      throw new Error(
        `ReceiveMessage failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Get contract addresses for a chain
   */
  static getContractAddresses(chainId: SupportedChainId) {
    return {
      tokenMessenger: getTokenMessengerContractAddress(chainId),
      messageTransmitter: getMessageTransmitterContractAddress(chainId),
      usdc: getTokenAddress("USDC", chainId),
    };
  }
  /**
   * Validate if a cross-chain transfer is possible
   */
  static validateTransfer(params: CCTPTransferParams): {
    valid: boolean;
    error?: string;
  } {
    const logPrefix = `[CCTP-SERVICE-VALIDATION]`;
    const { sourceChainId, targetChainId, token, amount } = params;

    console.log(`${logPrefix} Validating CCTP transfer parameters:`, {
      sourceChainId,
      targetChainId,
      token,
      amount,
      sender: params.sender,
      recipient: params.recipient,
      timestamp: new Date().toISOString(),
    });

    // CCTP v2 only supports USDC for cross-chain transfers
    if (token !== "USDC") {
      console.log(
        `${logPrefix} ❌ Token validation failed: Only USDC supported for cross-chain`,
        {
          providedToken: token,
          supportedTokens: ["USDC"],
        }
      );
      return {
        valid: false,
        error: `CCTP v2 only supports USDC for cross-chain transfers. ${token} can only be used for same-chain payments.`,
      };
    }

    // Check if chains are supported
    const sourceDomain = getDestinationDomain(sourceChainId);
    const targetDomain = getDestinationDomain(targetChainId);

    console.log(`${logPrefix} Chain domain validation:`, {
      sourceChainId,
      sourceDomain,
      targetChainId,
      targetDomain,
    });

    if (sourceDomain === null || targetDomain === null) {
      console.log(
        `${logPrefix} ❌ Chain validation failed: Unsupported chain for CCTP`,
        {
          sourceChainId,
          sourceDomain,
          targetChainId,
          targetDomain,
        }
      );
      return { valid: false, error: "Unsupported chain for CCTP transfer" };
    }

    // Check if token is supported on both chains
    const sourceTokenAddress = getTokenAddress(token, sourceChainId);
    const targetTokenAddress = getTokenAddress(token, targetChainId);

    console.log(`${logPrefix} Token address validation:`, {
      token,
      sourceChainId,
      sourceTokenAddress,
      targetChainId,
      targetTokenAddress,
    });

    if (!sourceTokenAddress || !targetTokenAddress) {
      console.log(`${logPrefix} ❌ Token address validation failed:`, {
        token,
        sourceTokenAddress,
        targetTokenAddress,
      });
      return {
        valid: false,
        error: `${token} not supported on one or both chains`,
      };
    }

    // Validate amount
    try {
      const amountBigInt = parseAmount(amount, 6); // USDC has 6 decimals
      console.log(`${logPrefix} Amount validation:`, {
        originalAmount: amount,
        parsedAmount: amountBigInt.toString(),
        decimals: 6,
      });

      if (amountBigInt <= BigInt(0)) {
        console.log(
          `${logPrefix} ❌ Amount validation failed: Amount must be greater than 0`,
          {
            amount,
            parsedAmount: amountBigInt.toString(),
          }
        );
        return { valid: false, error: "Amount must be greater than 0" };
      }
    } catch (error) {
      console.log(`${logPrefix} ❌ Amount parsing failed:`, {
        amount,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      return { valid: false, error: "Invalid amount format" };
    }

    console.log(`${logPrefix} ✅ All validations passed - transfer is valid`);
    return { valid: true };
  }

  /**
   * Get transfer details for a cross-chain payment
   */
  static getTransferDetails(
    params: CCTPTransferParams
  ): CCTPTransactionDetails | null {
    const validation = this.validateTransfer(params);
    if (!validation.valid) {
      return null;
    }

    const { sourceChainId, targetChainId, amount, token, recipient, sender } =
      params;

    return {
      messageHash: "", // Will be set after transaction
      message: "", // Will be set after transaction
      sourceChainId,
      targetChainId,
      amount: parseAmount(amount, 6).toString(),
      token,
      sender,
      recipient,
      nonce: Date.now().toString(), // Temporary nonce
    };
  }

  /**
   * Check if cross-chain transfer is needed
   */
  static needsCrossChainTransfer(
    userChainId: number,
    publisherChainId: number,
    userToken: string,
    publisherToken: string
  ): boolean {
    return userChainId !== publisherChainId || userToken !== publisherToken;
  }

  /**
   * Get the best route for a cross-chain transfer
   */
  static getBestRoute(
    sourceChainId: SupportedChainId,
    targetChainId: SupportedChainId,
    token: string
  ): { route: "direct" | "unsupported"; estimatedTime: number } {
    const validation = this.validateTransfer({
      sourceChainId,
      targetChainId,
      token,
      amount: "1", // Dummy amount for validation
      recipient: "0x0000000000000000000000000000000000000000",
      sender: "0x0000000000000000000000000000000000000000",
    });

    if (!validation.valid) {
      return { route: "unsupported", estimatedTime: 0 };
    }

    // CCTP typically takes 10-20 minutes
    return { route: "direct", estimatedTime: 15 * 60 * 1000 }; // 15 minutes in ms
  }

  /**
   * Monitor attestation status for a message hash
   */
  static async waitForAttestation(
    messageHash: string,
    maxWaitTimeMs: number = 20 * 60 * 1000 // 20 minutes
  ): Promise<{ success: boolean; attestation?: string; error?: string }> {
    const logPrefix = `[CCTP-SERVICE-ATTESTATION]`;
    const maxAttempts = Math.floor(maxWaitTimeMs / 2000);

    console.log(`${logPrefix} Starting attestation polling:`, {
      messageHash,
      maxWaitTimeMs,
      maxAttempts,
      intervalMs: 2000,
      estimatedMaxTime: `${Math.floor(maxWaitTimeMs / 60000)} minutes`,
      timestamp: new Date().toISOString(),
    });

    try {
      const attestation = await pollAttestationPromise(
        messageHash,
        maxAttempts, // Convert to attempts (2s intervals)
        2000
      );

      console.log(
        `${logPrefix} ✅ Attestation polling completed successfully:`,
        {
          messageHash,
          attestationLength: attestation.length,
          attestationPreview: `${attestation.slice(
            0,
            50
          )}...${attestation.slice(-20)}`,
          totalWaitTime: `< ${Math.floor(maxWaitTimeMs / 60000)} minutes`,
        }
      );

      return { success: true, attestation };
    } catch (error) {
      console.error(`${logPrefix} Attestation polling failed:`, {
        messageHash,
        error: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : undefined,
        maxWaitTimeMs,
        maxAttempts,
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : "Attestation failed",
      };
    }
  }

  /**
   * Get current attestation status
   */
  static async getAttestationStatus(messageHash: string): Promise<{
    status: AttestationStatus;
    attestation?: string;
    error?: string;
  }> {
    try {
      const result = await getAttestation(messageHash);
      if (!result) {
        return {
          status: AttestationStatus.pending_confirmations,
          error: "Failed to fetch attestation",
        };
      }

      return {
        status: result.status,
        attestation: result.message || undefined,
      };
    } catch (error) {
      return {
        status: AttestationStatus.pending_confirmations,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Calculate estimated fees for a cross-chain transfer
   */
  static estimateTransferFees(
    sourceChainId: SupportedChainId,
    targetChainId: SupportedChainId,
    _amount: string
  ): { sourceFee: string; targetFee: string; totalFee: string } {
    // CCTP doesn't charge protocol fees, only gas fees
    // These are rough estimates and should be calculated dynamically
    // Note: _amount parameter not used in current implementation but kept for future fee calculations
    const sourceGasFee =
      sourceChainId === SupportedChainId.ETH_SEPOLIA ? "0.01" : "0.001"; // ETH vs Base
    const targetGasFee =
      targetChainId === SupportedChainId.ETH_SEPOLIA ? "0.01" : "0.001";

    const totalFee = (
      parseFloat(sourceGasFee) + parseFloat(targetGasFee)
    ).toString();

    return {
      sourceFee: sourceGasFee,
      targetFee: targetGasFee,
      totalFee,
    };
  }
}
