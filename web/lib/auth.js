import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import Credentials from "next-auth/providers/credentials";
import { loadRootEnv } from "./load-env.js";

loadRootEnv();

function providers() {
  const list = [];
  if (process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET) {
    list.push(
      GitHub({
        clientId: process.env.AUTH_GITHUB_ID,
        clientSecret: process.env.AUTH_GITHUB_SECRET,
      }),
    );
  }
  // Dev/local auth: always available when AUTH_DEV_USER is set (default on).
  if (process.env.AUTH_DEV_USER) {
    list.push(
      Credentials({
        id: "dev",
        name: "Dev login",
        credentials: {
          email: { label: "Email", type: "text" },
        },
        async authorize(creds) {
          const email = (creds?.email || process.env.AUTH_DEV_USER || "").trim();
          if (!email) return null;
          // Only allow the configured dev user (or any email when AUTH_DEV_OPEN=1).
          if (process.env.AUTH_DEV_OPEN === "1" || email === process.env.AUTH_DEV_USER) {
            return { id: email, name: email.split("@")[0], email };
          }
          return null;
        },
      }),
    );
  }
  if (!list.length) {
    list.push(
      Credentials({
        id: "dev",
        name: "Dev login",
        credentials: { email: { label: "Email", type: "text" } },
        async authorize() {
          return { id: "dev@local", name: "dev", email: "dev@local" };
        },
      }),
    );
  }
  return list;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: process.env.AUTH_SECRET || "dev-insecure-change-me",
  trustHost: true,
  providers: providers(),
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.uid = user.id || user.email;
        token.email = user.email;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.uid || token.email || session.user.email;
      }
      return session;
    },
  },
});

export function githubOAuthConfigured() {
  return Boolean(process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET);
}

export function devAuthEnabled() {
  return Boolean(process.env.AUTH_DEV_USER) || !githubOAuthConfigured();
}
