/**
 * List of all the chains/networks supported
 */
export enum Chain {
  ETH = "ETH",
  AVAX = "AVAX",
  ARB = "ARB",
  BASE = "BASE",
}

/**
 * List of all the chain/network IDs supported
 */
export enum SupportedChainId {
  ETH_SEPOLIA = 11155111,
  // AVAX_FUJI = 43113,
  // ARB_SEPOLIA = 421614,
  BASE_SEPOLIA = 84532,
  // Mainnet chain IDs
  ETH_MAINNET = 1,
  ARB_MAINNET = 42161,
  BASE_MAINNET = 8453,
}

/**
 * List of all the chain/network IDs supported in hexadecimals
 */
export const SupportedChainIdHex = {
  ETH_SEPOLIA: "0xaa36a7",
  // AVAX_FUJI: "0xa869",
  // ARB_SEPOLIA: "0x66eee",
  BASE_SEPOLIA: "0x14a34",
  ETH_MAINNET: "0x1",
  ARB_MAINNET: "0xa4b1",
  BASE_MAINNET: "0x2105",
};

interface ChainToChainIdMap {
  [key: string]: number;
}

/**
 * Maps a chain to it's chain ID
 */
export const CHAIN_TO_CHAIN_ID: ChainToChainIdMap = {
  [Chain.ETH]: SupportedChainId.ETH_SEPOLIA,
  // [Chain.AVAX]: SupportedChainId.AVAX_FUJI,
  // [Chain.ARB]: SupportedChainId.ARB_SEPOLIA,
  [Chain.BASE]: SupportedChainId.BASE_SEPOLIA,
};

interface ChainToChainNameMap {
  [key: string]: string;
}

/**
 * Maps a chain to it's readable name
 */
export const CHAIN_TO_CHAIN_NAME: ChainToChainNameMap = {
  ETH: "Ethereum Sepolia",
  // AVAX: "Avalanche Fuji",
  // ARB: "Arbitrum Sepolia",
  BASE: "Base Sepolia",
};

/**
 * Array of all the supported chain IDs
 */
export const ALL_SUPPORTED_CHAIN_IDS: SupportedChainId[] = Object.values(
  SupportedChainId
).filter((id) => typeof id === "number") as SupportedChainId[];

/**
 * List of Circle-defined IDs referring to specific domains
 */
export enum DestinationDomain {
  ETH = 0,
  AVAX = 1,
  ARB = 3,
  BASE = 6,
}

// https://eips.ethereum.org/EIPS/eip-3085
interface AddEthereumChainParameter {
  chainId: string;
  blockExplorerUrls?: string[];
  chainName?: string;
  iconUrls?: string[];
  nativeCurrency?: {
    name: string;
    symbol: string;
    decimals: number;
  };
  rpcUrls?: string[];
}

const ETH_SEPOLIA: AddEthereumChainParameter = {
  chainId: SupportedChainIdHex.ETH_SEPOLIA,
  blockExplorerUrls: ["https://sepolia.etherscan.io"],
  chainName: "Sepolia Test Network",
  nativeCurrency: {
    name: "Ethereum",
    symbol: "ETH",
    decimals: 18,
  },
  rpcUrls: ["https://sepolia.infura.io/v3/"],
};

/* const AVAX_FUJI: AddEthereumChainParameter = {
  chainId: SupportedChainIdHex.AVAX_FUJI,
  blockExplorerUrls: ["https://testnet.snowtrace.io/"],
  chainName: "Avalanche FUJI C-Chain",
  nativeCurrency: {
    name: "Avalanche",
    symbol: "AVAX",
    decimals: 18,
  },
  rpcUrls: ["https://api.avax-test.network/ext/bc/C/rpc"],
}; */

/* const ARB_SEPOLIA: AddEthereumChainParameter = {
  chainId: SupportedChainIdHex.ARB_SEPOLIA,
  blockExplorerUrls: ["https://sepolia.arbiscan.io/"],
  chainName: "Arbitrum Sepolia Testnet",
  nativeCurrency: {
    name: "Ethereum",
    symbol: "ETH",
    decimals: 18,
  },
  rpcUrls: ["https://arb-sepolia.g.alchemy.com/v2/demo"],
}; */

const BASE_SEPOLIA: AddEthereumChainParameter = {
  chainId: SupportedChainIdHex.BASE_SEPOLIA,
  blockExplorerUrls: ["https://sepolia.basescan.org"],
  chainName: "Base Sepolia Testnet",
  nativeCurrency: {
    name: "Ethereum",
    symbol: "ETH",
    decimals: 18,
  },
  rpcUrls: ["https://sepolia.base.org"],
};

interface ChainIdToChainParameters {
  [key: string]: AddEthereumChainParameter;
}

export const CHAIN_ID_HEXES_TO_PARAMETERS: ChainIdToChainParameters = {
  [SupportedChainIdHex.ETH_SEPOLIA]: ETH_SEPOLIA,
  // [SupportedChainIdHex.AVAX_FUJI]: AVAX_FUJI,
  // [SupportedChainIdHex.ARB_SEPOLIA]: ARB_SEPOLIA,
  [SupportedChainIdHex.BASE_SEPOLIA]: BASE_SEPOLIA,
};

/**
 * Map of supported chains to USDC contract addresses
 */
export const CHAIN_IDS_TO_USDC_ADDRESSES = {
  [SupportedChainId.ETH_SEPOLIA]: "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238",
  // [SupportedChainId.AVAX_FUJI]: "0x5425890298aed601595a70AB815c96711a31Bc65",
  // [SupportedChainId.ARB_SEPOLIA]: "0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d",
  [SupportedChainId.BASE_SEPOLIA]: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
  // [SupportedChainId.ETH_MAINNET]: "0xA0b86a33E6441e6e80D0f73D9C3C0e0B8C8C8C8C",
  // [SupportedChainId.ARB_MAINNET]: "0xA0b86a33E6441e6e80D0f73D9C3C0e0B8C8C8C8C",
  // [SupportedChainId.BASE_MAINNET]: "0xA0b86a33E6441e6e80D0f73D9C3C0e0B8C8C8C8C",
};

/**
 * Map of supported chains to Token Messenger contract addresses
 */
export const CHAIN_IDS_TO_TOKEN_MESSENGER_ADDRESSES = {
  [SupportedChainId.ETH_SEPOLIA]: "0x9f3b8679c73c2fef8b59b4f3444d4e156fb70aa5",
  // [SupportedChainId.AVAX_FUJI]: "0xeb08f243e5d3fcff26a9e38ae5520a669f4019d0",
  // [SupportedChainId.ARB_SEPOLIA]: "0x9f3b8679c73c2fef8b59b4f3444d4e156fb70aa5",
  [SupportedChainId.BASE_SEPOLIA]: "0x9f3b8679c73c2fef8b59b4f3444d4e156fb70aa5",
};

/**
 * Map of supported chains to Message Transmitter contract addresses
 */
export const CHAIN_IDS_TO_MESSAGE_TRANSMITTER_ADDRESSES = {
  [SupportedChainId.ETH_SEPOLIA]: "0x7865fafc2db2093669d92c0f33aeef291086befd",
  // [SupportedChainId.AVAX_FUJI]: "0xa9fb1b3009dcb79e2fe346c16a604b8fa8ae0a79",
  // [SupportedChainId.ARB_SEPOLIA]: "0xacf1ceef35caac005e15888ddb8a3515c41b4872",
  [SupportedChainId.BASE_SEPOLIA]: "0x7865fafc2db2093669d92c0f33aeef291086befd",
};

export const DEFAULT_DECIMALS = 6; // USDC

export interface TokenConfig {
  symbol: string;
  name: string;
  decimals: number;
  contractAddresses: {
    [chainId: number]: string;
  };
  usdPrice: number;
  isStablecoin: boolean;
  status: "active" | "inactive";
}

export const USDC_CONFIG: TokenConfig = {
  symbol: "USDC",
  name: "USD Coin",
  decimals: DEFAULT_DECIMALS,
  contractAddresses: {
    // Testnet addresses
    [SupportedChainId.ETH_SEPOLIA]:
      "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238",
    [SupportedChainId.BASE_SEPOLIA]:
      "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    // [SupportedChainId.ARB_SEPOLIA]:
    //   "0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d",
    // [SupportedChainId.AVAX_FUJI]: "0x5425890298aed601595a70AB815c96711a31Bc65",
  },
  usdPrice: 1.0,
  isStablecoin: true,
  status: "active",
};

export const PYUSD_CONFIG: TokenConfig = {
  symbol: "PYUSD",
  name: "PayPal USD",
  decimals: DEFAULT_DECIMALS,
  contractAddresses: {
    // Testnet only for now
    [SupportedChainId.ETH_SEPOLIA]:
      "0xcac524bca292aaade2df8a05cc58f0a65b1b3bb9",
  },
  usdPrice: 1.0,
  isStablecoin: true,
  status: "active",
};

export const EURC_CONFIG: TokenConfig = {
  symbol: "EURC",
  name: "Euro Coin",
  decimals: DEFAULT_DECIMALS,
  contractAddresses: {
    // Testnet addresses
    [SupportedChainId.ETH_SEPOLIA]:
      "0x08210F9170F89Ab7658F0B5E3fF39b0E03C594D4",
    [SupportedChainId.BASE_SEPOLIA]:
      "0x808456652fdb597867f38412077A9182bf77359F",
  },
  usdPrice: 1.1,
  isStablecoin: true,
  status: "active",
};

export const SUPPORTED_TOKENS = {
  USDC: USDC_CONFIG,
  PYUSD: PYUSD_CONFIG,
  EURC: EURC_CONFIG,
};

export function getTokenAddress(token: string, chainId: number): string | null {
  const tokenConfig = SUPPORTED_TOKENS[token as keyof typeof SUPPORTED_TOKENS];
  if (!tokenConfig) return null;

  return tokenConfig.contractAddresses[chainId] || null;
}

export function isNetworkSupported(token: string, chainId: number): boolean {
  const tokenConfig = SUPPORTED_TOKENS[token as keyof typeof SUPPORTED_TOKENS];
  if (!tokenConfig) return false;

  return chainId in tokenConfig.contractAddresses;
}

export function getSupportedNetworksForToken(token: string): number[] {
  const tokenConfig = SUPPORTED_TOKENS[token as keyof typeof SUPPORTED_TOKENS];
  if (!tokenConfig) return [];

  return Object.keys(tokenConfig.contractAddresses).map(Number);
}

export function getChainName(chainId: number): string {
  const chainEntry = Object.entries(CHAIN_TO_CHAIN_ID).find(
    ([_, id]) => id === chainId
  );
  if (!chainEntry) return "Unknown";

  return (
    CHAIN_TO_CHAIN_NAME[chainEntry[0] as keyof typeof CHAIN_TO_CHAIN_NAME] ||
    "Unknown"
  );
}

export function getChainParameters(
  chainId: number
): AddEthereumChainParameter | null {
  const chainIdHex = Object.entries(SupportedChainId).find(
    ([_, id]) => id === chainId
  )?.[0];
  if (!chainIdHex) return null;

  return (
    CHAIN_ID_HEXES_TO_PARAMETERS[
      SupportedChainIdHex[chainIdHex as keyof typeof SupportedChainIdHex]
    ] || null
  );
}
