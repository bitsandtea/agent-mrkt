"use client";

import { AgentSubscription } from "@/components/AgentSubscription";
import { PermitModal } from "@/components/permits";
import { getChainName, SUPPORTED_TOKENS } from "@/config/tokens";
import { useUser } from "@/hooks/useUser";
import { savePermit, UserPermit } from "@/lib/permits";
import { useAgentSubscription } from "@/lib/permits/hooks";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useAccount } from "wagmi";

interface Agent {
  id: string;
  name: string;
  description: string;
  api_endpoint: string;
  free_trial_tries: number;
  price_per_call_usd: number;
  payment_preferences: {
    payout_token: string;
    payout_network: string;
  };
  api_documentation: {
    methods: Array<{
      name: string;
      description: string;
      parameters: Record<string, string>;
      examples?: Array<{
        method: string;
        request: Record<string, unknown>;
        response: Record<string, unknown>;
      }>;
    }>;
  };
  status: string;
  created_at: string;
  total_calls: number;
  total_revenue_usd: number;
  rating: number;
  review_count: number;
  publisher: {
    username: string;
    wallet_info?: {
      ens_name?: string;
      avatar?: string;
    };
  } | null;
}

export default function ProjectPage() {
  const params = useParams();
  const { address } = useAccount();
  const { apiKey } = useUser();
  const [agent, setAgent] = useState<Agent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("typescript");
  const [showPermitSetup, setShowPermitSetup] = useState(false);
  const [permitSuccess, setPermitSuccess] = useState(false);

  // Get subscription status for this agent
  const { hasActiveSubscription, subscriptionSummary, refreshSubscription } =
    useAgentSubscription();

  const handlePermitCreated = async (permit: UserPermit) => {
    try {
      await savePermit(permit);
      setShowPermitSetup(false);
      setPermitSuccess(true);

      // Refresh subscription data
      refreshSubscription();

      // Hide success message after 5 seconds
      setTimeout(() => setPermitSuccess(false), 5000);
    } catch (error) {
      console.error("Failed to save permit:", error);
      // Still close the modal and show success since the permit was created
      setShowPermitSetup(false);
      setPermitSuccess(true);
      refreshSubscription();
      setTimeout(() => setPermitSuccess(false), 5000);
    }
  };

  const handleSubscribe = () => {
    if (!address) {
      console.log("No wallet address, showing wallet connection prompt");
      // Show wallet connection prompt
      return;
    }
    console.log("Setting showPermitSetup to true");
    setShowPermitSetup(true);
  };

  const handleEditSubscription = () => {
    setShowPermitSetup(true);
  };

  const handlePermitRevoked = async (permitId: string) => {
    // Refresh subscription data after permit revocation
    await refreshSubscription();
  };

  const getCodeExample = (language: string, agent: Agent) => {
    const userApiKey = apiKey || "your_api_key_here";
    const agentId = agent.id;

    switch (language) {
      case "curl":
        return `curl -X POST ${process.env.NEXT_PUBLIC_API_ROUTER}/${agentId} \\
  -H "Authorization: Bearer ${userApiKey}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "method": "${agent.api_documentation.methods[0]?.name || "audit_contract"}",
    "parameters": {
      "github_url": "https://github.com/your-username/your-repo",
      "entry_contract": "YourContract.sol"
    }
  }'`;

      case "typescript":
        return `import axios from 'axios';

const apiKey = '${userApiKey}';
const agentId = '${agentId}';

async function callAgent() {
  try {
    const response = await axios.post(
      \`${process.env.NEXT_PUBLIC_API_ROUTER}/\${agentId}\`,
      {
        method: '${
          agent.api_documentation.methods[0]?.name || "audit_contract"
        }',
        parameters: {
          github_url: 'https://github.com/your-username/your-repo',
          entry_contract: 'YourContract.sol'
        }
      },
      {
        headers: {
          'Authorization': \`Bearer \${apiKey}\`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log('Result:', response.data);
    return response.data;
  } catch (error) {
    console.error('Error:', error);
    throw error;
  }
}

// Usage
callAgent()
  .then(result => console.log('Agent response:', result))
  .catch(error => console.error('Failed to call agent:', error));`;

      case "nodejs":
        return `const https = require('https');

const apiKey = '${userApiKey}';
const agentId = '${agentId}';

const data = JSON.stringify({
  method: '${agent.api_documentation.methods[0]?.name || "audit_contract"}',
  parameters: {
    github_url: 'https://github.com/your-username/your-repo',
    entry_contract: 'YourContract.sol'
  }
});

const options = {
  hostname: '${process.env.NEXT_PUBLIC_API_ROUTER}',
  port: 443,
  path: \`/\${agentId}\`,
  method: 'POST',
  headers: {
    'Authorization': \`Bearer \${apiKey}\`,
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
};

const req = https.request(options, (res) => {
  let responseData = '';
  
  res.on('data', (chunk) => {
    responseData += chunk;
  });
  
  res.on('end', () => {
    try {
      const result = JSON.parse(responseData);
      console.log('Agent response:', result);
    } catch (error) {
      console.error('Failed to parse response:', error);
    }
  });
});

req.on('error', (error) => {
  console.error('Request error:', error);
});

req.write(data);
req.end();`;

      case "python":
        return `import requests
import json

api_key = '${userApiKey}'
agent_id = '${agentId}'

def call_agent():
    url = f'${process.env.NEXT_PUBLIC_API_ROUTER}/{agent_id}'
    
    headers = {
        'Authorization': f'Bearer {api_key}',
        'Content-Type': 'application/json'
    }
    
    payload = {
        'method': '${
          agent.api_documentation.methods[0]?.name || "audit_contract"
        }',
        'parameters': {
            'github_url': 'https://github.com/your-username/your-repo',
            'entry_contract': 'YourContract.sol'
        }
    }
    
    try:
        response = requests.post(url, headers=headers, json=payload)
        response.raise_for_status()
        
        result = response.json()
        print('Agent response:', json.dumps(result, indent=2))
        return result
        
    except requests.exceptions.RequestException as error:
        print(f'Request failed: {error}')
        raise error

# Usage
if __name__ == '__main__':
    try:
        result = call_agent()
        print('Success!')
    except Exception as e:
        print(f'Failed to call agent: {e}')`;

      default:
        return "// Select a language to see the example";
    }
  };

  useEffect(() => {
    const fetchAgent = async () => {
      try {
        const response = await fetch(`/api/agents/${params.id}`);
        const data = await response.json();

        if (data.success) {
          setAgent(data.agent);
        } else {
          setError("Agent not found");
        }
      } catch (err) {
        setError("Failed to load agent");
        console.error("Error fetching agent:", err);
      } finally {
        setLoading(false);
      }
    };

    if (params.id) {
      fetchAgent();
    }
  }, [params.id]);

  // Refresh subscription data when agent loads or address changes
  useEffect(() => {
    if (agent && address) {
      refreshSubscription();
    }
  }, [agent, address, refreshSubscription]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center">
        <div className="text-white text-xl">Loading...</div>
      </div>
    );
  }

  if (error || !agent) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center">
        <div className="text-red-400 text-xl">{error || "Agent not found"}</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 text-white">
      {/* Header */}
      <header className="border-b border-purple-500/20 bg-black/20 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <h1 className="text-3xl font-bold bg-gradient-to-r from-cyan-400 to-purple-400 bg-clip-text text-transparent">
              Agent Marketplace
            </h1>
            <div className="flex items-center space-x-4">
              <ConnectButton />
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-8">
            {/* Agent Overview */}
            <div className="bg-black/40 backdrop-blur-sm rounded-xl border border-purple-500/20 p-6">
              <div className="flex items-start justify-between mb-6">
                <div>
                  <h2 className="text-2xl font-bold text-white mb-2">
                    {agent.name}
                  </h2>
                  <div className="flex items-center space-x-4 text-sm text-gray-300">
                    <span>by {agent.publisher?.username || "Unknown"}</span>
                    <span>•</span>
                    <div className="flex items-center">
                      <span className="text-yellow-400">★</span>
                      <span className="ml-1">{agent.rating}</span>
                      <span className="ml-1">
                        ({agent.review_count} reviews)
                      </span>
                    </div>
                    <span>•</span>
                    <span>{agent.total_calls} calls</span>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-bold text-cyan-400">
                    ${agent.price_per_call_usd}
                  </div>
                  <div className="text-sm text-gray-400">per call</div>
                </div>
              </div>

              <p className="text-gray-300 leading-relaxed mb-6">
                {agent.description}
              </p>

              {/* Free Trial Badge */}
              <div className="inline-flex items-center px-3 py-1 bg-green-600/20 border border-green-500/30 rounded-full">
                <span className="text-green-400 text-sm font-medium">
                  {agent.free_trial_tries} Free Trials Available
                </span>
              </div>
            </div>

            {/* API Documentation */}
            <div className="bg-black/40 backdrop-blur-sm rounded-xl border border-purple-500/20 p-6">
              <h3 className="text-xl font-bold text-white mb-4">
                API Documentation
              </h3>

              {agent.api_documentation.methods.map((method, index) => (
                <div key={index} className="mb-6 last:mb-0">
                  <div className="flex items-center mb-3">
                    <span className="px-3 py-1 bg-blue-600/20 border border-blue-500/30 rounded text-blue-400 text-sm font-mono">
                      {method.name}
                    </span>
                  </div>

                  <p className="text-gray-300 mb-4">{method.description}</p>

                  <div className="space-y-4">
                    <div>
                      <h5 className="text-sm font-semibold text-gray-400 mb-2">
                        Parameters:
                      </h5>
                      <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700">
                        <pre className="text-sm text-gray-300 overflow-x-auto">
                          {JSON.stringify(method.parameters, null, 2)}
                        </pre>
                      </div>
                    </div>

                    {method.examples && method.examples.length > 0 && (
                      <div>
                        <h5 className="text-sm font-semibold text-gray-400 mb-2">
                          Example:
                        </h5>
                        <div className="space-y-3">
                          <div>
                            <div className="text-xs text-gray-500 mb-1">
                              Request:
                            </div>
                            <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700">
                              <pre className="text-sm text-gray-300 overflow-x-auto">
                                {JSON.stringify(
                                  method.examples[0].request,
                                  null,
                                  2
                                )}
                              </pre>
                            </div>
                          </div>
                          <div>
                            <div className="text-xs text-gray-500 mb-1">
                              Response:
                            </div>
                            <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700">
                              <pre className="text-sm text-gray-300 overflow-x-auto">
                                {JSON.stringify(
                                  method.examples[0].response,
                                  null,
                                  2
                                )}
                              </pre>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Code Examples */}
            <div className="bg-black/40 backdrop-blur-sm rounded-xl border border-purple-500/20 p-6">
              <h3 className="text-xl font-bold text-white mb-4">
                Code Examples
              </h3>

              {/* Tab Navigation */}
              <div className="flex flex-wrap gap-2 mb-4 border-b border-gray-700">
                {[
                  { id: "typescript", label: "TypeScript", icon: "TS" },
                  { id: "curl", label: "cURL", icon: "curl" },
                  { id: "nodejs", label: "Node.js", icon: "JS" },
                  { id: "python", label: "Python", icon: "PY" },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`px-4 py-2 rounded-t-lg text-sm font-medium transition-colors ${
                      activeTab === tab.id
                        ? "bg-cyan-600/20 text-cyan-400 border-b-2 border-cyan-400"
                        : "text-gray-400 hover:text-gray-300 hover:bg-gray-800/50"
                    }`}
                  >
                    <span className="inline-flex items-center space-x-2">
                      <span className="text-xs bg-gray-700 px-1.5 py-0.5 rounded">
                        {tab.icon}
                      </span>
                      <span>{tab.label}</span>
                    </span>
                  </button>
                ))}
              </div>

              {/* Code Display */}
              <div className="relative">
                <div className="absolute top-3 right-3 z-10">
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(
                        getCodeExample(activeTab, agent)
                      );
                    }}
                    className="px-3 py-1 bg-gray-700/80 hover:bg-gray-600/80 text-gray-300 text-xs rounded transition-colors"
                  >
                    Copy
                  </button>
                </div>
                <div className="bg-slate-900/80 rounded-lg p-4 border border-slate-700 overflow-x-auto">
                  <pre className="text-sm text-gray-300">
                    <code>{getCodeExample(activeTab, agent)}</code>
                  </pre>
                </div>
              </div>

              <div className="mt-4 p-3 bg-blue-600/10 border border-blue-500/20 rounded-lg">
                <div className="flex items-start space-x-2">
                  <div className="text-blue-400 mt-0.5">ℹ️</div>
                  <div className="text-sm text-blue-300">
                    <strong>Note:</strong>{" "}
                    {apiKey ? (
                      <>
                        Your API key is automatically populated in the examples
                        above.
                      </>
                    ) : (
                      <>
                        Connect your wallet to see your personal API key in the
                        examples, or replace{" "}
                        <code className="bg-blue-900/30 px-1 rounded">
                          your_api_key_here
                        </code>{" "}
                        with your actual API key.
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Success Message */}
            {permitSuccess && (
              <div className="bg-green-900/20 border border-green-500/30 rounded-xl p-4 mb-6">
                <div className="flex items-center space-x-2">
                  <div className="text-green-400">✅</div>
                  <div className="text-green-300">
                    <strong>Permit Created Successfully!</strong> You can now
                    use this agent&apos;s API services.
                  </div>
                </div>
              </div>
            )}

            {/* Subscription Status */}
            {address && hasActiveSubscription && subscriptionSummary ? (
              <AgentSubscription
                permits={subscriptionSummary.permits}
                totalValue={subscriptionSummary.totalValue}
                totalCalls={subscriptionSummary.totalCalls}
                usedCalls={subscriptionSummary.usedCalls}
                remainingCalls={subscriptionSummary.remainingCalls}
                onEditSubscription={handleEditSubscription}
              />
            ) : (
              /* Subscribe to Agent */
              <div className="bg-black/40 backdrop-blur-sm rounded-xl border border-purple-500/20 p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-bold text-white">
                    Subscribe to Agent
                  </h3>
                  {agent.free_trial_tries > 0 && (
                    <div className="inline-flex items-center px-2 py-1 bg-green-600/20 border border-green-500/30 rounded-full">
                      <span className="text-green-400 text-xs font-medium">
                        {agent.free_trial_tries} free call
                        {agent.free_trial_tries !== 1 ? "s" : ""}
                      </span>
                    </div>
                  )}
                </div>

                <p className="text-gray-300 text-sm mb-4">
                  Subscribe to this agent to start making API calls and access
                  all features.
                </p>

                <button
                  onClick={handleSubscribe}
                  className="w-full px-4 py-3 bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 disabled:from-gray-500 disabled:to-gray-600 text-white font-semibold rounded-lg transition-all duration-200"
                  disabled={!address}
                >
                  {address ? "Subscribe to Agent" : "Connect Wallet"}
                </button>
                <p className="text-xs text-gray-400 mt-2 text-center">
                  {address
                    ? "Set up permits to enable gasless payments"
                    : "Connect wallet to subscribe and start using this agent"}
                </p>
              </div>
            )}

            {/* Payment Options */}
            <div className="bg-black/40 backdrop-blur-sm rounded-xl border border-purple-500/20 p-6">
              <h3 className="text-lg font-bold text-white mb-4">
                Payment Options
              </h3>

              <div className="space-y-3">
                <div>
                  <div className="text-sm text-gray-400 mb-2">
                    You can pay with any supported token:
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {Object.keys(SUPPORTED_TOKENS).map((token) => (
                      <span
                        key={token}
                        className="px-2 py-1 bg-purple-600/20 border border-purple-500/30 rounded text-purple-300 text-sm"
                      >
                        {token}
                      </span>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="text-sm text-gray-400 mb-2">
                    Supported Networks:
                  </div>
                  <div className="space-y-2">
                    {Object.entries(SUPPORTED_TOKENS).map(([token, config]) => (
                      <div key={token} className="text-sm">
                        <span className="text-gray-300">{token}:</span>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {Object.keys(config.contractAddresses).map(
                            (chainId) => (
                              <span
                                key={chainId}
                                className="px-2 py-1 bg-slate-700/50 border border-slate-600 rounded text-gray-300 text-xs"
                              >
                                {getChainName(Number(chainId))}
                              </span>
                            )
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-4 p-3 bg-blue-900/20 border border-blue-500/30 rounded-lg">
                  <div className="text-sm text-blue-300">
                    <strong>Publisher receives:</strong>{" "}
                    {agent.payment_preferences.payout_token} on{" "}
                    {agent.payment_preferences.payout_network}
                  </div>
                  <div className="text-xs text-blue-400 mt-1">
                    Your payment will be automatically converted if needed
                  </div>
                </div>
              </div>
            </div>

            {/* Permit Modal */}
            <PermitModal
              isOpen={showPermitSetup}
              onClose={() => setShowPermitSetup(false)}
              costPerCall={agent.price_per_call_usd}
              agentId={agent.id}
              onPermitCreated={handlePermitCreated}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
