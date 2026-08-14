import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RefBadge } from "@/components/design/status";
import { TopicVisual } from "@/components/learn/topic-visual";
import { TraceWalkthrough } from "@/components/learn/trace-walkthrough";
import { LEARN_TOPICS, learnTopic, type LearnCase } from "@/components/learn/topics";
import { DISCLAIMER_SENTENCE } from "@/lib/copy";
import { encodeWallInput } from "@/lib/wall-codec";
import { fmt, type Demands } from "@kern/engine";

/**
 * One provision, one wall, one engine call, fully expanded.
 *
 * All nine pages are statically generated: the registry is the only source of
 * params, `dynamicParams = false` closes the route to anything else, and the
 * checks run at build time — so the numbers a reader (or a crawler) sees are in
 * the HTML, not produced after hydration.
 */
export function generateStaticParams() {
  return LEARN_TOPICS.map((topic) => ({ slug: topic.slug }));
}

export const dynamicParams = false;

export async function generateMetadata({
  params,
}: PageProps<"/learn/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const topic = learnTopic(slug);
  if (topic === undefined) return {};
  return {
    title: `${topic.title} — ACI 318-19 §${topic.ref.section}`,
    description: `${topic.blurb}. A step-by-step walkthrough of ACI 318-19 §${topic.ref.section}, generated from kern's own calculation trace on a worked example.`,
  };
}

/** The load combination line under a case heading. */
function demandLine(demand: Demands): string {
  return [
    `Pu ${fmt(demand.Pu)} kip`,
    `Mu ${fmt(demand.Mu)} kip-ft`,
    `Vu ${fmt(demand.Vu)} kip`,
  ].join(" · ");
}

function DesignerLink({ item }: { item: LearnCase }) {
  return (
    <Link
      href={`/design?w=${encodeWallInput(item.input)}`}
      className="inline-flex items-center gap-1.5 font-mono text-xs2 text-muted-foreground underline underline-offset-2 transition-colors duration-150 hover:text-foreground"
    >
      open this example in the designer
      <span aria-hidden="true">→</span>
    </Link>
  );
}

export default async function LearnTopicPage({ params }: PageProps<"/learn/[slug]">) {
  const { slug } = await params;
  const topic = learnTopic(slug);
  if (topic === undefined) notFound();

  const cases = topic.cases.map((item) => ({ item, check: item.run(item.input) }));
  const lead = cases[0];

  return (
    <article className="mx-auto max-w-5xl px-4 py-16">
      <Link
        href="/learn"
        className="font-mono text-xs2 text-muted-foreground transition-colors duration-150 hover:text-foreground"
      >
        ← learn
      </Link>

      <header className="mt-3">
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{topic.title}</h1>
          <RefBadge refer={topic.ref} />
        </div>
        <p className="mt-4 max-w-prose font-sans text-sm leading-6 text-muted-foreground">
          {topic.summary}
        </p>
      </header>

      {topic.visual === undefined ? null : (
        <div className="mt-8">
          <TopicVisual
            visual={topic.visual}
            input={lead.item.input}
            {...(lead.item.demand === undefined ? {} : { demand: lead.item.demand })}
            check={lead.check}
          />
        </div>
      )}

      {cases.map(({ item, check }) => (
        // `scroll-mt-16`: the header is sticky and 48 px tall, so a deep link
        // to a case has to clear it.
        <section key={item.id} id={item.id} className="mt-10 min-w-0 scroll-mt-16">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border pb-2">
            <h2 className="font-mono text-xs tracking-tight text-foreground">{item.label}</h2>
            {item.demand === undefined ? null : (
              <span className="font-mono text-xs2 text-muted-foreground">
                {demandLine(item.demand)}
              </span>
            )}
          </div>
          <p className="mt-2 max-w-prose text-xs2 leading-4 text-muted-foreground">
            {item.caption}
          </p>

          <div className="mt-3">
            <TraceWalkthrough
              check={check}
              {...(item.demand === undefined
                ? {}
                : { scope: item.demand.label ?? item.demand.id })}
            />
          </div>

          <div className="mt-2">
            <DesignerLink item={item} />
          </div>
        </section>
      ))}

      <section className="mt-10">
        <h2 className="border-b border-border pb-2 font-mono text-xs tracking-tight text-foreground">
          what to look for in the trace
        </h2>
        <ul className="mt-3 flex max-w-prose list-disc flex-col gap-2 pl-5 font-sans text-sm2 leading-5 text-muted-foreground">
          {topic.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </section>

      <p className="mt-10 max-w-prose font-mono text-xs2 text-muted-foreground">
        every step above is the engine&rsquo;s own output — kern does not restate the code in prose
        and then compute it separately. {DISCLAIMER_SENTENCE}
      </p>
    </article>
  );
}
