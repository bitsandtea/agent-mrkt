"use client";

import { DEFAULT_DECIMALS, getChainName } from "@/config/tokens";
import { useUserPermits } from "@/lib/permits/hooks";
import { UserPermit } from "@/lib/permits/types";
import Image from "next/image";
import { useMemo, useState } from "react";

interface AgentSubscriptionProps {
  permits: UserPermit[];
  totalValue: number;
  totalCalls: number;
  usedCalls: number;
  remainingCalls: number;
  onEditSubscription: () => void;
  onPermitRevoked?: (permitId: string) => void;
}

export function AgentSubscription({
  permits,
  totalValue,
  totalCalls,
  usedCalls,
  remainingCalls,
  onEditSubscription,
  onPermitRevoked,
}: AgentSubscriptionProps) {
  const [revokingPermits, setRevokingPermits] = useState<Set<string>>(
    new Set()
  );
  const { revokePermitWithOnChain } = useUserPermits();

  const handleRevokePermit = async (permit: UserPermit) => {
    if (revokingPermits.has(permit.id)) return;

    setRevokingPermits((prev) => new Set(prev).add(permit.id));

    try {
      // Gasless revocation: User signs permit with amount=0, admin executes
      await revokePermitWithOnChain(permit);

      // Notify parent component
      onPermitRevoked?.(permit.id);
    } catch (error) {
      console.error("Failed to revoke permit:", error);
      // You might want to show a toast notification here
    } finally {
      setRevokingPermits((prev) => {
        const newSet = new Set(prev);
        newSet.delete(permit.id);
        return newSet;
      });
    }
  };

  // Filter to keep only the highest value permit per token/chain combination
  const filteredPermits = useMemo(() => {
    return permits.reduce((acc, permit) => {
      const key = `${permit.token}-${permit.chainId}`;
      const existing = acc.find((p) => `${p.token}-${p.chainId}` === key);

      if (!existing) {
        acc.push(permit);
      } else {
        // Keep the permit with higher amount
        if (Number(permit.amount) > Number(existing.amount)) {
          const index = acc.findIndex((p) => `${p.token}-${p.chainId}` === key);
          acc[index] = permit;
        }
      }

      return acc;
    }, [] as typeof permits);
  }, [permits]);

  const getTokenLogo = (token: string) => {
    return `/logos/${token.toLowerCase()}-logo.png`;
  };

  // getChainName is now imported from tokens.ts

  const formatTokenAmount = (amount: bigint) => {
    const value = Number(amount) / Math.pow(10, DEFAULT_DECIMALS);
    return value.toFixed(2);
  };

  const usagePercentage = totalCalls > 0 ? (usedCalls / totalCalls) * 100 : 0;

  return (
    <div className="bg-black/40 backdrop-blur-sm rounded-xl border border-purple-500/20 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-bold text-white">Active Subscription</h3>
        <div className="inline-flex items-center px-2 py-1 bg-green-600/20 border border-green-500/30 rounded-full">
          <span className="text-green-400 text-xs font-medium">Active</span>
        </div>
      </div>

      {/* Subscription Summary */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="text-center">
          <div className="text-2xl font-bold text-green-400">
            ${totalValue.toFixed(2)}
          </div>
          <div className="text-xs text-gray-400">Total Value</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-cyan-400">
            {remainingCalls}
          </div>
          <div className="text-xs text-gray-400">Calls Remaining</div>
        </div>
      </div>

      {/* Usage Progress */}
      <div className="mb-6">
        <div className="flex justify-between text-sm text-gray-400 mb-2">
          <span>Usage</span>
          <span>
            {usedCalls} / {totalCalls} calls
          </span>
        </div>
        <div className="w-full bg-gray-700 rounded-full h-2">
          <div
            className="bg-gradient-to-r from-cyan-500 to-purple-500 h-2 rounded-full transition-all duration-300"
            style={{
              width: `${Math.min(usagePercentage, 100)}%`,
            }}
          />
        </div>
        <div className="text-xs text-gray-500 mt-1">
          {usagePercentage.toFixed(1)}% used
        </div>
      </div>

      {/* Active Permits */}
      <div className="space-y-3 mb-6">
        <h4 className="text-sm font-medium text-gray-300">Active Permits</h4>
        {filteredPermits.map((permit) => (
          <div
            key={permit.id}
            className="bg-black/20 backdrop-blur-sm rounded-lg border border-purple-500/10 p-3"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="relative">
                  <Image
                    src={getTokenLogo(permit.token)}
                    alt={permit.token}
                    width={24}
                    height={24}
                    className="rounded-full"
                  />
                </div>
                <div>
                  <div className="text-white font-medium text-sm">
                    {permit.token}
                  </div>
                  <div className="text-xs text-gray-400">
                    {getChainName(permit.chainId)}
                  </div>
                </div>
              </div>
              <div className="flex items-center space-x-3">
                <div className="text-right">
                  <div className="text-cyan-400 font-semibold text-sm">
                    ${formatTokenAmount(permit.amount)}
                  </div>
                  <div className="text-xs text-gray-400">
                    {permit.maxCalls - permit.callsUsed} calls left
                  </div>
                </div>
                <button
                  onClick={() => handleRevokePermit(permit)}
                  disabled={revokingPermits.has(permit.id)}
                  className="p-1 text-gray-400 hover:text-red-400 hover:bg-red-400/10 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Revoke permit (gasless)"
                >
                  {revokingPermits.has(permit.id) ? (
                    <div className="w-3 h-3 border border-gray-400 border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <svg
                      className="w-3 h-3"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {/* Individual permit progress */}
            <div className="mt-2">
              <div className="w-full bg-gray-700 rounded-full h-1">
                <div
                  className="bg-gradient-to-r from-cyan-500 to-purple-500 h-1 rounded-full transition-all duration-300"
                  style={{
                    width: `${Math.min(
                      (permit.callsUsed / permit.maxCalls) * 100,
                      100
                    )}%`,
                  }}
                />
              </div>
            </div>

            {/* Expiration */}
            <div className="flex items-center justify-between text-xs mt-2">
              <div className="text-gray-500">
                Expires: {new Date(permit.expiresAt).toLocaleDateString()}
              </div>
              <div className="flex items-center space-x-1">
                <div
                  className={`w-1.5 h-1.5 rounded-full ${
                    Date.now() > permit.expiresAt - 7 * 24 * 60 * 60 * 1000
                      ? "bg-yellow-400"
                      : "bg-green-400"
                  }`}
                />
                <span
                  className={
                    Date.now() > permit.expiresAt - 7 * 24 * 60 * 60 * 1000
                      ? "text-yellow-400"
                      : "text-green-400"
                  }
                >
                  {Date.now() > permit.expiresAt - 7 * 24 * 60 * 60 * 1000
                    ? "Expires Soon"
                    : "Active"}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Edit Subscription Button */}
      <button
        onClick={onEditSubscription}
        className="w-full px-4 py-3 bg-gradient-to-r from-purple-500 to-cyan-500 hover:from-purple-600 hover:to-cyan-600 text-white font-semibold rounded-lg transition-all duration-200"
      >
        Edit Subscription Limits
      </button>

      <p className="text-xs text-gray-400 mt-2 text-center">
        Modify spending limits or add more permits
      </p>
    </div>
  );
}
