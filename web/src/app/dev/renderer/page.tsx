import { notFound } from "next/navigation";
import { RendererTest } from "./RendererTest";

/** GPU renderer self-test, used by scripts/renderer-test.mjs. Not available in production. */
export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return <RendererTest />;
}
