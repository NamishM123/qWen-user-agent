import TaskForm from "@/components/TaskForm";
import RunList from "@/components/RunList";
import ShowcaseGallery from "@/components/ShowcaseGallery";
import CompareForm from "@/components/CompareForm";
import { auth } from "@/lib/auth";
import Link from "next/link";

export default async function HomePage() {
  const session = await auth();

  if (!session?.user) {
    return (
      <div className="space-y-10">
        <section className="space-y-3">
          <p className="text-xs font-medium uppercase tracking-wider text-emerald-600">Persona UX research</p>
          <h1 className="text-3xl font-semibold tracking-tight">Watch a demographic user try App A vs B/C</h1>
          <p className="max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
            qWen User Agent is a persona-based competitive UX researcher. A local LLM drives the same jobs in a real browser
            across similar products, then writes evidence-backed feedback and feature suggestions — not generic task automation.
          </p>
          <div className="flex flex-wrap gap-3 pt-1">
            <Link href="/login" className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900">
              Sign in to run research
            </Link>
            <a href="#showcase" className="rounded-md border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800">
              View examples
            </a>
          </div>
        </section>
        <div id="showcase">
          <ShowcaseGallery />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Research dashboard</h1>
        <p className="text-sm text-zinc-500">
          Signed in as {session.user.email || session.user.name}. Start a persona compare, or submit a single browser task.
        </p>
      </div>
      <CompareForm />
      <TaskForm />
      <RunList />
      <div className="border-t border-zinc-200 pt-8 dark:border-zinc-800">
        <ShowcaseGallery />
      </div>
    </div>
  );
}
