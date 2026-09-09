"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Logo } from "./Logo";

export default function NotFound() {
  const router = useRouter();
  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden px-4">
      {/* soft glow accents, same treatment as the shop */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute left-1/2 top-[-80px] h-[320px] w-[320px] -translate-x-1/2 rounded-full bg-emerald-500/10 blur-[90px]" />
        <div className="absolute bottom-[8%] right-[10%] h-[220px] w-[220px] rounded-full bg-indigo-600/10 blur-[80px]" />
      </div>

      <div className="w-full max-w-md text-center animate-pop-in">
        <Logo size={52} className="mx-auto" />
        <div className="mt-8 bg-gradient-to-b from-white via-slate-300 to-slate-600 bg-clip-text text-[92px] font-black leading-none text-transparent select-none sm:text-[110px]">
          404
        </div>
        <h1 className="mt-3 text-lg font-bold text-white">Page not found</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-400">
          The page you are looking for doesn&apos;t exist or was moved.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-2">
          <Link
            href="/"
            className="btn-primary rounded-xl bg-emerald-500 px-5 py-2.5 text-sm font-bold text-emerald-950 hover:bg-emerald-400"
          >
            Go to dashboard
          </Link>
          <button
            onClick={() => router.back()}
            className="rounded-xl border border-slate-700 bg-slate-800 px-5 py-2.5 text-sm font-semibold text-slate-200 hover:bg-slate-700"
          >
            Go back
          </button>
        </div>
      </div>
    </main>
  );
}
