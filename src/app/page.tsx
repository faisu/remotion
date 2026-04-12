"use client";

import type { NextPage } from "next";
import { useCallback, useEffect, useRef, useState } from "react";

function VideoIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M15 10l4.553-2.276A1 1 0 0121 8.723v6.554a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
    </svg>
  );
}

function SparkleIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="currentColor"
    >
      <path d="M12 2L13.09 8.26L18 6L14.74 10.91L21 12L14.74 13.09L18 18L13.09 15.74L12 22L10.91 15.74L6 18L9.26 13.09L3 12L9.26 10.91L6 6L10.91 8.26L12 2Z" />
    </svg>
  );
}

const EXAMPLE_PROMPTS = [
  {
    text: "Create a cinematic video about space exploration",
    icon: "🚀",
    color: "from-violet-500/20 to-indigo-500/20",
    border: "border-violet-500/20 hover:border-violet-400/40",
  },
  {
    text: "Make a bold tech startup announcement video",
    icon: "⚡",
    color: "from-amber-500/20 to-orange-500/20",
    border: "border-amber-500/20 hover:border-amber-400/40",
  },
  {
    text: "Generate a minimal explainer about quantum computing",
    icon: "🧬",
    color: "from-cyan-500/20 to-teal-500/20",
    border: "border-cyan-500/20 hover:border-cyan-400/40",
  },
  {
    text: "Design a narrated video about climate change solutions",
    icon: "🌍",
    color: "from-emerald-500/20 to-green-500/20",
    border: "border-emerald-500/20 hover:border-emerald-400/40",
  },
];

const WORKFLOW_STEPS = [
  {
    step: "01",
    title: "Describe Your Vision",
    description:
      "Tell the AI what video you want. Be as creative or specific as you like.",
    accent: "text-violet-400",
    bg: "bg-violet-500/10",
    border: "border-violet-500/20",
  },
  {
    step: "02",
    title: "AI Crafts the Scenes",
    description:
      "Claude generates a full storyboard with scenes, imagery, and color palettes.",
    accent: "text-indigo-400",
    bg: "bg-indigo-500/10",
    border: "border-indigo-500/20",
  },
  {
    step: "03",
    title: "Remotion Renders",
    description:
      "Remotion compiles your scenes into a polished, animated MP4 video in seconds.",
    accent: "text-cyan-400",
    bg: "bg-cyan-500/10",
    border: "border-cyan-500/20",
  },
];

const FEATURES = [
  {
    title: "Scene-Based Storytelling",
    description:
      "AI generates structured scenes with titles, body text, bullet points, and image prompts for a cohesive narrative.",
    icon: (
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </svg>
    ),
  },
  {
    title: "Multiple Styles",
    description:
      "Choose from minimal, bold, or cinematic visual styles — each with unique typography, transitions, and color treatments.",
    icon: (
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <circle cx="12" cy="12" r="10" />
        <path d="M12 2a15 15 0 014 10 15 15 0 01-4 10 15 15 0 01-4-10 15 15 0 014-10z" />
        <path d="M2 12h20" />
      </svg>
    ),
  },
  {
    title: "Auto Image Search",
    description:
      "Scenes are enriched with real images sourced from the web, matched to each scene's content for visual impact.",
    icon: (
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <path d="M21 15l-5-5L5 21" />
      </svg>
    ),
  },
  {
    title: "Flexible Duration Modes",
    description:
      "Short, detailed, or narrated — control depth from quick 15-second clips to rich two-minute explainers.",
    icon: (
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    ),
  },
  {
    title: "Web Research Integration",
    description:
      "The AI can search the web for up-to-date facts and data before generating your video, ensuring accuracy.",
    icon: (
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
    ),
  },
  {
    title: "Instant MP4 Export",
    description:
      "Every video renders server-side to a downloadable MP4 file — no local software or plugins required.",
    icon: (
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
    ),
  },
];

function FloatingOrb({
  className,
  delay,
}: {
  className: string;
  delay: number;
}) {
  return (
    <div
      className={`absolute rounded-full blur-3xl opacity-20 animate-pulse ${className}`}
      style={{ animationDelay: `${delay}s`, animationDuration: "4s" }}
    />
  );
}

function AnimatedGrid() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: `linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)`,
          backgroundSize: "60px 60px",
        }}
      />
    </div>
  );
}

function TypewriterText({
  texts,
  className,
}: {
  texts: string[];
  className?: string;
}) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [displayText, setDisplayText] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(null);

  const tick = useCallback(() => {
    const fullText = texts[currentIndex];

    if (!isDeleting) {
      setDisplayText(fullText.slice(0, displayText.length + 1));
      if (displayText.length + 1 === fullText.length) {
        timeoutRef.current = setTimeout(() => setIsDeleting(true), 2000);
        return;
      }
      timeoutRef.current = setTimeout(tick, 50 + Math.random() * 40);
    } else {
      setDisplayText(fullText.slice(0, displayText.length - 1));
      if (displayText.length === 0) {
        setIsDeleting(false);
        setCurrentIndex((prev) => (prev + 1) % texts.length);
        timeoutRef.current = setTimeout(tick, 300);
        return;
      }
      timeoutRef.current = setTimeout(tick, 30);
    }
  }, [currentIndex, displayText, isDeleting, texts]);

  useEffect(() => {
    timeoutRef.current = setTimeout(tick, 100);
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [tick]);

  return (
    <span className={className}>
      {displayText}
      <span className="animate-pulse text-indigo-400">|</span>
    </span>
  );
}

const Home: NextPage = () => {
  return (
    <div className="min-h-screen bg-[#060918] text-white overflow-x-hidden">
      {/* Background effects */}
      <div className="fixed inset-0 pointer-events-none">
        <FloatingOrb
          className="w-[600px] h-[600px] bg-indigo-600 -top-40 -left-40"
          delay={0}
        />
        <FloatingOrb
          className="w-[500px] h-[500px] bg-violet-600 top-1/3 -right-40"
          delay={1.5}
        />
        <FloatingOrb
          className="w-[400px] h-[400px] bg-cyan-600 bottom-20 left-1/4"
          delay={3}
        />
        <AnimatedGrid />
      </div>

      {/* Nav */}
      <nav className="relative z-10 flex items-center justify-between px-6 md:px-12 py-5 max-w-7xl mx-auto">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-linear-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <VideoIcon className="w-[18px] h-[18px] text-white" />
          </div>
          <span className="font-semibold text-lg tracking-tight">
            Remotion<span className="text-indigo-400">AI</span>
          </span>
        </div>
        <div className="flex items-center gap-4">
          <a
            href="https://bridgeit.in"
            target="_blank"
            rel="noreferrer"
            className="text-sm text-white/40 hover:text-white/70 transition-colors hidden sm:block"
          >
            by Bridgeit.in
          </a>
          <a
            href="/chat"
            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 px-5 py-2.5 text-sm font-medium transition-all hover:shadow-lg hover:shadow-indigo-500/25 active:scale-[0.98]"
          >
            <SparkleIcon className="w-4 h-4" />
            Start Creating
          </a>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative z-10 max-w-5xl mx-auto px-6 md:px-12 pt-20 md:pt-32 pb-16 md:pb-24 text-center">
        <div className="inline-flex items-center gap-2 rounded-full bg-white/5 border border-white/10 px-4 py-1.5 mb-8">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500" />
          </span>
          <span className="text-xs text-white/60 font-medium">
            AI-Powered Video Generation
          </span>
        </div>

        <h1 className="text-4xl sm:text-5xl md:text-7xl font-bold tracking-tight leading-[1.1] mb-6">
          Turn words into{" "}
          <span className="bg-linear-to-r from-indigo-400 via-violet-400 to-cyan-400 bg-clip-text text-transparent">
            stunning videos
          </span>
        </h1>

        <p className="text-lg md:text-xl text-white/50 max-w-2xl mx-auto mb-4 leading-relaxed">
          Describe any topic and watch as AI writes the script, sources imagery,
          and Remotion renders a polished animated video — all in seconds.
        </p>

        <div className="h-8 mb-10 flex items-center justify-center">
          <span className="text-white/30 text-sm mr-2">Try:</span>
          <TypewriterText
            texts={[
              "Make a video about black holes",
              "Create a startup pitch for an AI product",
              "Explain blockchain in 30 seconds",
              "Design a cinematic nature documentary intro",
            ]}
            className="text-sm text-white/50"
          />
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <a
            href="/chat"
            className="group relative inline-flex items-center gap-2.5 rounded-2xl bg-linear-to-r from-indigo-600 to-violet-600 px-8 py-4 text-base font-semibold transition-all hover:shadow-xl hover:shadow-indigo-500/30 active:scale-[0.98]"
          >
            <VideoIcon className="w-5 h-5" />
            Generate Your First Video
            <svg
              className="w-4 h-4 transition-transform group-hover:translate-x-0.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </a>
          <a
            href="https://github.com/nicholasgriffintn/remotion"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-2xl bg-white/5 border border-white/10 px-6 py-4 text-sm font-medium text-white/70 hover:text-white hover:bg-white/10 transition-all"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
            </svg>
            View on GitHub
          </a>
        </div>
      </section>

      {/* Video Preview Mock */}
      <section className="relative z-10 max-w-4xl mx-auto px-6 md:px-12 pb-24">
        <div className="relative rounded-2xl overflow-hidden border border-white/10 bg-linear-to-b from-white/5 to-transparent backdrop-blur-sm">
          <div className="flex items-center gap-2 px-5 py-3.5 border-b border-white/10 bg-white/2">
            <div className="flex gap-1.5">
              <div className="w-3 h-3 rounded-full bg-white/10" />
              <div className="w-3 h-3 rounded-full bg-white/10" />
              <div className="w-3 h-3 rounded-full bg-white/10" />
            </div>
            <div className="flex-1 flex justify-center">
              <div className="text-xs text-white/30 bg-white/5 rounded-lg px-4 py-1">
                remotion-ai.vercel.app/chat
              </div>
            </div>
          </div>
          <div className="p-6 md:p-8">
            <div className="flex gap-3 mb-6">
              <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-xs text-white/50 shrink-0">
                AI
              </div>
              <div className="rounded-2xl rounded-tl-sm bg-white/10 px-4 py-3 text-sm text-white/70 max-w-md">
                I&apos;ll create a cinematic video about the Solar System. Let
                me build the scenes with stunning imagery...
              </div>
            </div>
            <div className="rounded-xl overflow-hidden border border-white/10 bg-[#0f172a] max-w-lg ml-11">
              <div className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
                <div className="w-2 h-2 bg-green-400 rounded-full" />
                <span className="text-xs text-white/50">
                  Mode: cinematic • 8 scenes
                </span>
              </div>
              <div className="aspect-video bg-linear-to-br from-indigo-900 via-violet-900 to-slate-900 flex items-center justify-center relative">
                <div className="text-center">
                  <div className="text-2xl md:text-3xl font-bold bg-linear-to-r from-indigo-300 to-cyan-300 bg-clip-text text-transparent mb-2">
                    The Solar System
                  </div>
                  <div className="text-xs text-white/40">
                    A journey through our cosmic neighborhood
                  </div>
                </div>
                <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/10">
                  <div className="h-full w-1/3 bg-indigo-500 rounded-r" />
                </div>
              </div>
              <div className="px-4 py-2.5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <svg
                    className="text-white/40"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                  >
                    <polygon points="5 3 19 12 5 21 5 3" />
                  </svg>
                  <span className="text-xs text-white/30">0:08 / 0:24</span>
                </div>
                <span className="text-xs text-indigo-400">Download MP4</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="relative z-10 max-w-5xl mx-auto px-6 md:px-12 pb-24">
        <div className="text-center mb-14">
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-4">
            How it works
          </h2>
          <p className="text-white/40 max-w-lg mx-auto">
            From idea to rendered video in three simple steps
          </p>
        </div>
        <div className="grid md:grid-cols-3 gap-6">
          {WORKFLOW_STEPS.map((step) => (
            <div
              key={step.step}
              className={`relative rounded-2xl border ${step.border} ${step.bg} p-6 md:p-8 transition-all hover:scale-[1.02]`}
            >
              <span
                className={`text-5xl font-black ${step.accent} opacity-20 absolute top-4 right-6`}
              >
                {step.step}
              </span>
              <h3 className="text-lg font-semibold mb-2">{step.title}</h3>
              <p className="text-sm text-white/50 leading-relaxed">
                {step.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Features Grid */}
      <section className="relative z-10 max-w-5xl mx-auto px-6 md:px-12 pb-24">
        <div className="text-center mb-14">
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-4">
            Built for creativity
          </h2>
          <p className="text-white/40 max-w-lg mx-auto">
            Every feature designed to help you produce professional-quality
            videos effortlessly
          </p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {FEATURES.map((feature) => (
            <div
              key={feature.title}
              className="group rounded-2xl border border-white/6 bg-white/2 p-6 hover:bg-white/4 hover:border-white/10 transition-all"
            >
              <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 mb-4 group-hover:bg-indigo-500/15 transition-colors">
                {feature.icon}
              </div>
              <h3 className="font-semibold mb-2">{feature.title}</h3>
              <p className="text-sm text-white/40 leading-relaxed">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Example Prompts */}
      <section className="relative z-10 max-w-5xl mx-auto px-6 md:px-12 pb-24">
        <div className="text-center mb-14">
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-4">
            Try these prompts
          </h2>
          <p className="text-white/40 max-w-lg mx-auto">
            Click any prompt to jump straight into the AI chat and generate a
            video
          </p>
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          {EXAMPLE_PROMPTS.map((prompt) => (
            <a
              key={prompt.text}
              href={`/chat?prompt=${encodeURIComponent(prompt.text)}`}
              className={`group flex items-start gap-4 rounded-2xl border ${prompt.border} bg-linear-to-r ${prompt.color} p-5 transition-all hover:scale-[1.01] active:scale-[0.99]`}
            >
              <span className="text-2xl mt-0.5">{prompt.icon}</span>
              <div>
                <p className="text-sm font-medium text-white/80 group-hover:text-white transition-colors">
                  {prompt.text}
                </p>
                <span className="text-xs text-white/30 mt-1 inline-flex items-center gap-1">
                  Click to try
                  <svg
                    className="w-3 h-3 transition-transform group-hover:translate-x-0.5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
                </span>
              </div>
            </a>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="relative z-10 max-w-3xl mx-auto px-6 md:px-12 pb-32">
        <div className="relative rounded-3xl overflow-hidden">
          <div className="absolute inset-0 bg-linear-to-r from-indigo-600/30 via-violet-600/30 to-cyan-600/30" />
          <div className="absolute inset-0 bg-[#060918]/60 backdrop-blur-xl" />
          <div className="relative px-8 md:px-14 py-14 text-center">
            <h2 className="text-2xl md:text-3xl font-bold mb-3">
              Ready to create your first video?
            </h2>
            <p className="text-white/40 mb-8 max-w-md mx-auto text-sm">
              No editing skills needed. Just describe what you want and let AI +
              Remotion handle the rest.
            </p>
            <a
              href="/chat"
              className="group inline-flex items-center gap-2.5 rounded-2xl bg-white text-[#060918] px-8 py-4 text-base font-semibold transition-all hover:shadow-xl hover:shadow-white/10 active:scale-[0.98]"
            >
              <SparkleIcon className="w-5 h-5" />
              Start Generating
              <svg
                className="w-4 h-4 transition-transform group-hover:translate-x-0.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
              >
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </a>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-white/6 py-8 px-6 md:px-12">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg bg-linear-to-br from-indigo-500 to-violet-600 flex items-center justify-center">
              <VideoIcon className="w-3 h-3 text-white" />
            </div>
            <span className="text-sm text-white/30">
              Remotion<span className="text-white/50">AI</span>
            </span>
          </div>
          <p className="text-xs text-white/20">
            Powered by{" "}
            <a
              href="https://bridgeit.in"
              target="_blank"
              rel="noreferrer"
              className="text-white/30 hover:text-white/50 transition-colors"
            >
              Bridgeit.in
            </a>
            {" · "}
            Built with{" "}
            <a
              href="https://www.remotion.dev"
              target="_blank"
              rel="noreferrer"
              className="text-white/30 hover:text-white/50 transition-colors"
            >
              Remotion
            </a>
            {" & "}
            <a
              href="https://www.anthropic.com"
              target="_blank"
              rel="noreferrer"
              className="text-white/30 hover:text-white/50 transition-colors"
            >
              Claude
            </a>
          </p>
        </div>
      </footer>
    </div>
  );
};

export default Home;
