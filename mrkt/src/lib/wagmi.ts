import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { baseSepolia, sepolia } from "wagmi/chains";

export const config = getDefaultConfig({
  appName: "Agent Marketplace",
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_ID || "your-project-id",
  chains: [sepolia, baseSepolia],
  ssr: true,
});
