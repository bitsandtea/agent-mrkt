import {
  createPublicClient,
  createWalletClient,
  http,
  PublicClient,
  WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia, sepolia } from "viem/chains";
import { RPC_URLS, SupportedChainId } from "../../config/tokens";

// Create public client for reading blockchain data
export function createRouterPublicClient(chainId: number): PublicClient | null {
  switch (chainId) {
    case SupportedChainId.BASE_SEPOLIA:
      return createPublicClient({
        chain: baseSepolia,
        transport: http(RPC_URLS[SupportedChainId.BASE_SEPOLIA]),
      });
    case SupportedChainId.ETH_SEPOLIA:
      return createPublicClient({
        chain: sepolia,
        transport: http(RPC_URLS[SupportedChainId.ETH_SEPOLIA]),
      });
    default:
      return null;
  }
}

// Create wallet client for writing transactions
export function createRouterWalletClient(
  chainId: number,
  privateKey: string
): WalletClient | null {
  const account = privateKeyToAccount(privateKey as `0x${string}`);

  switch (chainId) {
    case SupportedChainId.BASE_SEPOLIA:
      return createWalletClient({
        chain: baseSepolia,
        transport: http(RPC_URLS[SupportedChainId.BASE_SEPOLIA]),
        account,
      });
    case SupportedChainId.ETH_SEPOLIA:
      return createWalletClient({
        chain: sepolia,
        transport: http(RPC_URLS[SupportedChainId.ETH_SEPOLIA]),
        account,
      });
    default:
      return null;
  }
}

// Get viem chain config by chain ID
export function getViemChain(chainId: number) {
  switch (chainId) {
    case SupportedChainId.BASE_SEPOLIA:
      return baseSepolia;
    case SupportedChainId.ETH_SEPOLIA:
      return sepolia;
    default:
      throw new Error(`Unsupported chain: ${chainId}`);
  }
}
