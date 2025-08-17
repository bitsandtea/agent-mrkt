import { Low } from "lowdb";
import { JSONFile } from "lowdb/node";
import path from "path";

export interface Agent {
  id: string;
  publisher_id: string;
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
  updated_at: string;
  total_calls: number;
  total_revenue_usd: number;
  rating: number;
  review_count: number;
}

export interface User {
  id: string;
  wallet_address: string;
  role: string;
  email?: string;
  username?: string;
  api_key: string;
  is_approved: boolean;
  min_balance_usd: number;
  created_at: string;
  updated_at: string;
  wallet_info?: {
    ens_name?: string;
    avatar?: string;
  };
  permit2_approved: boolean;
  preferred_networks: string[];
  preferred_tokens: string[];
}

export interface Subscription {
  id: string;
  user_id: string;
  agent_id: string;
  status: string;
  free_trials_remaining: number;
  free_trials_used: number;
  total_paid_calls: number;
  total_spent_usd: number;
  subscription_date: string;
  last_used: string;
  auto_renew: boolean;
  payment_token: string;
  payment_network: string;
}

export interface Payment {
  id: string;
  user_id: string;
  agent_id: string;
  subscription_id: string;
  amount_usd: number;
  amount_tokens: number;
  token: string;
  network: string;
  transaction_hash: string;
  status: string;
  payment_type: string;
  api_call_id?: string;
  timestamp: string;
  block_number: number;
  gas_used: number;
  gas_price: string;
}

export interface ApiCall {
  id: string;
  user_id: string;
  agent_id: string;
  subscription_id: string;
  endpoint: string;
  method: string;
  parameters: Record<string, unknown>;
  request_timestamp: string;
  response_timestamp: string;
  http_status: number;
  response_time_ms: number;
  is_free_trial: boolean;
  charged_amount_usd: number;
  payment_id?: string;
  error_message?: string;
  user_agent: string;
  ip_address: string;
}

export interface UserPermit {
  id: string;
  userAddress: string;
  token: string;
  chainId: number;
  spenderAddress: string;
  amount: string; // Store as string to avoid BigInt serialization issues
  nonce: string; // Store as string to avoid BigInt serialization issues
  deadline: string; // Store as string to avoid BigInt serialization issues
  signature: {
    r: string;
    s: string;
    v: number;
  };
  status: "active" | "expired" | "revoked";
  createdAt: number;
  expiresAt: number;
  maxCalls: number;
  callsUsed: number;
  costPerCall: number;
}

interface DatabaseSchema {
  users: User[];
  agents: Agent[];
  subscriptions: Subscription[];
  payments: Payment[];
  api_calls: ApiCall[];
  permits: UserPermit[];
  networks: Array<Record<string, unknown>>;
  tokens: Array<Record<string, unknown>>;
}

const dbPath = path.join(process.cwd(), "db.json");
const adapter = new JSONFile<DatabaseSchema>(dbPath);
const db = new Low(adapter, {
  users: [],
  agents: [],
  subscriptions: [],
  payments: [],
  api_calls: [],
  permits: [],
  networks: [],
  tokens: [],
});

export async function getDb() {
  await db.read();
  return db;
}

export async function getAgentById(id: string): Promise<Agent | null> {
  await db.read();
  const agent = db.data.agents.find((a) => a.id === id);
  return agent || null;
}

export async function getAllAgents(): Promise<Agent[]> {
  await db.read();
  return db.data.agents.filter((a) => a.status === "active");
}

export async function getUserById(id: string): Promise<User | null> {
  await db.read();
  const user = db.data.users.find((u) => u.id === id);
  return user || null;
}

export async function getUserByWalletAddress(
  walletAddress: string
): Promise<User | null> {
  await db.read();
  const user = db.data.users.find(
    (u) => u.wallet_address.toLowerCase() === walletAddress.toLowerCase()
  );
  return user || null;
}

// Router-specific database functions
export async function getUsers(): Promise<User[]> {
  await db.read();
  return db.data.users;
}

export async function getAgents(): Promise<Agent[]> {
  await db.read();
  return db.data.agents;
}

export async function getSubscriptions(): Promise<Subscription[]> {
  await db.read();
  return db.data.subscriptions;
}

export async function updateSubscriptionUsage(
  subscriptionId: string,
  isFreeTrial: boolean
): Promise<Subscription | null> {
  await db.read();
  const subscription = db.data.subscriptions.find(
    (s) => s.id === subscriptionId
  );

  if (!subscription) {
    return null;
  }

  if (isFreeTrial) {
    subscription.free_trials_remaining = Math.max(
      0,
      subscription.free_trials_remaining - 1
    );
    subscription.free_trials_used += 1;
  } else {
    subscription.total_paid_calls += 1;
  }

  subscription.last_used = new Date().toISOString();

  await db.write();
  return subscription;
}

export async function createPayment(paymentData: Payment): Promise<Payment> {
  await db.read();
  db.data.payments.push(paymentData);
  await db.write();
  return paymentData;
}

export async function logApiCall(apiCallData: ApiCall): Promise<ApiCall> {
  await db.read();
  db.data.api_calls.push(apiCallData);
  await db.write();
  return apiCallData;
}

export async function createSubscription(
  subscriptionData: Subscription
): Promise<Subscription> {
  await db.read();
  db.data.subscriptions.push(subscriptionData);
  await db.write();
  return subscriptionData;
}

export async function createUser(userData: User): Promise<User> {
  await db.read();
  db.data.users.push(userData);
  await db.write();
  return userData;
}

// Permit database functions
export async function createPermit(
  permitData: UserPermit
): Promise<UserPermit> {
  await db.read();
  db.data.permits.push(permitData);
  await db.write();
  return permitData;
}

export async function getPermitsByUser(
  userAddress: string
): Promise<UserPermit[]> {
  await db.read();
  return db.data.permits.filter(
    (permit) => permit.userAddress.toLowerCase() === userAddress.toLowerCase()
  );
}

export async function getPermitById(id: string): Promise<UserPermit | null> {
  await db.read();
  const permit = db.data.permits.find((p) => p.id === id);
  return permit || null;
}

export async function updatePermitStatus(
  id: string,
  status: "active" | "expired" | "revoked"
): Promise<UserPermit | null> {
  await db.read();
  const permit = db.data.permits.find((p) => p.id === id);

  if (!permit) {
    return null;
  }

  permit.status = status;
  await db.write();
  return permit;
}

export async function getAllPermits(): Promise<UserPermit[]> {
  await db.read();
  return db.data.permits;
}
