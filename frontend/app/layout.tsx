import type { Metadata } from "next";
import "./globals.css";
import { WalletProvider } from "@/lib/wallet";
import { Nav } from "@/components/Nav";

export const metadata: Metadata = {
  title: "Prediction Market",
  description: "Collateral-backed binary prediction markets on Ethereum testnet",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <WalletProvider>
          <Nav />
          <main>
            <div className="container">{children}</div>
          </main>
        </WalletProvider>
      </body>
    </html>
  );
}
