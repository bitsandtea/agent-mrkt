import {
  SUPPORTED_TOKENS,
  getChainName,
  getSupportedNetworksForToken,
} from "@/config/tokens";
import { UserPermit } from "@/lib/permits/types";
import Image from "next/image";
import { useEffect, useState } from "react";
import { useAccount, useBalance } from "wagmi";
import { PermitSlider } from "./PermitSlider";

interface PermitModalProps {
  isOpen: boolean;
  onClose: () => void;
  costPerCall: number;
  onPermitCreated: (permit: UserPermit) => void;
}

type TokenType = "USDC" | "PYUSD" | "EURC";

export function PermitModal({
  isOpen,
  onClose,
  costPerCall,
  onPermitCreated,
}: PermitModalProps) {
  const [selectedToken, setSelectedToken] = useState<TokenType>("USDC");
  const [selectedNetwork, setSelectedNetwork] = useState<number | null>(null);
  const { address } = useAccount();

  // Get supported networks for selected token
  const supportedNetworks = getSupportedNetworksForToken(selectedToken);

  useEffect(() => {
    console.log("selectedNetwork", selectedNetwork);
  }, [selectedNetwork]);

  // Get balance for selected token and network
  const tokenConfig = SUPPORTED_TOKENS[selectedToken];
  const tokenAddress =
    selectedNetwork && tokenConfig
      ? tokenConfig.contractAddresses[selectedNetwork]
      : undefined;

  const { data: balance, isLoading: balanceLoading } = useBalance({
    address,
    token: tokenAddress as `0x${string}`,
    chainId: selectedNetwork || undefined,
    query: {
      enabled: !!address && !!tokenAddress && !!selectedNetwork,
    },
  });

  if (!isOpen) return null;

  const getNetworkLogo = (chainId: number): string => {
    // Map chain IDs to logo filenames
    const chainLogos: { [key: number]: string } = {
      11155111: "eth-logo.png", // ETH_SEPOLIA
      84532: "base-logo.png", // BASE_SEPOLIA
      1: "eth-logo.png", // ETH_MAINNET
      42161: "eth-logo.png", // ARB_MAINNET (using eth logo for now)
      8453: "base-logo.png", // BASE_MAINNET
    };
    return chainLogos[chainId] || "eth-logo.png";
  };

  const formatBalance = (balance: bigint, decimals: number) => {
    const divisor = BigInt(10 ** decimals);
    const wholePart = balance / divisor;
    const fractionalPart = balance % divisor;
    const fractionalStr = fractionalPart.toString().padStart(decimals, "0");
    const twoDecimals = fractionalStr.slice(0, 2);

    // Hide .00, otherwise show 2 decimal places
    if (twoDecimals === "00") {
      return wholePart.toString();
    }
    return `${wholePart}.${twoDecimals}`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-gray-900 rounded-xl border border-blue-500/20 p-6 w-full max-w-sm shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-lg font-bold text-white">
            Set Up Payment Permits
          </h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white text-xl font-bold"
          >
            ✕
          </button>
        </div>

        {/* Token Selection */}
        <div className="mb-6">
          <h4 className="text-sm font-medium text-gray-300 mb-3">
            Pick stable coin which you wish to use to pay for subscription:
          </h4>
          <div className="grid grid-cols-3 gap-2">
            {Object.entries(SUPPORTED_TOKENS).map(([key, token]) => (
              <button
                key={key}
                onClick={() => setSelectedToken(key as TokenType)}
                className={`p-2 rounded-lg border transition-all text-center ${
                  selectedToken === key
                    ? "border-blue-500 bg-blue-500/10 text-white"
                    : "border-gray-600 bg-gray-800 text-gray-300 hover:border-gray-500"
                }`}
              >
                <div className="flex flex-col items-center space-y-1">
                  <Image
                    src={`/logos/${token.symbol.toLowerCase()}-logo.png`}
                    alt={token.symbol}
                    width={20}
                    height={20}
                    className="rounded-full"
                  />
                  <span className="text-xs font-medium">{token.symbol}</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Network Selection */}
        {supportedNetworks.length > 0 && (
          <div className="mb-6">
            <h4 className="text-sm font-medium text-gray-300 mb-3">
              Select Network:
            </h4>
            <div className="space-y-2">
              {supportedNetworks.map((chainId) => (
                <button
                  key={chainId}
                  onClick={() => setSelectedNetwork(chainId)}
                  className={`w-full p-3 rounded-lg border transition-all text-left ${
                    selectedNetwork === chainId
                      ? "border-blue-500 bg-blue-500/10 text-white"
                      : "border-gray-600 bg-gray-800 text-gray-300 hover:border-gray-500"
                  }`}
                >
                  <div className="flex items-center space-x-3">
                    <Image
                      src={`/logos/${getNetworkLogo(chainId)}`}
                      alt={getChainName(chainId)}
                      width={24}
                      height={24}
                      className="rounded-full"
                    />
                    <span className="font-medium">{getChainName(chainId)}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Balance Display */}
        {selectedNetwork && address && (
          <div className="mb-6 p-3 bg-gray-800 rounded-lg">
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-400">Your Balance:</span>
              <span className="text-sm font-medium text-white">
                {balanceLoading
                  ? "Loading..."
                  : balance
                  ? `${formatBalance(balance.value, balance.decimals)} ${
                      balance.symbol
                    }`
                  : "0.00"}
              </span>
            </div>
          </div>
        )}

        {selectedNetwork && (
          <PermitSlider
            costPerCall={costPerCall}
            onPermitCreated={onPermitCreated}
            selectedToken={selectedToken}
            selectedNetwork={selectedNetwork}
          />
        )}
      </div>
    </div>
  );
}
