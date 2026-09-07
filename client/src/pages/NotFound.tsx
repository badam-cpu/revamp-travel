/** Revamp brandbook: the error state uses the same clean wordmark, orange pattern, rounded controls, and direct voice as the marketplace. */
import { ArrowLeft, Compass } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { SiteHeader } from "@/components/SiteHeader";

export default function NotFound() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-paper text-basalt">
      <div className="pointer-events-none absolute -bottom-24 -right-20 text-[18rem] font-bold leading-none tracking-[-0.12em] text-apricot/[0.07]">re.</div>
      <SiteHeader />
      <main className="container grid min-h-[calc(100vh-76px)] place-items-center py-20">
        <div className="max-w-xl text-center">
          <p className="eyebrow">404 · Beyond the mapped road</p>
          <h1 className="mt-5 font-display text-7xl leading-[0.9] tracking-[-0.05em]">A beautiful wrong turn.</h1>
          <p className="mx-auto mt-6 max-w-md text-base leading-7 text-basalt/58">This path isn’t in the current revamp. atlas. Return to the marketplace and choose another way through Armenia.</p>
          <div className="mt-8 flex justify-center gap-3">
            <Button asChild className="rounded-none bg-apricot text-white"><Link href="/explore"><Compass className="mr-2 h-4 w-4" /> Explore places</Link></Button>
            <Button variant="outline" className="rounded-none border-basalt/20 bg-paper" onClick={() => window.history.back()}><ArrowLeft className="mr-2 h-4 w-4" /> Go back</Button>
          </div>
        </div>
      </main>
    </div>
  );
}
