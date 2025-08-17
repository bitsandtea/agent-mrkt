"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import Link from "next/link";
import { useEffect, useState } from "react";

interface Agent {
  id: string;
  name: string;
  description: string;
  price_per_call_usd: number;
  free_trial_tries: number;
  rating: number;
  review_count: number;
  total_calls: number;
  publisher: {
    username: string;
    wallet_info?: {
      ens_name?: string;
      avatar?: string;
    };
  } | null;
}

export default function Home() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchAgents = async () => {
      try {
        const response = await fetch("/api/agents");
        const data = await response.json();

        if (data.success) {
          setAgents(data.agents);
        }
      } catch (error) {
        console.error("Error fetching agents:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchAgents();
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 text-white">
      {/* Header */}
      <header className="border-b border-purple-500/20 bg-black/20 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <h1 className="text-3xl font-bold bg-gradient-to-r from-cyan-400 to-purple-400 bg-clip-text text-transparent">
              Agent Marketplace
            </h1>
            <ConnectButton />
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-5xl font-bold bg-gradient-to-r from-cyan-400 to-purple-400 bg-clip-text text-transparent mb-6">
            Discover AI Agents
          </h2>
          <p className="text-xl text-gray-300 max-w-3xl mx-auto mb-8">
            Access powerful AI agents for smart contract security auditing, code
            analysis, and more. Pay per use with stablecoins and get started
            with free trials.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
            <div className="flex items-center space-x-2 text-green-400">
              <span className="w-2 h-2 bg-green-400 rounded-full"></span>
              <span className="text-sm">Free trials available</span>
            </div>
            <div className="flex items-center space-x-2 text-blue-400">
              <span className="w-2 h-2 bg-blue-400 rounded-full"></span>
              <span className="text-sm">Pay with USDC/PYUSD</span>
            </div>
            <div className="flex items-center space-x-2 text-purple-400">
              <span className="w-2 h-2 bg-purple-400 rounded-full"></span>
              <span className="text-sm">Multi-chain support</span>
            </div>
          </div>
        </div>
      </section>

      {/* Agents Listing */}
      <section className="pb-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between mb-8">
            <h3 className="text-2xl font-bold text-white">Available Agents</h3>
            <div className="text-sm text-gray-400">
              {agents.length} agent{agents.length !== 1 ? "s" : ""} available
            </div>
          </div>

          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="bg-black/40 backdrop-blur-sm rounded-xl border border-purple-500/20 p-6 animate-pulse"
                >
                  <div className="h-6 bg-gray-700 rounded mb-4"></div>
                  <div className="h-4 bg-gray-700 rounded mb-2"></div>
                  <div className="h-4 bg-gray-700 rounded mb-4"></div>
                  <div className="flex justify-between items-center">
                    <div className="h-6 bg-gray-700 rounded w-20"></div>
                    <div className="h-8 bg-gray-700 rounded w-24"></div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {agents.map((agent) => (
                <Link
                  key={agent.id}
                  href={`/project/${agent.id}`}
                  className="group bg-black/40 backdrop-blur-sm rounded-xl border border-purple-500/20 p-6 hover:border-purple-400/40 transition-all duration-200 hover:transform hover:scale-105"
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex-1">
                      <h4 className="text-lg font-semibold text-white group-hover:text-cyan-400 transition-colors">
                        {agent.name}
                      </h4>
                      <p className="text-sm text-gray-400 mt-1">
                        by {agent.publisher?.username || "Unknown"}
                      </p>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-bold text-cyan-400">
                        ${agent.price_per_call_usd}
                      </div>
                      <div className="text-xs text-gray-400">per call</div>
                    </div>
                  </div>

                  <p className="text-gray-300 text-sm mb-4 line-clamp-3">
                    {agent.description}
                  </p>

                  <div className="flex items-center justify-between text-xs text-gray-400 mb-4">
                    <div className="flex items-center space-x-4">
                      <div className="flex items-center">
                        <span className="text-yellow-400 mr-1">★</span>
                        <span>{agent.rating}</span>
                        <span className="ml-1">({agent.review_count})</span>
                      </div>
                      <div>{agent.total_calls} calls</div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="inline-flex items-center px-2 py-1 bg-green-600/20 border border-green-500/30 rounded-full">
                      <span className="text-green-400 text-xs font-medium">
                        {agent.free_trial_tries} free trials
                      </span>
                    </div>
                    <div className="text-cyan-400 text-sm font-medium group-hover:text-cyan-300">
                      View Details →
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}

          {!loading && agents.length === 0 && (
            <div className="text-center py-12">
              <div className="text-gray-400 text-lg mb-4">
                No agents available
              </div>
              <p className="text-gray-500">
                Check back later for new AI agents.
              </p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
