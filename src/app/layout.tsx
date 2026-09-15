import type { Metadata } from "next";
import { THEME_PRESETS } from "@/lib/theme";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "MC Bot Manager",
  description:
    "Spin up Minecraft bots, watch them join servers, and control their consoles.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Apply the saved theme accent BEFORE first paint (no flash of the
            default). Generated from THEME_PRESETS so it can never drift. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var P=${JSON.stringify(
              THEME_PRESETS.map((p) => ({ id: p.id, ramp: p.ramp })),
            )};var s=localStorage.getItem("mcbm:theme");var p=null;for(var i=0;i<P.length;i++)if(P[i].id===s)p=P[i];if(!p)p=P[0];var F=["emerald","teal","cyan","violet","indigo","fuchsia","purple"];var R=["200","300","400","500","600","700","900","950"];for(var a=0;a<F.length;a++)for(var b=0;b<R.length;b++){var v=p.ramp[R[b]]||p.ramp["500"];document.documentElement.style.setProperty("--color-"+F[a]+"-"+R[b],v);}}catch(e){}})();`,
          }}
        />
      </head>
      <body className="min-h-screen bg-[#070b14] text-slate-100 antialiased">
        <div className="app-bg" aria-hidden />
        {children}
      </body>
    </html>
  );
}
