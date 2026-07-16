import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("host") ?? "localhost:3000";
  const protocol = host.includes("localhost") ? "http" : "https";
  const origin = `${protocol}://${host}`;

  return {
    title: "图片尺寸与文案检查",
    description: "在浏览器本地统一图片尺寸、识别重复文案，并安全写回原文件夹。",
    openGraph: {
      title: "图片尺寸与文案检查",
      description: "本地处理 · 保留原名 · 安全覆盖",
      type: "website",
      images: [{ url: `${origin}/og.png`, width: 1733, height: 909 }],
    },
    twitter: {
      card: "summary_large_image",
      title: "图片尺寸与文案检查",
      description: "本地处理 · 保留原名 · 安全覆盖",
      images: [`${origin}/og.png`],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
