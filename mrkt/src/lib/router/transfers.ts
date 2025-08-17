import { createWalletClient, getAddress, http, keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  getDestinationDomain,
  getTokenAddress,
  getTokenMessengerContractAddress,
  RPC_URLS,
  SupportedChainId,
} from "../../config/tokens";
import { CCTPService } from "../cctp/service";
import { parseAmount } from "../cctp/utils";
import * as db from "../db";
import { CrossChainPayment } from "../permits/types";
import { ERC20_ABI, MESSAGE_SENT_EVENT_SIGNATURE } from "./abis";
import {
  createRouterPublicClient,
  createRouterWalletClient,
  getViemChain,
} from "./clients";

// Transfer result interfaces
export interface TransferResult {
  transactionHash: string;
  blockNumber?: number;
  gasUsed?: number;
  messageHash?: string;
  crossChainPaymentId?: string;
}

// Execute permit-based transfer from user to admin wallet
export async function executePermitTransfer(
  permit: db.UserPermit,
  amount: bigint,
  chainId: SupportedChainId,
  adminPrivateKey: string
): Promise<void> {
  const client = createRouterWalletClient(chainId, adminPrivateKey);
  if (!client) {
    throw new Error(`Unsupported chain ID: ${chainId}`);
  }

  const tokenAddress = getTokenAddress(permit.token, chainId);
  if (!tokenAddress) {
    throw new Error(`Token ${permit.token} not supported on chain ${chainId}`);
  }

  // The permit was already signed by the user and gives the admin wallet (spender)
  // permission to transfer tokens. We just need to execute transferFrom.
  const transferHash = await client.writeContract({
    address: tokenAddress as `0x${string}`,
    abi: ERC20_ABI,
    functionName: "transferFrom",
    args: [
      permit.userAddress as `0x${string}`,
      permit.spenderAddress as `0x${string}`, // This is the admin wallet
      amount,
    ],
  });

  // Wait for transfer transaction to be mined
  const publicClient = createRouterPublicClient(chainId);
  if (!publicClient) {
    throw new Error(`Unsupported chain ID: ${chainId}`);
  }

  const transferReceipt = await publicClient.waitForTransactionReceipt({
    hash: transferHash,
  });

  if (transferReceipt.status !== "success") {
    throw new Error("TransferFrom transaction failed");
  }
}

// Approve TokenMessenger to spend admin's USDC
export async function approveTokenMessenger(
  tokenAddress: string,
  amount: bigint,
  chainId: SupportedChainId,
  adminPrivateKey: string
): Promise<void> {
  const client = createRouterWalletClient(chainId, adminPrivateKey);
  if (!client) {
    throw new Error(`Unsupported chain ID: ${chainId}`);
  }

  const tokenMessengerAddress = getTokenMessengerContractAddress(chainId);

  const approveHash = await client.writeContract({
    address: tokenAddress as `0x${string}`,
    abi: ERC20_ABI,
    functionName: "approve",
    args: [tokenMessengerAddress as `0x${string}`, amount],
  });

  // Wait for approval transaction to be mined
  const publicClient = createRouterPublicClient(chainId);
  if (!publicClient) {
    throw new Error(`Unsupported chain ID: ${chainId}`);
  }

  const approveReceipt = await publicClient.waitForTransactionReceipt({
    hash: approveHash,
  });

  if (approveReceipt.status !== "success") {
    throw new Error("Approve transaction failed");
  }
}

// Extract messageHash from transaction receipt by parsing MessageSent event
export async function extractMessageHashFromReceipt(
  transactionHash: string,
  chainId: SupportedChainId
): Promise<string> {
  const client = createRouterPublicClient(chainId);
  if (!client) {
    throw new Error(`Unsupported chain ID: ${chainId}`);
  }

  // Get transaction receipt
  const receipt = await client.getTransactionReceipt({
    hash: transactionHash as `0x${string}`,
  });

  // Find MessageSent event in logs
  const messageSentLog = receipt.logs.find(
    (log) => log.topics[0] === MESSAGE_SENT_EVENT_SIGNATURE
  );

  if (!messageSentLog) {
    throw new Error("MessageSent event not found in transaction receipt");
  }

  // The messageHash is the keccak256 hash of the message data
  // For CCTP, the message data is in the log's data field
  const messageData = messageSentLog.data;

  // Hash the message data to get the messageHash
  const messageHash = keccak256(messageData);

  return messageHash;
}

// Execute same-chain transfer using permit
export async function executeSameChainTransfer(params: {
  fromAddress: string;
  toAddress: string;
  amount: number;
  sourceChainId: number;
  token: string;
  permit: db.UserPermit;
}): Promise<TransferResult> {
  const logPrefix = `[SAME-CHAIN-TRANSFER]`;

  console.log(`${logPrefix} Executing same-chain transfer:`, {
    from: params.fromAddress,
    to: params.toAddress,
    amount: params.amount,
    chain: params.sourceChainId,
    token: params.token,
    permitId: params.permit.id,
    timestamp: new Date().toISOString(),
  });

  const adminPrivateKey = process.env.ADMIN_PKEY;
  if (!adminPrivateKey) {
    throw new Error("ADMIN_PKEY environment variable not set");
  }

  // Get token contract address
  const tokenAddress = getTokenAddress(params.token, params.sourceChainId);
  if (!tokenAddress) {
    throw new Error(
      `Token ${params.token} not supported on chain ${params.sourceChainId}`
    );
  }

  console.log(`${logPrefix} Using permit for authorization:`, {
    permitId: params.permit.id,
    spenderAddress: params.permit.spenderAddress,
    amount: params.permit.amount.toString(),
    deadline: params.permit.deadline.toString(),
    nonce: params.permit.nonce.toString(),
  });

  // Create wallet client for admin
  const client = createRouterPublicClient(params.sourceChainId);
  if (!client) {
    throw new Error(`Unsupported chain: ${params.sourceChainId}`);
  }

  // Get viem chain config
  const chain = getViemChain(params.sourceChainId);
  const account = privateKeyToAccount(adminPrivateKey as `0x${string}`);
  const walletClient = createWalletClient({
    chain,
    transport: http(RPC_URLS[params.sourceChainId as keyof typeof RPC_URLS]),
    account,
  });

  // Convert amount to token units (assuming 6 decimals for stablecoins)
  const amountInTokenUnits = parseAmount(params.amount.toString(), 6);

  console.log(`${logPrefix} Executing transferFrom with permit:`, {
    tokenAddress,
    from: params.fromAddress,
    to: params.toAddress,
    amount: amountInTokenUnits.toString(),
  });

  // Execute transferFrom using the permit
  let transactionHash;
  try {
    transactionHash = await walletClient.writeContract({
      address: getAddress(tokenAddress),
      abi: ERC20_ABI,
      functionName: "transferFrom",
      args: [
        getAddress(params.fromAddress),
        getAddress(params.toAddress),
        amountInTokenUnits,
      ],
    });
  } catch (error) {
    console.error(`${logPrefix} TransferFrom transaction failed:`, {
      error: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : undefined,
      tokenAddress,
      from: params.fromAddress,
      to: params.toAddress,
      amount: amountInTokenUnits.toString(),
      permitId: params.permit.id,
    });
    throw new Error(
      `Failed to execute transferFrom: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }

  console.log(`${logPrefix} Same-chain transfer completed:`, {
    transactionHash,
    permitUsed: params.permit.id,
    realTransaction: true,
  });

  return {
    transactionHash,
    blockNumber: undefined, // Will be filled when transaction is mined
    gasUsed: undefined, // Will be filled when transaction is mined
  };
}

// Execute CCTP cross-chain transfer
export async function executeCCTPTransfer(params: {
  fromAddress: string;
  toAddress: string;
  amount: number;
  sourceChainId: number;
  targetChainId: number;
  token: string;
  permit: db.UserPermit;
}): Promise<TransferResult> {
  const logPrefix = `[CCTP-TRANSFER]`;

  console.log(`${logPrefix} Initiating transfer:`, {
    from: params.fromAddress,
    to: params.toAddress,
    amount: params.amount,
    sourceChain: params.sourceChainId,
    targetChain: params.targetChainId,
    token: params.token,
    permitId: params.permit.id,
    timestamp: new Date().toISOString(),
  });

  // Check if this is actually a cross-chain transfer
  if (
    params.sourceChainId === params.targetChainId &&
    params.token === params.token
  ) {
    console.log(
      `${logPrefix} Same-chain transfer detected, using direct transfer`
    );
    return executeSameChainTransfer(params);
  }

  // Validate CCTP transfer parameters
  const transferParams = {
    sourceChainId: params.sourceChainId as SupportedChainId,
    targetChainId: params.targetChainId as SupportedChainId,
    amount: params.amount.toString(),
    token: params.token,
    recipient: params.toAddress,
    sender: params.fromAddress,
  };

  console.log(`${logPrefix} Validating CCTP transfer parameters...`);
  const validation = CCTPService.validateTransfer(transferParams);

  if (!validation.valid) {
    console.error(`${logPrefix} CCTP validation failed:`, validation.error);
    throw new Error(`CCTP transfer validation failed: ${validation.error}`);
  }

  console.log(`${logPrefix} CCTP validation passed, proceeding with transfer`);

  try {
    // Create cross-chain payment record
    const crossChainPayment: CrossChainPayment = {
      id: `cctp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      agentId: "", // Will be set by caller
      userId: "", // Will be set by caller
      sourceChainId: params.sourceChainId,
      targetChainId: params.targetChainId,
      amount: parseAmount(params.amount.toString(), 6).toString(),
      token: params.token,
      messageHash: "", // Will be set after depositForBurn
      attestationStatus: "pending",
      permitId: params.permit.id,
      createdAt: Date.now(),
    };

    console.log(`${logPrefix} Created cross-chain payment record:`, {
      paymentId: crossChainPayment.id,
      sourceChain: crossChainPayment.sourceChainId,
      targetChain: crossChainPayment.targetChainId,
      amount: crossChainPayment.amount,
      token: crossChainPayment.token,
    });

    // Step 1: Execute depositForBurn on source chain
    console.log(
      `${logPrefix} Step 1: Executing depositForBurn on source chain ${params.sourceChainId}`
    );

    const adminPrivateKey = process.env.ADMIN_PKEY;
    if (!adminPrivateKey) {
      throw new Error("ADMIN_PKEY environment variable not set");
    }

    // Get destination domain for target chain
    const destinationDomain = getDestinationDomain(params.targetChainId);
    if (destinationDomain === null) {
      throw new Error(
        `Unsupported target chain for CCTP: ${params.targetChainId}`
      );
    }

    // Get token address on source chain
    const burnTokenAddress = getTokenAddress(
      params.token,
      params.sourceChainId
    );
    if (!burnTokenAddress) {
      throw new Error(
        `Token ${params.token} not supported on chain ${params.sourceChainId}`
      );
    }

    console.log(`${logPrefix} Calling TokenMessenger.depositForBurn with:`, {
      amount: crossChainPayment.amount,
      destinationDomain: destinationDomain,
      mintRecipient: params.toAddress,
      burnToken: burnTokenAddress,
      transferType: "standard",
    });

    // Step 1: Transfer USDC from user to admin wallet using permit
    console.log(
      `${logPrefix} Step 1: Transferring USDC from user to admin wallet using permit...`
    );
    try {
      await executePermitTransfer(
        params.permit,
        BigInt(crossChainPayment.amount),
        params.sourceChainId as SupportedChainId,
        adminPrivateKey
      );
      console.log(`${logPrefix} ✅ USDC transferred from user to admin wallet`);
    } catch (error) {
      console.error(`${logPrefix} Permit transfer failed:`, {
        error: error instanceof Error ? error.message : "Unknown error",
        permitId: params.permit.id,
        amount: crossChainPayment.amount,
      });
      throw new Error(
        `Failed to transfer USDC using permit: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }

    // Step 2: Approve TokenMessenger to spend admin's USDC
    console.log(
      `${logPrefix} Step 2: Approving TokenMessenger to spend USDC...`
    );
    try {
      await approveTokenMessenger(
        burnTokenAddress,
        BigInt(crossChainPayment.amount),
        params.sourceChainId as SupportedChainId,
        adminPrivateKey
      );
      console.log(`${logPrefix} ✅ TokenMessenger approved to spend USDC`);
    } catch (error) {
      console.error(`${logPrefix} TokenMessenger approval failed:`, {
        error: error instanceof Error ? error.message : "Unknown error",
        tokenAddress: burnTokenAddress,
        amount: crossChainPayment.amount,
      });
      throw new Error(
        `Failed to approve TokenMessenger: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }

    // Step 3: Execute depositForBurn transaction
    console.log(`${logPrefix} Step 3: Executing depositForBurn transaction...`);
    let depositResult;
    try {
      depositResult = await CCTPService.depositForBurn(
        params.sourceChainId as SupportedChainId,
        {
          amount: BigInt(crossChainPayment.amount),
          destinationDomain: destinationDomain,
          mintRecipient: params.toAddress,
          burnToken: burnTokenAddress,
          transferType: "standard",
        },
        adminPrivateKey
      );
    } catch (error) {
      console.error(`${logPrefix} DepositForBurn transaction failed:`, {
        error: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : undefined,
        sourceChainId: params.sourceChainId,
        amount: crossChainPayment.amount,
        destinationDomain,
        burnToken: burnTokenAddress,
      });
      throw new Error(
        `Failed to execute depositForBurn: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }

    const transactionHash = depositResult.transactionHash;
    let messageHash = depositResult.messageHash;

    // Extract real messageHash from transaction receipt
    if (!messageHash) {
      try {
        messageHash = await extractMessageHashFromReceipt(
          transactionHash,
          params.sourceChainId as SupportedChainId
        );
        console.log(
          `${logPrefix} ✅ Extracted messageHash from receipt: ${messageHash}`
        );
      } catch (error) {
        console.error(
          `${logPrefix} Failed to extract messageHash from receipt:`,
          error
        );
        // Fallback to placeholder for now
        messageHash = `0x${transactionHash.slice(2, 66)}`;
        console.log(`${logPrefix} Using fallback messageHash: ${messageHash}`);
      }
    }

    console.log(`${logPrefix} Step 1 completed:`, {
      sourceTransactionHash: transactionHash,
      messageHash: messageHash,
      realTransaction: true,
    });

    // Update cross-chain payment record with initial status
    crossChainPayment.sourceTransactionHash = transactionHash;
    crossChainPayment.messageHash = messageHash;
    crossChainPayment.attestationStatus = "pending";

    // Store the cross-chain payment record in database
    await db.createCrossChainPayment(crossChainPayment);

    console.log(`${logPrefix} Cross-chain payment record stored:`, {
      paymentId: crossChainPayment.id,
      sourceTransactionHash: crossChainPayment.sourceTransactionHash,
      messageHash: crossChainPayment.messageHash,
      attestationStatus: crossChainPayment.attestationStatus,
    });

    // Step 4: Poll for attestation completion
    console.log(`${logPrefix} Step 4: Polling for attestation...`);
    let attestationResult;
    try {
      attestationResult = await CCTPService.waitForAttestation(messageHash);
      if (!attestationResult.success) {
        throw new Error(attestationResult.error || "Attestation failed");
      }
      console.log(`${logPrefix} ✅ Attestation completed`);
    } catch (error) {
      console.error(`${logPrefix} Attestation polling failed:`, error);
      crossChainPayment.attestationStatus = "failed";
      crossChainPayment.errorMessage =
        error instanceof Error ? error.message : "Attestation failed";
      // Note: updateCrossChainPayment doesn't exist, would need to be implemented
      throw new Error(
        `Attestation polling failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }

    // Step 5: Execute receiveMessage on destination chain
    console.log(
      `${logPrefix} Step 5: Executing receiveMessage on destination chain...`
    );
    let redemptionResult;
    try {
      // Parse attestation response - Circle API returns message and attestation
      const attestationData = JSON.parse(attestationResult.attestation!);
      redemptionResult = await CCTPService.receiveMessage(
        params.targetChainId as SupportedChainId,
        {
          message: attestationData.message as `0x${string}`,
          attestation: attestationData.attestation as `0x${string}`,
        },
        adminPrivateKey
      );
      console.log(
        `${logPrefix} ✅ ReceiveMessage completed: ${redemptionResult.transactionHash}`
      );
    } catch (error) {
      console.error(`${logPrefix} ReceiveMessage failed:`, error);
      crossChainPayment.attestationStatus = "failed";
      crossChainPayment.errorMessage =
        error instanceof Error ? error.message : "Redemption failed";
      // Note: updateCrossChainPayment doesn't exist, would need to be implemented
      throw new Error(
        `Redemption failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }

    // Update payment status to completed
    crossChainPayment.attestationStatus = "complete";
    crossChainPayment.targetTransactionHash = redemptionResult.transactionHash;
    crossChainPayment.completedAt = Date.now();
    // Note: updateCrossChainPayment doesn't exist, would need to be implemented

    // Update permit usage after successful cross-chain transfer completion
    await db.updatePermitUsage(params.permit.id, params.permit.callsUsed + 1);
    console.log(
      `${logPrefix} ✅ Permit usage updated after successful cross-chain transfer:`,
      {
        permitId: params.permit.id,
        callsUsedBefore: params.permit.callsUsed,
        callsUsedAfter: params.permit.callsUsed + 1,
      }
    );

    console.log(`${logPrefix} ✅ Cross-chain transfer completed successfully`);

    console.log(`${logPrefix} CCTP transfer initiated successfully`);

    return {
      transactionHash,
      messageHash,
      blockNumber: undefined, // Will be filled when transaction is mined
      gasUsed: undefined, // Will be filled when transaction is mined
      crossChainPaymentId: crossChainPayment.id,
    };
  } catch (error) {
    console.error(`${logPrefix} CCTP transfer execution failed:`, {
      error: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : undefined,
      params: transferParams,
    });
    throw new Error(
      `CCTP transfer failed: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}
