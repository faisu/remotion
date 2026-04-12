import { Metadata, Viewport } from "next";
import "../../styles/global.css";

export const metadata: Metadata = {
  title: "Bridgeit — AI video generation (Remotion & Claude)",
  description:
    "Describe any topic and watch as AI writes the script, sources imagery, and Bridgeit turns it into a polished animated video — built with Claude and Remotion.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-background">{children}</body>
    </html>
  );
}
