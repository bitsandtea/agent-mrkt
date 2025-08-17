import {
  formatUnits,
  getAddress,
  isAddress,
  pad,
  parseUnits,
  slice,
} from "viem";

/**
 * Convert an Ethereum address to bytes32 format required by CCTP
 * @param address The Ethereum address to convert
 * @returns The address in bytes32 format
 */
export function addressToBytes32(address: string): `0x${string}` {
  return pad(address as `0x${string}`, { size: 32 });
}

/**
 * Convert bytes32 back to an Ethereum address
 * @param bytes32Address The bytes32 address to convert
 * @returns The Ethereum address
 */
export function bytes32ToAddress(bytes32Address: string): `0x${string}` {
  return getAddress(slice(bytes32Address as `0x${string}`, 12));
}

/**
 * Validate if an address is a valid Ethereum address
 * @param address The address to validate
 * @returns True if valid, false otherwise
 */
export function isValidAddress(address: string): boolean {
  return isAddress(address);
}

/**
 * Format amount for display with proper decimals
 * @param amount The amount in wei/smallest unit
 * @param decimals The number of decimals for the token
 * @returns Formatted amount as string
 */
export function formatAmount(
  amount: string | number | bigint,
  decimals: number = 6
): string {
  return formatUnits(BigInt(amount), decimals);
}

/**
 * Parse amount from display format to wei/smallest unit
 * @param amount The amount as string
 * @param decimals The number of decimals for the token
 * @returns Amount in smallest unit as bigint
 */
export function parseAmount(amount: string, decimals: number = 6): bigint {
  return parseUnits(amount, decimals);
}
