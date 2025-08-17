"use client";

import { useSubscriptionPermit } from "@/lib/permits/hooks";
import { useCallback, useState } from "react";

interface PermitSliderProps {
  agentId: string;
  costPerCall: number;
  onPermitCreated?: (signature: any) => void;
  token?: string;
  chainId?: number;
}

export function PermitSlider({
  agentId,
  costPerCall,
  onPermitCreated,
  token = "USDC",
  chainId = 11155111, // Default to ETH Sepolia
}: PermitSliderProps) {
  const [amount, setAmount] = useState(10); // Default $10
  const { createSubscriptionPermit, isLoading, error, isReady } =
    useSubscriptionPermit(token, chainId, costPerCall);

  const maxCalls = Math.floor(amount / costPerCall);

  const handleCreatePermit = useCallback(async () => {
    try {
      const permitResult = await createSubscriptionPermit(amount);
      onPermitCreated?.(permitResult);
    } catch (err) {
      console.error("Failed to create permit:", err);
    }
  }, [createSubscriptionPermit, amount, onPermitCreated]);

  if (!isReady) {
    return (
      <div className="bg-black/40 backdrop-blur-sm rounded-xl border border-purple-500/20 p-6">
        <div className="text-center text-gray-400">
          Connect wallet to set up permits
        </div>
      </div>
    );
  }

  return (
    <div className="bg-black/40 backdrop-blur-sm rounded-xl border border-purple-500/20 p-6">
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-white mb-2">
          Set Spending Limit
        </h3>
        <p className="text-sm text-gray-400">
          Choose how much {token} you want to allow for API calls
        </p>
      </div>

      <div className="space-y-6">
        {/* Amount Display */}
        <div className="text-center">
          <div className="text-3xl font-bold text-cyan-400 mb-2">${amount}</div>
          <div className="text-sm text-gray-400">
            ≈ {maxCalls} API calls at ${costPerCall} each
          </div>
        </div>

        {/* Slider */}
        <div className="space-y-4">
          <input
            type="range"
            min="1"
            max="1000"
            step="0.5"
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value))}
            className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer slider"
            style={{
              background: `linear-gradient(to right, #06b6d4 0%, #06b6d4 ${
                (amount / 1000) * 100
              }%, #374151 ${(amount / 1000) * 100}%, #374151 100%)`,
            }}
          />
          <div className="flex justify-between text-xs text-gray-400">
            <span>$1</span>
            <span>$1000</span>
          </div>
        </div>

        {/* Quick Amount Buttons */}
        <div className="grid grid-cols-4 gap-2">
          {[10, 25, 50, 100].map((quickAmount) => (
            <button
              key={quickAmount}
              onClick={() => setAmount(quickAmount)}
              className={`py-2 px-3 rounded-lg text-sm font-medium transition-all ${
                amount === quickAmount
                  ? "bg-cyan-600 text-white"
                  : "bg-gray-700 text-gray-300 hover:bg-gray-600"
              }`}
            >
              ${quickAmount}
            </button>
          ))}
        </div>

        {/* Token and Chain Info */}
        <div className="bg-gray-800/50 rounded-lg p-3">
          <div className="flex justify-between items-center text-sm">
            <span className="text-gray-400">Token:</span>
            <span className="text-white font-medium">{token}</span>
          </div>
          <div className="flex justify-between items-center text-sm mt-1">
            <span className="text-gray-400">Network:</span>
            <span className="text-white font-medium">
              {chainId === 11155111 ? "Ethereum Sepolia" : "Base Sepolia"}
            </span>
          </div>
          <div className="flex justify-between items-center text-sm mt-1">
            <span className="text-gray-400">Duration:</span>
            <span className="text-white font-medium">30 days</span>
          </div>
        </div>

        {/* Error Display */}
        {error && (
          <div className="bg-red-900/20 border border-red-500/30 rounded-lg p-3">
            <div className="text-red-400 text-sm">Error: {error.message}</div>
          </div>
        )}

        {/* Create Permit Button */}
        <button
          onClick={handleCreatePermit}
          disabled={isLoading}
          className="w-full bg-gradient-to-r from-cyan-600 to-purple-600 hover:from-cyan-500 hover:to-purple-500 disabled:from-gray-600 disabled:to-gray-600 text-white font-semibold py-3 px-6 rounded-lg transition-all duration-200 disabled:cursor-not-allowed"
        >
          {isLoading ? (
            <div className="flex items-center justify-center space-x-2">
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              <span>Creating Permit...</span>
            </div>
          ) : (
            `Approve ${token} Spending`
          )}
        </button>

        <div className="text-xs text-gray-500 text-center">
          This will create a gasless permit allowing the marketplace to spend up
          to ${amount} {token} from your wallet for API calls.
        </div>
      </div>
    </div>
  );
}
