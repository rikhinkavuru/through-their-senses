import { PersonShell } from "@/components/PersonShell";

export default async function PersonLayout({ children, params }: LayoutProps<"/p/[id]">) {
  const { id } = await params;
  return <PersonShell id={id}>{children}</PersonShell>;
}
