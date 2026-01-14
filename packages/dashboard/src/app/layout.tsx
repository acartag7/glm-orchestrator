import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GLM Orchestrator Dashboard",
  description: "Visualize GLM Orchestrator activity in real-time",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="bg-gray-950 text-gray-100 antialiased">
        {children}
      </body>
    </html>
  );
}
