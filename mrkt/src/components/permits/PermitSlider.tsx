"use client";

import { useSubscriptionPermit } from "@/lib/permits/hooks";
import { UserPermit } from "@/lib/permits/types";
import { useState } from "react";
import { useAccount } from "wagmi";

interface PermitSliderProps {
  costPerCall: number;
  agentId: string;
  onPermitCreated?: (permit: UserPermit) => void;
  selectedToken: string;
  selectedNetwork: number;
}

export function PermitSlider({
  costPerCall,
  agentId,
  onPermitCreated,
  selectedToken,
  selectedNetwork,
}: PermitSliderProps) {
  const { address } = useAccount();
  const [selectedAmount, setSelectedAmount] = useState(10); // Default $10
  const [customAmount, setCustomAmount] = useState("");
  const [isCustom, setIsCustom] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  const presetAmounts = [5, 10, 100, 500];

  const { createSubscriptionPermit, isReady } = useSubscriptionPermit(
    selectedToken,
    selectedNetwork,
    costPerCall
  );

  const getCurrentAmount = () => {
    return isCustom ? Number(customAmount) || 0 : selectedAmount;
  };

  const maxCallsForAmount = Math.floor(getCurrentAmount() / costPerCall);

  const handlePresetClick = (amount: number) => {
    setSelectedAmount(amount);
    setIsCustom(false);
    setCustomAmount("");
  };

  const handleCustomChange = (value: string) => {
    setCustomAmount(value);
    setIsCustom(true);
  };

  const handleCreatePermit = async () => {
    if (!address || !isReady) return;

    const currentAmount = getCurrentAmount();
    if (currentAmount <= 0) return;

    setIsCreating(true);
    try {
      const permitResult = await createSubscriptionPermit(currentAmount);

      // Create permit object for storage
      const permit = {
        id: `${address}-${selectedToken}-${selectedNetwork}-${Date.now()}`,
        userAddress: address,
        agentId: agentId,
        token: selectedToken,
        chainId: selectedNetwork,
        spenderAddress: process.env.NEXT_PUBLIC_ADMIN_ADDRESS!,
        amount: BigInt(currentAmount * Math.pow(10, 6)), // USDC has 6 decimals
        nonce: permitResult.nonce || BigInt(0), // Use the fetched nonce
        deadline: BigInt(Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60),
        signature: {
          r: permitResult.r,
          s: permitResult.s,
          v: permitResult.v,
        },
        status: "active" as const,
        createdAt: Date.now(),
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
        maxCalls: maxCallsForAmount,
        callsUsed: 0,
        costPerCall,
      };

      onPermitCreated?.(permit);
    } catch (err) {
      console.error("Failed to create permit:", err);
    } finally {
      setIsCreating(false);
    }
  };

  if (!address) {
    return (
      <div className="p-6 border border-gray-700 rounded-lg bg-gray-900">
        <p className="text-gray-400">Connect your wallet to set up permits</p>
      </div>
    );
  }

  return (
    <div className="p-6 border border-gray-700 rounded-lg bg-gray-900 space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-white mb-2">
          Subscription Spending Limit
        </h3>
        <p className="text-gray-400 text-sm">
          Allow the admin to spend up to your chosen amount for API calls
        </p>
      </div>

      {/* Amount Selection */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-3">
          Maximum Amount: ${getCurrentAmount()}
        </label>

        {/* Preset Amount Buttons */}
        <div className="grid grid-cols-4 gap-2 mb-3">
          {presetAmounts.map((amount) => (
            <button
              key={amount}
              onClick={() => handlePresetClick(amount)}
              className={`p-2 rounded-lg border transition-all text-center ${
                !isCustom && selectedAmount === amount
                  ? "border-blue-500 bg-blue-500/10 text-white"
                  : "border-gray-600 bg-gray-800 text-gray-300 hover:border-gray-500"
              }`}
            >
              <span className="text-sm font-medium">${amount}</span>
            </button>
          ))}
        </div>

        {/* Custom Amount Input */}
        <div>
          <label className="block text-xs text-gray-400 mb-1">
            Custom Amount
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400">
              $
            </span>
            <input
              type="number"
              min="1"
              max="10000"
              step="0.01"
              value={customAmount}
              onChange={(e) => handleCustomChange(e.target.value)}
              placeholder="Enter amount"
              className={`w-full pl-8 pr-3 py-2 bg-gray-800 border rounded-lg text-white placeholder-gray-500 transition-all ${
                isCustom
                  ? "border-blue-500 bg-blue-500/10"
                  : "border-gray-600 hover:border-gray-500"
              }`}
            />
          </div>
        </div>
      </div>

      {/* Calculation Display */}
      <div className="bg-gray-800 p-4 rounded-lg">
        <div className="flex justify-between text-sm">
          <span className="text-gray-400">Cost per call:</span>
          <span className="text-white">${costPerCall}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-400">Maximum calls:</span>
          <span className="text-white">
            {Math.floor(getCurrentAmount() / costPerCall)}
          </span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-400">Permit duration:</span>
          <span className="text-white">30 days</span>
        </div>
      </div>

      {/* Create Permit Button */}
      <button
        onClick={handleCreatePermit}
        disabled={!isReady || isCreating || getCurrentAmount() <= 0}
        className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
      >
        {isCreating ? "Creating Permit..." : "Create Permit"}
      </button>
    </div>
  );
}
