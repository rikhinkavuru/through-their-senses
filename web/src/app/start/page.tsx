import { Suspense } from "react";
import { SetupFlow } from "@/components/setup/SetupFlow";

export const metadata = { title: "Set up a profile · Through Their Senses" };

export default function StartPage() {
  return (
    <Suspense fallback={<main className="grid min-h-dvh place-items-center text-graphite">Loading…</main>}>
      <SetupFlow />
    </Suspense>
  );
}
