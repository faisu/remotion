"use client";

import { Player } from "@remotion/player";
import { useCallback, useMemo, useRef, useState } from "react";
import { DynamicComp } from "../../remotion/DynamicComp";
import {
  DYNAMIC_VIDEO_FPS,
  DYNAMIC_VIDEO_HEIGHT,
  DYNAMIC_VIDEO_WIDTH,
  DynamicVideoProps,
  getDynamicDurationInSeconds,
} from "../../../types/video-schema";
import type { z } from "zod";

type DynamicProps = z.infer<typeof DynamicVideoProps>;

type RenderState =
  | { status: "idle" }
  | { status: "rendering"; phase: string; progress: number }
  | { status: "done"; url: string; size: number; props: DynamicProps };

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  renderState?: RenderState;
  videoProps?: DynamicProps;
};

type ChatEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_start"; name: string; input: Record<string, unknown> }
  | { type: "render_progress"; phase: string; progress: number }
  | { type: "render_done"; url: string; size: number }
  | { type: "render_error"; message: string }
  | { type: "done" }
  | { type: "error"; message: string };

function appendDeltaWithSpacing(existing: string, incoming: string): string {
  if (!existing || !incoming) return existing + incoming;
  const lastChar = existing[existing.length - 1];
  const firstChar = incoming[0];
  const needsSpace =
    !/\s/.test(lastChar) &&
    !/\s/.test(firstChar) &&
    /[A-Za-z0-9.!?)]/.test(lastChar) &&
    /[A-Za-z0-9(]/.test(firstChar);

  return needsSpace ? `${existing} ${incoming}` : existing + incoming;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ProgressBar({ progress }: { progress: number }) {
  return (
    <div className="w-full bg-white/10 rounded-full h-1.5 overflow-hidden">
      <div
        className="h-full bg-indigo-400 rounded-full transition-all duration-300"
        style={{ width: `${Math.round(progress * 100)}%` }}
      />
    </div>
  );
}

function VideoCard({
  renderState,
  videoProps,
}: {
  renderState: RenderState;
  videoProps?: DynamicProps;
}) {
  if (renderState.status === "idle") return null;

  const parsedProps = videoProps ?? DynamicVideoProps.parse({});
  const durationInFrames = Math.round(
    getDynamicDurationInSeconds(parsedProps) * DYNAMIC_VIDEO_FPS
  );

  return (
    <div className="mt-3 rounded-xl overflow-hidden border border-white/10 bg-white/5">
      {renderState.status === "rendering" && (
        <div className="p-4">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-2 h-2 bg-indigo-400 rounded-full animate-pulse" />
            <span className="text-sm text-white/70">{renderState.phase}</span>
            <span className="text-xs text-white/40 ml-auto">
              {Math.round(renderState.progress * 100)}%
            </span>
          </div>
          <ProgressBar progress={renderState.progress} />
          {/* Live preview using player */}
          <div className="mt-3 rounded-lg overflow-hidden">
            <div className="px-3 py-2 text-xs text-white/60 bg-black/20 border-b border-white/10">
              Mode: <span className="text-white/85">{parsedProps.mode}</span> • Scenes:{" "}
              <span className="text-white/85">{parsedProps.scenes.length}</span>
            </div>
            <Player
              component={DynamicComp}
              inputProps={parsedProps}
              durationInFrames={durationInFrames}
              fps={DYNAMIC_VIDEO_FPS}
              compositionHeight={DYNAMIC_VIDEO_HEIGHT}
              compositionWidth={DYNAMIC_VIDEO_WIDTH}
              style={{ width: "100%" }}
              controls
              autoPlay
              loop
            />
          </div>
        </div>
      )}

      {renderState.status === "done" && (
        <div className="p-4">
          <div className="rounded-lg overflow-hidden mb-3">
            <div className="px-3 py-2 text-xs text-white/60 bg-black/20 border-b border-white/10">
              Mode: <span className="text-white/85">{parsedProps.mode}</span> • Scenes:{" "}
              <span className="text-white/85">{parsedProps.scenes.length}</span>
            </div>
            <Player
              component={DynamicComp}
              inputProps={parsedProps}
              durationInFrames={durationInFrames}
              fps={DYNAMIC_VIDEO_FPS}
              compositionHeight={DYNAMIC_VIDEO_HEIGHT}
              compositionWidth={DYNAMIC_VIDEO_WIDTH}
              style={{ width: "100%" }}
              controls
              autoPlay
              loop
            />
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-green-400 rounded-full" />
              <span className="text-sm text-white/70">
                Rendered • {formatBytes(renderState.size)}
              </span>
            </div>
            <a
              href={renderState.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors flex items-center gap-1"
            >
              Download MP4
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
              </svg>
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

function getVideoImprovementSuggestions(props: DynamicProps): { label: string; prompt: string }[] {
  const suggestions: { label: string; prompt: string }[] = [];
  const topic = props.topic || props.title;

  if (props.style !== "cinematic") {
    suggestions.push({
      label: "Make it cinematic",
      prompt: `Update the video about "${topic}": switch to cinematic style with dramatic colors while keeping the same content`,
    });
  }
  if (props.style !== "bold") {
    suggestions.push({
      label: "Make it bolder",
      prompt: `Update the video about "${topic}": switch to bold style with high-contrast colors while keeping the same content`,
    });
  }
  if (props.scenes.length < 8) {
    suggestions.push({
      label: "Add more scenes",
      prompt: `Update the video about "${topic}": expand to 8+ detailed scenes with more depth on each subtopic`,
    });
  }
  if (props.mode !== "narrated") {
    suggestions.push({
      label: "Switch to narrated",
      prompt: `Update the video about "${topic}": switch to narrated mode with longer, more descriptive scene text`,
    });
  }
  suggestions.push({
    label: "Change color palette",
    prompt: `Update the video about "${topic}": use a completely different color palette while keeping the same content and structure`,
  });
  suggestions.push({
    label: "Improve imagery",
    prompt: `Update the video about "${topic}": enhance all scene image prompts to be more vivid and cinematic, and use image-based layouts`,
  });

  return suggestions.slice(0, 4);
}

function MessageBubble({
  message,
  isLatest,
  onSendSuggestion,
  isLoading,
}: {
  message: Message;
  isLatest: boolean;
  onSendSuggestion: (text: string) => void;
  isLoading: boolean;
}) {
  const isUser = message.role === "user";
  const showSuggestions =
    isLatest &&
    !isUser &&
    !isLoading &&
    message.renderState?.status === "done" &&
    message.videoProps;

  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : "flex-row"}`}>
      <div
        className={`w-8 h-8 rounded-full shrink-0 flex items-center justify-center text-xs font-semibold ${
          isUser ? "bg-indigo-600 text-white" : "bg-white/10 text-white/70"
        }`}
      >
        {isUser ? "U" : "AI"}
      </div>
      <div className={`max-w-[75%] ${isUser ? "items-end" : "items-start"} flex flex-col`}>
        <div
          className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
            isUser
              ? "bg-indigo-600 text-white rounded-tr-sm"
              : "bg-white/10 text-white/90 rounded-tl-sm"
          }`}
        >
          {message.content ? (
            <div className="whitespace-pre-wrap">{message.content}</div>
          ) : (
            <span className="flex gap-1 py-0.5">
              <span className="w-1.5 h-1.5 bg-white/50 rounded-full animate-bounce [animation-delay:0ms]" />
              <span className="w-1.5 h-1.5 bg-white/50 rounded-full animate-bounce [animation-delay:150ms]" />
              <span className="w-1.5 h-1.5 bg-white/50 rounded-full animate-bounce [animation-delay:300ms]" />
            </span>
          )}
        </div>
        {message.renderState && message.renderState.status !== "idle" && (
          <div className="w-full max-w-lg mt-1">
            <VideoCard
              renderState={message.renderState}
              videoProps={message.videoProps}
            />
          </div>
        )}
        {showSuggestions && message.videoProps && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {getVideoImprovementSuggestions(message.videoProps).map((s) => (
              <button
                key={s.label}
                onClick={() => onSendSuggestion(s.prompt)}
                className="text-xs px-2.5 py-1 rounded-full border border-indigo-500/30 text-indigo-300 hover:text-indigo-200 hover:border-indigo-400/50 hover:bg-indigo-500/10 transition-all"
              >
                {s.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "Hi! I'm Claude, powered by Anthropic. I can chat with you and generate dynamic videos using Remotion. Try asking me to create a video — for example: \"Make a video about space exploration\" or \"Create a bold tech announcement video\".",
    },
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const sendWithText = useCallback(async (text: string) => {
    if (!text || isLoading) return;

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: "user",
      content: text,
    };

    const assistantId = `assistant-${Date.now()}`;
    const assistantMessage: Message = {
      id: assistantId,
      role: "assistant",
      content: "",
    };

    setMessages((prev) => [...prev, userMessage, assistantMessage]);
    setInput("");
    setIsLoading(true);

    const history = messages
      .filter((m) => m.id !== "welcome")
      .map((m) => ({ role: m.role, content: m.content }));
    history.push({ role: "user", content: text });

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: history }),
      });

      if (!response.ok || !response.body) {
        throw new Error("Failed to connect to chat API");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let currentVideoProps: DynamicProps | undefined;

      const updateAssistant = (updater: (msg: Message) => Message) => {
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? updater(m) : m))
        );
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const event = JSON.parse(line.slice(6)) as ChatEvent;

          switch (event.type) {
            case "text_delta":
              updateAssistant((m) => ({
                ...m,
                content: appendDeltaWithSpacing(m.content, event.text),
              }));
              scrollToBottom();
              break;

            case "tool_start":
              if (event.name === "generate_video") {
                const parsed = DynamicVideoProps.safeParse(event.input);
                currentVideoProps = parsed.success
                  ? parsed.data
                  : DynamicVideoProps.parse({ title: String(event.input.title ?? "Video") });

                updateAssistant((m) => ({
                  ...m,
                  videoProps: currentVideoProps,
                  renderState: { status: "rendering", phase: "Starting...", progress: 0 },
                }));
                scrollToBottom();
              }
              break;

            case "render_progress":
              updateAssistant((m) => ({
                ...m,
                renderState: {
                  status: "rendering",
                  phase: event.phase,
                  progress: event.progress,
                },
              }));
              break;

            case "render_done":
              updateAssistant((m) => ({
                ...m,
                renderState: {
                  status: "done",
                  url: event.url,
                  size: event.size,
                  props: currentVideoProps ?? DynamicVideoProps.parse({}),
                },
              }));
              scrollToBottom();
              break;

            case "render_error":
              updateAssistant((m) => ({
                ...m,
                renderState: { status: "idle" },
                content:
                  m.content +
                  (m.content ? "\n\n" : "") +
                  `Sorry, there was an error rendering the video: ${event.message}`,
              }));
              break;

            case "error":
              updateAssistant((m) => ({
                ...m,
                content: m.content || `Error: ${event.message}`,
              }));
              break;

            case "done":
              break;
          }
        }
      }
    } catch (err) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, content: `Error: ${(err as Error).message}` }
            : m
        )
      );
    } finally {
      setIsLoading(false);
      inputRef.current?.focus();
    }
  }, [isLoading, messages, scrollToBottom]);

  const sendMessage = useCallback(() => {
    sendWithText(input.trim());
  }, [input, sendWithText]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const suggestedPrompts = [
    "Create a bold video about AI advancements",
    "Make a minimal video: '2024 Year in Review'",
    "Generate a cinematic video about the ocean",
    "Create a tech startup announcement video",
  ];

  const MAX_CONTEXT_CHARS = 32_000;
  const contextUsed = useMemo(
    () =>
      messages
        .filter((m) => m.id !== "welcome")
        .reduce((sum, m) => sum + m.content.length, 0),
    [messages],
  );
  const contextPct = Math.min(100, Math.round((contextUsed / MAX_CONTEXT_CHARS) * 100));
  const contextWarning = contextPct >= 80;

  return (
    <div className="flex flex-col h-screen bg-[#0f172a] text-white">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="white">
              <path d="M15 10l4.553-2.276A1 1 0 0121 8.723v6.554a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
            </svg>
          </div>
          <div>
            <h1 className="font-semibold text-sm">Remotion Chat</h1>
            <p className="text-xs text-white/40">Powered by Claude + Remotion</p>
          </div>
        </div>
        <a
          href="/"
          className="text-xs text-white/40 hover:text-white/70 transition-colors"
        >
          ← Back to Studio
        </a>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
        {messages.map((message, idx) => (
          <MessageBubble
            key={message.id}
            message={message}
            isLatest={idx === messages.length - 1}
            onSendSuggestion={sendWithText}
            isLoading={isLoading}
          />
        ))}

        {/* Suggested prompts - only show when just welcome message */}
        {messages.length === 1 && (
          <div className="flex flex-wrap gap-2 mt-4">
            {suggestedPrompts.map((prompt) => (
              <button
                key={prompt}
                onClick={() => sendWithText(prompt)}
                className="text-xs px-3 py-1.5 rounded-full border border-white/15 text-white/60 hover:text-white/90 hover:border-white/30 transition-all"
              >
                {prompt}
              </button>
            ))}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="px-6 py-4 border-t border-white/10">
        <div className="flex items-end gap-3 bg-white/5 rounded-2xl px-4 py-3 border border-white/10 focus-within:border-indigo-500/50 transition-colors">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask Claude to chat or generate a video..."
            rows={1}
            className="flex-1 bg-transparent text-sm text-white placeholder-white/30 resize-none outline-none leading-6 max-h-32 overflow-y-auto"
            style={{ minHeight: "24px" }}
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || isLoading}
            className="w-8 h-8 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-30 disabled:cursor-not-allowed transition-all flex items-center justify-center shrink-0"
          >
            {isLoading ? (
              <svg
                className="animate-spin"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="white"
                strokeWidth="2"
              >
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
              </svg>
            ) : (
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="white"
                strokeWidth="2.5"
              >
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            )}
          </button>
        </div>
        <div className="flex items-center justify-between mt-2 px-1">
          <p className="text-xs text-white/20">
            Enter to send • Shift+Enter for new line
          </p>
          <div className="flex items-center gap-2">
            <div className="w-16 bg-white/10 rounded-full h-1 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-300 ${
                  contextWarning ? "bg-amber-400" : "bg-white/25"
                }`}
                style={{ width: `${contextPct}%` }}
              />
            </div>
            <span
              className={`text-xs tabular-nums ${
                contextWarning ? "text-amber-400" : "text-white/20"
              }`}
            >
              {contextPct >= 100
                ? "Context full"
                : `${Math.round(contextUsed / 1000)}K / ${MAX_CONTEXT_CHARS / 1000}K`}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
