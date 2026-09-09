import { notFound } from "next/navigation";
import AppShell from "@/app/AppShell";

export const dynamic = "force-dynamic";

// One optional catch-all route serves the whole app: "/" (dashboard) plus
// /shop, /license, /admin, /settings… so links are shareable and the shell
// never remounts on back/forward. Anything else is a themed 404.
const VALID_TABS = new Set([
  "dashboard",
  "license",
  "shop",
  "admin",
  "addbot",
  "train",
  "settings",
]);

export default async function CatchAllPage({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}) {
  const { slug } = await params;
  if (slug && (slug.length !== 1 || !VALID_TABS.has(slug[0]))) {
    notFound();
  }
  return <AppShell />;
}
