export default function Home() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">
        Shear walls, by the code.
      </h1>
      <p className="mt-3 max-w-prose text-muted-foreground">
        kern is an open-source shear wall designer built for both learning and
        real design calculations, following ACI 318-19.
      </p>
      <ul className="mt-8 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
        <li>Design — flexure, shear, and boundary element checks per ACI 318-19</li>
        <li>Learn — step-by-step walkthroughs of every equation and provision</li>
        <li>Next.js App Router + shadcn/ui shell</li>
      </ul>
    </div>
  );
}
