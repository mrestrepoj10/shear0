import type { Metadata } from "next";
import Link from "next/link";
import { RefBadge } from "@/components/design/status";
import { LEARN_GROUPS, LEARN_TOPICS, topicsInGroup } from "@/components/learn/topics";

export const metadata: Metadata = {
  title: "learn",
  description:
    "Walkthroughs of the ACI 318-19 shear wall provisions, generated from kern's own calculation traces — every step is the engine's real output on a real wall.",
};

/**
 * The walkthrough index.
 *
 * Static: the registry is a module constant and nothing here reads a request,
 * so the whole page is prerendered at build time.
 */
export default function LearnPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">learn</h1>
      <p className="mt-3 max-w-prose font-sans text-sm text-muted-foreground">
        kern&rsquo;s checks are traceable: every number carries the code section, the formula and
        the substituted values that produced it. These walkthroughs are made of that. Each one runs
        the real engine on a real wall — the two MNL-17(21) handbook examples — and shows every step
        it took, expanded. Nothing on these pages is a second implementation of the code; if the
        engine changes, the lesson changes with it.
      </p>
      <p className="mt-3 max-w-prose font-sans text-sm text-muted-foreground">
        {LEARN_TOPICS.length} provisions, in the order a design goes through them.
      </p>

      {LEARN_GROUPS.map((group) => (
        <section key={group.id} className="mt-10">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border pb-2">
            <h2 className="font-mono text-xs tracking-tight text-foreground">{group.title}</h2>
            <span className="font-mono text-[11px] text-muted-foreground">{group.blurb}</span>
          </div>

          <ul className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {topicsInGroup(group.id).map((topic) => (
              <li key={topic.slug} className="min-w-0">
                <Link
                  href={`/learn/${topic.slug}`}
                  className="flex h-full min-w-0 flex-col gap-2 rounded-xl border border-border p-4 transition-colors hover:border-foreground/30 hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  <div className="flex min-w-0 items-baseline gap-2">
                    <span className="min-w-0 flex-1 text-sm">{topic.title}</span>
                    <RefBadge refer={topic.ref} className="shrink-0" />
                  </div>
                  <p className="font-sans text-xs leading-4 text-muted-foreground">
                    {topic.blurb}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <p className="mt-10 max-w-prose font-mono text-[11px] text-muted-foreground">
        the walls behind these pages are MNL-17(21) Shear Wall Examples 1 and 2 — the same fixtures
        the engine&rsquo;s test suite asserts against. Every walkthrough links its wall into{" "}
        <Link href="/design" className="underline underline-offset-2 hover:text-foreground">
          /design
        </Link>
        , where you can change it and watch the trace move.
      </p>
    </div>
  );
}
