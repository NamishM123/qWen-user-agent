import "./globals.css";
import Providers from "@/components/Providers";

export const metadata = {
  title: "qWen User Agent — persona UX research",
  description: "Persona-based competitive UX research with a real browser agent",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <div className="min-h-screen">
            <header className="border-b border-zinc-200 bg-white/80 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/80">
              <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
                <a href="/" className="text-lg font-semibold tracking-tight">
                  qWen User Agent
                </a>
                <nav className="flex gap-3 text-sm text-zinc-600 dark:text-zinc-300">
                  <a href="/" className="hover:underline">
                    Research
                  </a>
                  <a href="/login" className="hover:underline">
                    Login
                  </a>
                </nav>
              </div>
            </header>
            <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
          </div>
        </Providers>
      </body>
    </html>
  );
}
