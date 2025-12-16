import "./globals.css";

export const metadata = {
  title: "X-Ray Realista em Tecidos (Client-only)",
  description:
    "Simulação física simplificada de transmissão por tecido, 100% no cliente, estável no Vercel.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="h-screen bg-zinc-950 text-zinc-100 antialiased">{children}</body>
    </html>
  );
}
