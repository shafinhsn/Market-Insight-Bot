import React, { useState, useEffect, useRef, useCallback } from "react";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Slider } from "@/components/ui/slider";
import {
  Activity, BarChart2, CheckCircle2, ExternalLink, Play, RefreshCw,
  ShieldAlert, ShieldCheck, Square, Target, Terminal,
  TrendingDown, TrendingUp, Zap, Mic,
} from "lucide-react";

const GLOBAL_STYLES = `
  @keyframes agentBounce {
    0%, 100% { transform: translateY(0px); }
    50%       { transform: translateY(-5px); }
  }
  @keyframes agentFlash {
    0%   { filter: brightness(4) saturate(0); }
    100% { filter: brightness(1) saturate(1); }
  }
  @keyframes agentIdle {
    0%, 100% { opacity: 0.85; }
    50%       { opacity: 0.55; }
  }
  @keyframes hpPulse {
    0%, 100% { opacity: 1; }
    50%       { opacity: 0.6; }
  }
  @keyframes scanlines {
    0%   { background-position: 0 0; }
    100% { background-position: 0 4px; }
  }
  @keyframes tickerScroll {
    0%   { transform: translateX(0); }
    100% { transform: translateX(-50%); }
  }
  @keyframes roundFlash {
    0%   { transform: scale(0.7); opacity: 0; color: #00ff41; }
    50%  { transform: scale(1.3); }
    100% { transform: scale(1);   opacity: 1; }
  }
  @keyframes countdownPulse {
    0%, 100% { opacity: 1; }
    50%       { opacity: 0.4; }
  }
  @keyframes cursorBlink {
    0%, 100% { opacity: 1; }
    50%       { opacity: 0; }
  }
  .arena-scanlines::after {
    content: '';
    position: absolute; inset: 0; pointer-events: none; z-index: 10;
    background: repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.04) 2px, rgba(0,0,0,0.04) 4px);
    animation: scanlines 0.2s linear infinite;
  }
  .round-counter { animation: roundFlash 0.5s ease-out forwards; }
  .countdown-pulse { animation: countdownPulse 1s ease-in-out infinite; }
  .cursor::after { content: '_'; animation: cursorBlink 1s ease-in-out infinite; }
`;

// ─── Types ────────────────────────────────────────────────────────────────────
const analysisSchema = z.object({
  budget: z.coerce.number().min(100),
  riskLevel: z.enum(["conservative", "moderate", "aggressive"]),
  stopLossPercent: z.coerce.number().min(1).max(50),
  focusSectors: z.string().optional(),
  focusTickers: z.string().optional(),
});
type AnalysisFormValues = z.infer<typeof analysisSchema>;
type RunParams = {
  budget: number; riskLevel: string; stopLossPercent: number;
  focusSectors?: string[]; focusTickers?: string[];
};

interface OptionPick {
  ticker: string; optionType: "call" | "put"; strike: number; expiration: string;
  contractCost: number; contracts: number; totalCost: number; targetReturn: number; stopLoss: number;
  currentStockPrice?: number; entryOptionPrice?: number; targetStockPrice?: number;
  targetOptionPrice?: number; stopLossStockPrice?: number; daysToExpiration?: number;
  compositeScore: number; optionsFlowScore?: number; newsScore?: number; legislativeScore?: number;
  justification: string; confidence: "low" | "medium" | "high"; sector?: string; keyDrivers?: string[];
}
interface AgentMessage { agentName: string; agentRole: string; message: string; timestamp: string; }
interface NewsSource {
  title: string; source: string; url: string; publishedAt: string;
  sentiment: string; impactScore: number; relatedTickers: string[]; sector: string;
}
interface BillSource {
  id: string; title: string; level: string; state: string | null; status: string;
  passageProbability: number; marketImpactScore: number; affectedSectors: string[];
  affectedTickers: string[]; summary: string; lastAction: string | null; introducedDate?: string | null;
}
interface FlowSource {
  ticker: string; contractType: string; strike: number; expiration: string;
  volume: number; openInterest: number; premium: number; impliedVolatility: number;
  sentiment: string; unusualActivity: boolean; unusualScore?: number;
}
interface PoliticalSource {
  speaker: string; statement: string; date: string; source: string;
  url: string; tickers: string[]; sectors: string[]; sentiment: string; marketImpact: number;
}

interface StreamState {
  phase: "idle" | "fetching" | "running" | "done" | "error";
  agents: AgentMessage[];
  currentAgentName: string | null;
  currentAgentRole: string | null;
  news: NewsSource[];
  bills: BillSource[];
  optionsFlow: FlowSource[];
  politicalStatements: PoliticalSource[];
  recommendations: OptionPick[];
  marketContext: string;
  scoringWeights: { optionsFlow: number; news: number; legislative: number; technicalMomentum: number } | null;
  generatedAt: string | null;
  error: string | null;
  loopCount: number;
  countdown: number | null;
}

// ─── Agent config — 9 agents ──────────────────────────────────────────────────
const AGENTS = [
  { key: "flow",   name: "Alex Chen",      role: "options_flow_analyst", label: "FLOW ANALYST",   color: "#22d3ee", glow: "#22d3ee40" },
  { key: "news",   name: "Morgan Lee",     role: "news_analyst",         label: "NEWS ANALYST",   color: "#fbbf24", glow: "#fbbf2440" },
  { key: "legis",  name: "Jordan Rivera",  role: "legislative_analyst",  label: "LEGISLATIVE",    color: "#a855f7", glow: "#a855f740" },
  { key: "pol",    name: "Dana Voss",      role: "political_analyst",    label: "POLITICAL",      color: "#ec4899", glow: "#ec489940" },
  { key: "factA",  name: "Sam Park",       role: "fact_checker_alpha",   label: "FACT CHECK α",   color: "#34d399", glow: "#34d39940" },
  { key: "factB",  name: "Dr. Torres",     role: "fact_checker_beta",    label: "FACT CHECK β",   color: "#2dd4bf", glow: "#2dd4bf40" },
  { key: "delib",  name: "Deliberation",   role: "synthesis",            label: "DEBATE BOARD",   color: "#fbbf24", glow: "#fbbf2440" },
  { key: "risk",   name: "Riley Morgan",   role: "risk_manager",         label: "RISK MANAGER",   color: "#f97316", glow: "#f9731640" },
  { key: "fresh",  name: "Kai Nakamura",   role: "freshness_validator",  label: "FRESHNESS",      color: "#00ff41", glow: "#00ff4140" },
] as const;

// ─── Pixel Sprites ────────────────────────────────────────────────────────────
type SpriteDef = { rows: string[]; pal: Record<string, string> };
const SPRITE_DEFS: Record<string, SpriteDef> = {
  flow:  { pal: { H:"#475569",s:"#fde68a",B:"#155e75",A:"#22d3ee",b:"#083344" }, rows: ["..HHHHHH..","..HssssH..","..Hs..sH..","..HssssH..","....ss....","BBBBBBBBBB","BABBBBABBB","BBBABBABBB","BABBBBABBB","BBBBBBBBBB","....bb.bb.","..bbb.bbb."] },
  news:  { pal: { H:"#92400e",s:"#fde68a",B:"#78350f",A:"#fbbf24",N:"#fef9c3",b:"#3b1505" }, rows: ["..HHHHHH..","..HssssH..","..Hs..sH..","..HssssH..","....ss....","BBBBBBBBBB","BNNNNABBBB","BNNNNABBBB","BNNNNABBBB","BBBBBBBBBB","....bb.bb.","..bbb.bbb."] },
  legis: { pal: { H:"#312e81",s:"#fde68a",B:"#2e1065",A:"#c084fc",P:"#fef3c7",b:"#1e0a40" }, rows: ["..HHHHHH..","..HssssH..","..Hs..sH..","..HssssH..","....ss....","BBBBBBBBBB","BPPPPABBBB","BPPPBABBBB","BPPPPABBBB","BBBBBBBBBB","....bb.bb.","..bbb.bbb."] },
  pol:   { pal: { H:"#831843",s:"#fde68a",B:"#500724",A:"#ec4899",M:"#fce7f3",b:"#1a0010" }, rows: ["..HHHHHH..","..HssssH..","..Hs..sH..","..HssssH..","....ss....","BBBBBBBBBB","BMMMMABBBB","BMMMMABBBB","BMMMMABBBB","BBBBBBBBBB","....bb.bb.","..bbb.bbb."] },
  factA: { pal: { H:"#374151",s:"#fde68a",B:"#052e16",A:"#34d399",b:"#021209" }, rows: ["..HHHHHH..","..HssssH..","..Hs..sH..","..HssssH..","....ss....","BBBBBBBBBB","BBAABBBBBB","BAAAAABBBB","BBAABABBBB","BBBBBBBBBB","....bb.bb.","..bbb.bbb."] },
  factB: { pal: { H:"#0f172a",s:"#fde68a",B:"#083344",A:"#2dd4bf",W:"#f0fdfa",b:"#021218" }, rows: ["..HHHHHH..","..HssssH..","..Hs..sH..","..HssssH..","....ss....","WWWWWWWWWW","WBBBBBBBBW","WBWWWWWBBW","WBBBBBBABW","WWWWWWWWWW","....bb.bb.","..bbb.bbb."] },
  delib: { pal: { H:"#92400e",s:"#fde68a",B:"#451a03",A:"#fbbf24",b:"#1c0a02" }, rows: ["..HHHHHH..","..HssssH..","..Hs..sH..","..HssssH..","....ss....","BBBBBBBBBB","BAABABAABB","BAAAAAABBB","BABABAAABB","BBBBBBBBBB","....bb.bb.","..bbb.bbb."] },
  risk:  { pal: { H:"#7c2d12",s:"#fde68a",B:"#431407",A:"#fb923c",b:"#1c0902" }, rows: ["..HHHHHH..","..HssssH..","..Hs..sH..","..HssssH..","....ss....","AAAAAAAAAA","ABABAAABBA","BAABABAABB","ABABAABBBA","AAAAAAAAAA","....bb.bb.","..bbb.bbb."] },
  fresh: { pal: { B:"#052e16",A:"#00ff41",C:"#4ade80",b:"#030f07" }, rows: ["..BBBBBB..","BBBBBBBBBB","BBBAABBBB.","BBBBBBBBBB","..BCACBB..","BBBBBBBBBB","BABABABABB","BBAABABABB","BABABABABB","BBBBBBBBBB","....bb.bb.","..bbb.bbb."] },
};

function PixelSprite({ agentKey }: { agentKey: string }) {
  const def = SPRITE_DEFS[agentKey] ?? SPRITE_DEFS.fresh;
  const scale = 3;
  const cols = def.rows[0].length;
  const rows = def.rows.length;
  const rects: React.ReactNode[] = [];
  def.rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (ch !== ".") {
        const color = def.pal[ch];
        if (color) rects.push(<rect key={`${x}-${y}`} x={x * scale} y={y * scale} width={scale} height={scale} fill={color} />);
      }
    });
  });
  return <svg width={cols * scale} height={rows * scale} style={{ imageRendering: "pixelated", display: "block" }}>{rects}</svg>;
}

// ─── Streaming Hook ───────────────────────────────────────────────────────────
function useStreamingAnalysis() {
  const [state, setState] = useState<StreamState>({
    phase: "idle", agents: [], currentAgentName: null, currentAgentRole: null,
    news: [], bills: [], optionsFlow: [], politicalStatements: [],
    recommendations: [], marketContext: "", scoringWeights: null,
    generatedAt: null, error: null, loopCount: 0, countdown: null,
  });
  const abortRef = useRef<AbortController | null>(null);
  const continuousRef = useRef(false);
  const lastParamsRef = useRef<RunParams | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const runRef = useRef<((p: RunParams) => void) | null>(null);

  const stop = useCallback(() => {
    continuousRef.current = false;
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
    abortRef.current?.abort();
    setState(s => ({ ...s, countdown: null }));
  }, []);

  const toggleContinuous = useCallback((val: boolean) => {
    continuousRef.current = val;
    if (!val && countdownRef.current) {
      clearInterval(countdownRef.current); countdownRef.current = null;
      setState(s => ({ ...s, countdown: null }));
    }
  }, []);

  const run = useCallback(async (params: RunParams) => {
    lastParamsRef.current = params;
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setState(s => ({
      ...s, phase: "fetching", agents: [], currentAgentName: null, currentAgentRole: null,
      news: [], bills: [], optionsFlow: [], politicalStatements: [],
      recommendations: [], marketContext: "", scoringWeights: null,
      generatedAt: null, error: null, countdown: null, loopCount: s.loopCount,
    }));

    function startCountdown() {
      if (!continuousRef.current || !lastParamsRef.current) return;
      let secs = 15;
      setState(s => ({ ...s, countdown: secs }));
      countdownRef.current = setInterval(() => {
        secs--;
        if (secs <= 0) {
          clearInterval(countdownRef.current!); countdownRef.current = null;
          setState(s => ({ ...s, countdown: null, loopCount: s.loopCount + 1 }));
          if (continuousRef.current && lastParamsRef.current && runRef.current) runRef.current(lastParamsRef.current);
        } else {
          setState(s => ({ ...s, countdown: secs }));
        }
      }, 1000);
    }

    function handleEvent(evt: Record<string, unknown>) {
      const type = evt.type as string;
      if (type === "data_fetched") {
        setState(s => ({
          ...s,
          news: (evt.news as NewsSource[]) ?? [],
          bills: (evt.bills as BillSource[]) ?? [],
          optionsFlow: (evt.optionsFlow as FlowSource[]) ?? [],
          politicalStatements: (evt.politicalStatements as PoliticalSource[]) ?? [],
        }));
      } else if (type === "agent_start") {
        setState(s => ({ ...s, phase: "running", currentAgentName: evt.agentName as string, currentAgentRole: evt.agentRole as string }));
      } else if (type === "agent_complete") {
        setState(s => ({
          ...s, currentAgentName: null, currentAgentRole: null,
          agents: [...s.agents, {
            agentName: evt.agentName as string, agentRole: evt.agentRole as string,
            message: evt.message as string, timestamp: new Date().toISOString(),
          }],
        }));
      } else if (type === "synthesis_start") {
        setState(s => ({ ...s, currentAgentName: "Kai Nakamura", currentAgentRole: "freshness_validator" }));
      } else if (type === "synthesis_complete") {
        setState(s => ({
          ...s, phase: "done", currentAgentName: null, currentAgentRole: null,
          recommendations: (evt.recommendations as OptionPick[]) ?? [],
          marketContext: (evt.marketContext as string) ?? "",
          scoringWeights: evt.scoringWeights as StreamState["scoringWeights"],
          generatedAt: evt.generatedAt as string,
        }));
        startCountdown();
      } else if (type === "error") {
        setState(s => ({ ...s, phase: "error", error: (evt.message as string) ?? "Analysis failed" }));
      }
    }

    try {
      const base = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
      const response = await fetch(`${base}/api/recommendations/analyze`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params), signal: abortRef.current.signal,
      });
      if (!response.ok || !response.body) {
        const err = await response.json().catch(() => ({ error: "Unknown error" })) as { error?: string };
        setState(s => ({ ...s, phase: "error", error: err.error ?? "Request failed" })); return;
      }
      setState(s => ({ ...s, phase: "running" }));
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try { handleEvent(JSON.parse(line.slice(6)) as Record<string, unknown>); } catch (_) {}
        }
      }
      setState(s => s.phase === "running" ? { ...s, phase: "done" } : s);
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") return;
      setState(s => ({ ...s, phase: "error", error: "Connection error. Try again." }));
    }
  }, []);

  useEffect(() => { runRef.current = run; }, [run]);
  return { state, run, stop, toggleContinuous };
}

// ─── Agent Card ───────────────────────────────────────────────────────────────
function AgentCard({ agent, completedMsg, isRunning, isDone, agentIndex }: {
  agent: typeof AGENTS[number];
  completedMsg?: string;
  isRunning: boolean;
  isDone: boolean;
  agentIndex: number;
}) {
  const color = agent.color;
  const isActive = isRunning || isDone;
  const hpFill = isDone ? 100 : isRunning ? 65 : 0;

  const spriteStyle: React.CSSProperties = isRunning
    ? { animation: "agentBounce 0.55s ease-in-out infinite" }
    : isDone
    ? { animation: "agentFlash 0.4s ease-out forwards" }
    : { animation: "agentIdle 3s ease-in-out infinite", animationDelay: `${agentIndex * 0.4}s` };

  return (
    <div
      className="relative flex flex-col gap-2 p-2 rounded-none transition-all duration-300"
      style={{
        border: `2px solid ${isActive ? color : `${color}25`}`,
        background: isActive ? `${color}08` : "#0d1117",
        boxShadow: isRunning ? `0 0 0 1px ${color}60, 0 0 20px ${color}25` : isDone ? `0 0 0 1px ${color}30` : "none",
        opacity: isActive ? 1 : 0.45,
      }}
    >
      <div className="flex items-start gap-2">
        <div style={spriteStyle} className="shrink-0 mt-0.5">
          <PixelSprite agentKey={agent.key} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="h-1.5 mb-1.5 rounded-none" style={{ background: "#1c2128" }}>
            <div
              className="h-full transition-all duration-700 rounded-none"
              style={{ width: `${hpFill}%`, background: color, animation: isRunning ? "hpPulse 0.8s ease-in-out infinite" : "none" }}
            />
          </div>
          <div className="font-mono font-black text-xs leading-none mb-0.5" style={{ color: isActive ? color : `${color}70` }}>
            {agent.name.split(" ")[0].toUpperCase()}
          </div>
          <div className="font-mono text-[9px] leading-none mb-1" style={{ color: `${color}70` }}>
            {agent.label}
          </div>
          <div className="font-mono text-[9px]">
            {isRunning ? (
              <span style={{ color }} className="cursor">▶ WORKING</span>
            ) : isDone ? (
              <span className="text-emerald-400">✓ DONE</span>
            ) : (
              <span style={{ color: "#374151" }}>○ STANDBY</span>
            )}
          </div>
        </div>
      </div>
      {isDone && completedMsg && (
        <p className="text-[9px] leading-snug font-mono line-clamp-2 border-t pt-1" style={{ color: `${color}80`, borderColor: `${color}20` }}>
          {completedMsg.slice(0, 100)}{completedMsg.length > 100 ? "…" : ""}
        </p>
      )}
    </div>
  );
}

// ─── Agent Arena ─────────────────────────────────────────────────────────────
function AgentArena({ state }: { state: StreamState }) {
  const completedNames = new Set(state.agents.map(a => a.agentName));
  return (
    <div className="arena-scanlines relative">
      <div className="grid grid-cols-3 gap-2">
        {AGENTS.map((agent, i) => {
          const isDone = completedNames.has(agent.name);
          const isRunning = state.currentAgentName === agent.name;
          const msg = state.agents.find(a => a.agentName === agent.name)?.message;
          return (
            <AgentCard key={agent.key} agent={agent} agentIndex={i}
              completedMsg={msg} isRunning={isRunning} isDone={isDone} />
          );
        })}
      </div>
    </div>
  );
}

// ─── Flow Ticker ─────────────────────────────────────────────────────────────
function FlowTicker({ flow }: { flow: FlowSource[] }) {
  if (!flow.length) return null;
  const items = [...flow, ...flow];
  return (
    <div className="relative overflow-hidden border-y py-1.5" style={{ height: 30, borderColor: "#1c2128", background: "rgba(0,0,0,0.6)" }}>
      <div
        className="flex gap-6 whitespace-nowrap"
        style={{ animation: `tickerScroll ${Math.max(20, flow.length * 3)}s linear infinite`, width: "200%" }}
      >
        {items.map((f, i) => {
          const isBull = f.sentiment === "bullish";
          const score = f.unusualScore ?? 0;
          return (
            <span key={i} className="inline-flex items-center gap-1.5 text-[11px] font-mono">
              {f.unusualActivity && <span className="text-yellow-400">⚡</span>}
              <span className="font-black" style={{ color: isBull ? "#22d3ee" : "#f87171" }}>{f.ticker}</span>
              <span style={{ color: isBull ? "#34d399" : "#f87171" }}>{f.contractType.toUpperCase()}</span>
              <span className="text-gray-500">${f.strike}</span>
              <span className="text-gray-600">Vol:{f.volume.toLocaleString()}</span>
              <span className="text-gray-700">|</span>
              {score > 5 && <span className="text-yellow-500 text-[9px]">UNUSUAL</span>}
            </span>
          );
        })}
      </div>
    </div>
  );
}

// ─── Debate Log ──────────────────────────────────────────────────────────────
function DebateLog({ agents }: { agents: AgentMessage[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [agents.length]);

  const agentColor = (role: string) => {
    const a = AGENTS.find(ag => ag.role === role);
    return a?.color ?? "#6b7280";
  };

  return (
    <div
      ref={scrollRef}
      className="flex-1 overflow-y-auto space-y-2 p-3 font-mono text-[11px]"
      style={{ maxHeight: 240, background: "#050a0f", borderTop: "2px solid #1c2128" }}
    >
      {agents.length === 0 && (
        <div className="text-gray-600 text-center py-6">DEBATE LOG EMPTY — AWAITING AGENTS</div>
      )}
      {agents.map((log, i) => {
        const color = agentColor(log.agentRole);
        return (
          <div key={i} className="flex gap-2">
            <span className="shrink-0 font-black" style={{ color }}>{log.agentName.split(" ")[0].toUpperCase()}&gt;</span>
            <span className="text-gray-400 leading-snug">{log.message.slice(0, 300)}{log.message.length > 300 ? "…" : ""}</span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Recommendation Card ──────────────────────────────────────────────────────
function RecommendationCard({ rec, rank }: { rec: OptionPick; rank: number }) {
  const isBull = rec.optionType === "call";
  const accentColor = isBull ? "#34d399" : "#f87171";
  return (
    <div
      className="relative overflow-hidden"
      style={{
        border: `2px solid ${rank === 0 ? "#00ff41" : "#1c2128"}`,
        background: "#0d1117",
        boxShadow: rank === 0 ? "0 0 0 1px #00ff4130, 0 0 20px #00ff4115" : "none",
      }}
    >
      {rank === 0 && (
        <div className="absolute top-0 left-0 right-0 h-0.5" style={{ background: "linear-gradient(90deg, #00ff41, transparent)" }} />
      )}
      <div className="flex">
        <div className="p-3 w-28 shrink-0 border-r flex flex-col items-center justify-center text-center" style={{ borderColor: "#1c2128", background: "#050a0f" }}>
          {rank === 0 && <div className="text-[9px] font-mono font-black text-green-400 mb-1"># TOP PICK</div>}
          <div className="text-3xl font-black font-mono tracking-tighter" style={{ color: accentColor }}>{rec.ticker}</div>
          <div className="font-mono text-[10px] font-bold mt-1" style={{ color: accentColor }}>{rec.optionType.toUpperCase()}</div>
          <div className="font-mono text-[10px] text-gray-500">${rec.strike}</div>
          <div className="font-mono text-[9px] text-gray-600 mt-1">
            {new Date(rec.expiration).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" })}
          </div>
          {rec.sector && <div className="text-[9px] text-gray-600 mt-1">{rec.sector}</div>}
        </div>

        <div className="p-3 flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-2xl font-black font-mono" style={{ color: accentColor }}>{rec.compositeScore}</span>
            <span className="text-[9px] font-mono text-gray-500 uppercase">composite</span>
            <div className="flex gap-2 ml-auto">
              {rec.optionsFlowScore != null && <span className="text-[9px] font-mono text-cyan-400">FLOW:{rec.optionsFlowScore}</span>}
              {rec.newsScore != null && <span className="text-[9px] font-mono text-amber-400">NEWS:{rec.newsScore}</span>}
              {rec.legislativeScore != null && <span className="text-[9px] font-mono text-violet-400">LEGIS:{rec.legislativeScore}</span>}
            </div>
            <span className="text-[9px] font-mono font-bold uppercase px-1.5 py-0.5" style={{ border: `1px solid ${accentColor}50`, color: accentColor }}>
              {rec.confidence}
            </span>
          </div>
          <p className="text-xs text-gray-400 leading-relaxed mb-2">{rec.justification}</p>
          {rec.keyDrivers && rec.keyDrivers.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {rec.keyDrivers.map((d, j) => (
                <span key={j} className="text-[9px] font-mono px-1.5 py-0.5 text-gray-500" style={{ border: "1px solid #1c2128" }}>{d}</span>
              ))}
            </div>
          )}
        </div>

        <div className="p-3 w-36 shrink-0 border-l space-y-2" style={{ borderColor: "#1c2128", background: "#050a0f" }}>
          {rec.currentStockPrice != null && (
            <div className="space-y-1">
              <div className="text-[9px] font-mono text-gray-600 uppercase">Stock</div>
              <div className="flex justify-between text-[10px] font-mono">
                <span className="text-gray-500">Now</span>
                <span className="text-gray-200">${rec.currentStockPrice.toFixed(2)}</span>
              </div>
              {rec.targetStockPrice != null && (
                <div className="flex justify-between text-[10px] font-mono">
                  <span className="flex items-center gap-0.5 text-emerald-400"><TrendingUp className="w-2.5 h-2.5" />Tgt</span>
                  <span className="text-emerald-400">${rec.targetStockPrice.toFixed(2)}</span>
                </div>
              )}
              {rec.stopLossStockPrice != null && (
                <div className="flex justify-between text-[10px] font-mono">
                  <span className="flex items-center gap-0.5 text-red-400"><TrendingDown className="w-2.5 h-2.5" />Stop</span>
                  <span className="text-red-400">${rec.stopLossStockPrice.toFixed(2)}</span>
                </div>
              )}
            </div>
          )}
          <div className="border-t pt-1" style={{ borderColor: "#1c2128" }}>
            <div className="text-[9px] font-mono text-gray-600 uppercase mb-1">Contract</div>
            <div className="flex justify-between text-[10px] font-mono">
              <span className="text-gray-500">In</span><span className="text-gray-200">${(rec.entryOptionPrice ?? rec.contractCost).toFixed(2)}</span>
            </div>
            {rec.targetOptionPrice != null && (
              <div className="flex justify-between text-[10px] font-mono">
                <span className="text-emerald-400">Out</span><span className="text-emerald-400">${rec.targetOptionPrice.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between text-[10px] font-mono">
              <span className="text-red-400">Stop</span><span className="text-red-400">${rec.stopLoss.toFixed(2)}</span>
            </div>
          </div>
          <div className="border-t pt-1" style={{ borderColor: "#1c2128" }}>
            <div className="flex justify-between text-[10px] font-mono">
              <span className="text-gray-500">Size</span><span className="text-gray-200">{rec.contracts}×</span>
            </div>
            <div className="flex justify-between text-[10px] font-mono">
              <span className="text-gray-500">Cost</span><span className="text-gray-200">${rec.totalCost.toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-[10px] font-mono font-black">
              <span style={{ color: accentColor }}>Return</span><span style={{ color: accentColor }}>+{rec.targetReturn}%</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Live Sources Panel ───────────────────────────────────────────────────────
function LiveSourcesPanel({
  news, bills, flow, political,
}: { news: NewsSource[]; bills: BillSource[]; flow: FlowSource[]; political: PoliticalSource[] }) {
  if (!news.length && !bills.length && !flow.length && !political.length) return null;
  const sentCls = (s: string) => s === "positive" || s === "bullish" ? "text-emerald-400" : s === "negative" || s === "bearish" ? "text-red-400" : "text-gray-500";
  return (
    <div style={{ border: "2px solid #1c2128", background: "#0d1117" }}>
      <div className="px-3 py-2 flex items-center gap-2 border-b font-mono text-[10px]" style={{ borderColor: "#1c2128" }}>
        <Activity className="w-3 h-3 text-amber-400" />
        <span className="text-gray-500 uppercase tracking-widest">Live Data Sources</span>
        <span className="ml-auto text-gray-600">{flow.length} flow · {news.length} news · {bills.length} bills · {political.length} political</span>
      </div>
      <Tabs defaultValue="flow">
        <TabsList className="h-7 mx-3 mt-2 bg-black/50 rounded-none gap-0">
          <TabsTrigger value="flow" className="text-[10px] h-6 px-2 font-mono rounded-none">⚡ Flow ({flow.length})</TabsTrigger>
          <TabsTrigger value="news" className="text-[10px] h-6 px-2 font-mono rounded-none">📡 News ({news.length})</TabsTrigger>
          <TabsTrigger value="bills" className="text-[10px] h-6 px-2 font-mono rounded-none">📜 Bills ({bills.length})</TabsTrigger>
          <TabsTrigger value="political" className="text-[10px] h-6 px-2 font-mono rounded-none">🎤 Political ({political.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="flow" className="mt-0">
          <ScrollArea className="h-48">
            <div className="p-3 space-y-1">
              {flow.map((f, i) => {
                const isBull = f.sentiment === "bullish";
                const score = f.unusualScore ?? 0;
                return (
                  <div key={i} className="flex items-center gap-2 px-2 py-1.5 font-mono text-[10px]"
                    style={{ background: f.unusualActivity ? "#22d3ee08" : "transparent", border: f.unusualActivity ? "1px solid #22d3ee20" : "1px solid transparent" }}>
                    {f.unusualActivity && <span className="text-yellow-400">⚡</span>}
                    <span className="font-black w-12 shrink-0" style={{ color: isBull ? "#22d3ee" : "#f87171" }}>{f.ticker}</span>
                    <span style={{ color: isBull ? "#34d399" : "#f87171" }}>{f.contractType.toUpperCase()}</span>
                    <span className="text-gray-600">${f.strike}</span>
                    <span className="text-gray-600">{f.expiration}</span>
                    <span className="ml-auto text-gray-500">Vol:{f.volume.toLocaleString()}</span>
                    <span className="text-gray-600">IV:{(f.impliedVolatility * 100).toFixed(0)}%</span>
                    {score > 5 && <span className="text-yellow-500">score:{score.toFixed(1)}</span>}
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="news" className="mt-0">
          <ScrollArea className="h-48">
            <div className="p-3 space-y-2">
              {news.map((a, i) => (
                <div key={i} className="p-2 font-mono text-[10px]" style={{ border: "1px solid #1c2128" }}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-gray-600">{a.source}</span>
                    <span className={sentCls(a.sentiment)}>{a.sentiment.toUpperCase()}</span>
                    <span className="text-gray-700">{new Date(a.publishedAt).toLocaleDateString()}</span>
                    {a.url && <a href={a.url} target="_blank" rel="noopener noreferrer" className="ml-auto text-primary hover:text-primary/70"><ExternalLink className="w-3 h-3" /></a>}
                  </div>
                  <p className="text-gray-300 leading-snug mb-1">{a.title}</p>
                  {a.relatedTickers.length > 0 && (
                    <div className="flex gap-1 flex-wrap">
                      {a.relatedTickers.map(t => <span key={t} className="px-1 py-0.5 text-cyan-400 bg-cyan-400/10">{t}</span>)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="bills" className="mt-0">
          <ScrollArea className="h-48">
            <div className="p-3 space-y-2">
              {bills.map((b, i) => (
                <div key={i} className="p-2 font-mono text-[10px]" style={{ border: "1px solid #1c2128" }}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className={b.level === "federal" ? "text-violet-400 font-bold" : "text-blue-400 font-bold"}>
                      {b.level === "federal" ? "FEDERAL" : `STATE/${b.state}`}
                    </span>
                    <span className={b.marketImpactScore > 0 ? "text-emerald-400" : "text-red-400"}>
                      impact:{b.marketImpactScore > 0 ? "+" : ""}{b.marketImpactScore}
                    </span>
                    <span className="ml-auto text-gray-600">{b.passageProbability}% pass</span>
                  </div>
                  <p className="text-gray-300 leading-snug mb-1">{b.title}</p>
                  <p className="text-gray-600 leading-snug mb-1">{b.status?.slice(0, 100)}</p>
                  {b.affectedTickers.length > 0 && (
                    <div className="flex gap-1 flex-wrap">
                      {b.affectedTickers.slice(0, 6).map(t => <span key={t} className="px-1 py-0.5 text-violet-400 bg-violet-400/10">{t}</span>)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="political" className="mt-0">
          <ScrollArea className="h-48">
            <div className="p-3 space-y-2">
              {political.length === 0 && (
                <div className="text-gray-600 text-center py-6 text-[10px]">No live statements retrieved from GDELT</div>
              )}
              {political.map((s, i) => (
                <div key={i} className="p-2 font-mono text-[10px]" style={{ border: "1px solid #1c2128" }}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-pink-400 font-bold">{s.speaker.toUpperCase()}</span>
                    <span className={sentCls(s.sentiment)}>{s.sentiment.toUpperCase()}</span>
                    <span className="text-gray-700">{s.date}</span>
                    {s.url && <a href={s.url} target="_blank" rel="noopener noreferrer" className="ml-auto text-primary hover:text-primary/70"><ExternalLink className="w-3 h-3" /></a>}
                  </div>
                  <p className="text-gray-300 leading-snug mb-1">{s.statement}</p>
                  {s.tickers.length > 0 && (
                    <div className="flex gap-1 flex-wrap">
                      {s.tickers.map(t => <span key={t} className="px-1 py-0.5 text-pink-400 bg-pink-400/10">{t}</span>)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function Home() {
  const { state, run, stop, toggleContinuous } = useStreamingAnalysis();
  const [continuous, setContinuous] = useState(false);
  const [prevLoopCount, setPrevLoopCount] = useState(0);
  const isRunning = state.phase === "fetching" || state.phase === "running";
  const totalAgents = AGENTS.length;

  const form = useForm<AnalysisFormValues>({
    resolver: zodResolver(analysisSchema),
    defaultValues: { budget: 5000, riskLevel: "moderate", stopLossPercent: 15, focusSectors: "", focusTickers: "" },
  });

  const handleContinuousToggle = (val: boolean) => {
    setContinuous(val);
    toggleContinuous(val);
  };

  useEffect(() => {
    if (state.loopCount > prevLoopCount) setPrevLoopCount(state.loopCount);
  }, [state.loopCount, prevLoopCount]);

  function onSubmit(values: AnalysisFormValues) {
    run({
      budget: values.budget,
      riskLevel: values.riskLevel,
      stopLossPercent: values.stopLossPercent,
      focusSectors: values.focusSectors?.split(",").map(s => s.trim()).filter(Boolean),
      focusTickers: values.focusTickers?.split(",").map(s => s.trim()).filter(Boolean),
    });
  }

  return (
    <>
      <style>{GLOBAL_STYLES}</style>
      <div className="min-h-screen flex flex-col font-mono" style={{ background: "#050a0f", color: "#e2e8f0" }}>

        {/* ── Header ───────────────────────────────────────────────────────── */}
        <header className="shrink-0 flex items-center justify-between px-4 py-2 border-b" style={{ borderColor: "#1c2128", background: "#0d1117" }}>
          <div className="flex items-center gap-3">
            <Terminal className="w-4 h-4 text-green-400" />
            <span className="font-black tracking-widest text-sm uppercase text-green-400">Market Intel Arena</span>
            <span className="text-[10px] text-gray-600">9-agent pipeline</span>
          </div>
          <div className="flex items-center gap-3">
            {state.loopCount > 0 && (
              <span className="font-mono text-xs font-black text-green-400 round-counter" key={state.loopCount}>
                ROUND {state.loopCount + 1}
              </span>
            )}
            <span className="text-[10px] font-mono" style={{ color: isRunning ? "#22d3ee" : state.phase === "done" ? "#34d399" : "#6b7280" }}>
              {state.phase === "fetching" ? "▶ FETCHING DATA"
                : state.phase === "running" ? `▶ ${state.agents.length}/${totalAgents} AGENTS`
                : state.phase === "done" ? "✓ ANALYSIS DONE"
                : state.phase === "error" ? "✗ ERROR"
                : "○ READY"}
            </span>
            {state.countdown != null && (
              <span className="font-mono text-xs text-yellow-400 countdown-pulse">
                NEXT ROUND IN {state.countdown}s
              </span>
            )}
            <button
              onClick={() => handleContinuousToggle(!continuous)}
              className="flex items-center gap-1.5 text-[10px] font-mono px-2 py-1 transition-all"
              style={{
                border: `1px solid ${continuous ? "#00ff41" : "#374151"}`,
                color: continuous ? "#00ff41" : "#6b7280",
                background: continuous ? "#00ff4110" : "transparent",
              }}
            >
              <RefreshCw className="w-3 h-3" />
              {continuous ? "LOOP ON" : "LOOP OFF"}
            </button>
            {(isRunning || state.countdown != null) && (
              <button
                onClick={stop}
                className="flex items-center gap-1 text-[10px] font-mono px-2 py-1"
                style={{ border: "1px solid #ef4444", color: "#ef4444", background: "#ef444410" }}
              >
                <Square className="w-3 h-3" /> STOP
              </button>
            )}
          </div>
        </header>

        {/* ── Flow Ticker ──────────────────────────────────────────────────── */}
        <FlowTicker flow={state.optionsFlow} />

        {/* ── Main content ─────────────────────────────────────────────────── */}
        <div className="flex-1 flex overflow-hidden">

          {/* LEFT: Arena + Debate */}
          <div className="flex-1 flex flex-col overflow-hidden border-r" style={{ borderColor: "#1c2128" }}>
            <div className="px-4 py-2 flex items-center gap-2 border-b shrink-0" style={{ borderColor: "#1c2128", background: "#080d12" }}>
              <span className="text-[10px] text-gray-500 uppercase tracking-widest">9-Agent Intel Pipeline</span>
              {isRunning && <span className="text-[10px] text-green-400 animate-pulse">● AGENTS ACTIVE</span>}
              {state.phase === "done" && <span className="text-[10px] text-emerald-400">✓ ALL AGENTS COMPLETE</span>}
              <span className="ml-auto text-[9px] text-gray-700">flow → news → legis → political → fact×2 → deliberate → risk → freshness</span>
            </div>

            <div className="p-3 shrink-0" style={{ background: "#050a0f" }}>
              {state.phase === "idle" ? (
                <div className="flex items-center justify-center py-10">
                  <div className="text-center">
                    <div className="text-gray-600 text-sm uppercase tracking-widest mb-2">SYSTEM READY</div>
                    <div className="text-gray-700 text-[11px] mb-1">9-agent multi-source intelligence pipeline</div>
                    <div className="text-gray-700 text-[9px]">Finnhub · NewsAPI · Congress.gov · OpenStates · GDELT · FEC · Yahoo Finance</div>
                  </div>
                </div>
              ) : (
                <AgentArena state={state} />
              )}
            </div>

            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="px-3 py-1.5 border-b border-t shrink-0 flex items-center gap-2" style={{ borderColor: "#1c2128", background: "#080d12" }}>
                <span className="text-[10px] text-gray-500 uppercase tracking-widest">Debate Log</span>
                <span className="text-[10px] text-gray-700">{state.agents.length} transmissions</span>
              </div>
              <DebateLog agents={state.agents} />
            </div>
          </div>

          {/* RIGHT: Form + Results */}
          <div className="w-[420px] shrink-0 flex flex-col overflow-hidden" style={{ background: "#080d12" }}>
            <ScrollArea className="flex-1">
              <div className="p-4 space-y-4">

                {/* Parameters Form */}
                <div style={{ border: "2px solid #1c2128" }}>
                  <div className="px-3 py-2 border-b flex items-center gap-2" style={{ borderColor: "#1c2128", background: "#050a0f" }}>
                    <Target className="w-3 h-3 text-gray-500" />
                    <span className="text-[10px] uppercase tracking-widest text-gray-500">Parameters</span>
                  </div>
                  <div className="p-3">
                    <Form {...form}>
                      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                        <FormField control={form.control} name="budget" render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-[10px] uppercase text-gray-500">Budget (USD)</FormLabel>
                            <FormControl>
                              <div className="relative">
                                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500 text-xs">$</span>
                                <Input type="number" className="pl-6 font-mono text-xs h-8 rounded-none bg-black/50 border-gray-800 text-gray-200" {...field} />
                              </div>
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />

                        <FormField control={form.control} name="riskLevel" render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-[10px] uppercase text-gray-500">Risk Level</FormLabel>
                            <FormControl>
                              <RadioGroup onValueChange={field.onChange} defaultValue={field.value} className="flex gap-2">
                                {[
                                  { v: "conservative", icon: <ShieldAlert className="w-3 h-3 text-emerald-400" />, col: "#34d399" },
                                  { v: "moderate", icon: <BarChart2 className="w-3 h-3 text-amber-400" />, col: "#fbbf24" },
                                  { v: "aggressive", icon: <Zap className="w-3 h-3 text-red-400" />, col: "#f87171" },
                                ].map(({ v, icon, col }) => (
                                  <FormItem key={v} className="flex-1">
                                    <FormControl>
                                      <div className="cursor-pointer" onClick={() => field.onChange(v)}>
                                        <div className="flex flex-col items-center gap-1 py-2 px-1 transition-all"
                                          style={{ border: `1px solid ${field.value === v ? col : "#1c2128"}`, background: field.value === v ? `${col}10` : "transparent" }}>
                                          {icon}
                                          <span className="text-[9px] font-mono capitalize" style={{ color: field.value === v ? col : "#6b7280" }}>{v}</span>
                                          <RadioGroupItem value={v} className="sr-only" />
                                        </div>
                                      </div>
                                    </FormControl>
                                  </FormItem>
                                ))}
                              </RadioGroup>
                            </FormControl>
                          </FormItem>
                        )} />

                        <FormField control={form.control} name="stopLossPercent" render={({ field }) => (
                          <FormItem>
                            <div className="flex justify-between items-center">
                              <FormLabel className="text-[10px] uppercase text-gray-500">Stop Loss</FormLabel>
                              <span className="font-mono text-xs text-gray-300">{field.value}%</span>
                            </div>
                            <FormControl>
                              <Slider min={1} max={50} step={1} defaultValue={[field.value]} onValueChange={v => field.onChange(v[0])} className="pt-1" />
                            </FormControl>
                          </FormItem>
                        )} />

                        <div className="grid grid-cols-2 gap-2">
                          <FormField control={form.control} name="focusSectors" render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-[10px] uppercase text-gray-500">Sectors</FormLabel>
                              <FormControl><Input placeholder="energy, tech…" className="font-mono text-[10px] h-7 rounded-none bg-black/50 border-gray-800 text-gray-300" {...field} /></FormControl>
                            </FormItem>
                          )} />
                          <FormField control={form.control} name="focusTickers" render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-[10px] uppercase text-gray-500">Tickers</FormLabel>
                              <FormControl><Input placeholder="ENPH, PLTR…" className="font-mono text-[10px] h-7 rounded-none bg-black/50 border-gray-800 text-gray-300 uppercase" {...field} /></FormControl>
                            </FormItem>
                          )} />
                        </div>

                        <Button
                          type="submit"
                          disabled={isRunning}
                          className="w-full h-10 rounded-none font-mono font-black text-xs uppercase tracking-widest"
                          style={{
                            background: isRunning ? "#0d1117" : "#00ff41",
                            color: isRunning ? "#374151" : "#050a0f",
                            border: "2px solid #00ff41",
                            boxShadow: isRunning ? "none" : "0 0 20px #00ff4130",
                          }}
                        >
                          {isRunning ? (
                            <span className="flex items-center gap-2">
                              <span className="w-2 h-2 bg-cyan-400 animate-pulse rounded-full" />
                              {state.phase === "fetching" ? "FETCHING ALL SOURCES" : `RUNNING ${state.agents.length}/${totalAgents} AGENTS`}
                            </span>
                          ) : (
                            <span className="flex items-center gap-2">
                              <Play className="w-3 h-3 fill-current" /> DEPLOY 9-AGENT PIPELINE
                            </span>
                          )}
                        </Button>
                      </form>
                    </Form>
                  </div>
                </div>

                {/* Error */}
                {state.phase === "error" && (
                  <div className="p-3 text-[11px] font-mono" style={{ border: "1px solid #ef4444", background: "#ef444410", color: "#f87171" }}>
                    ✗ {state.error}
                  </div>
                )}

                {/* Countdown */}
                {state.countdown != null && (
                  <div className="p-3 text-center font-mono countdown-pulse" style={{ border: "2px solid #fbbf24", background: "#fbbf2408", color: "#fbbf24" }}>
                    <div className="text-2xl font-black mb-1">{state.countdown}</div>
                    <div className="text-[10px] uppercase tracking-widest">Next round launching</div>
                    <div className="text-[9px] text-gray-600 mt-1">Toggle LOOP OFF to stop</div>
                  </div>
                )}

                {/* Scoring weights */}
                {state.scoringWeights && (
                  <div className="flex gap-2 font-mono text-[10px]" style={{ border: "1px solid #1c2128", padding: "6px 10px" }}>
                    <span className="text-gray-600">WEIGHTS:</span>
                    <span className="text-cyan-400">FLOW {Math.round(state.scoringWeights.optionsFlow * 100)}%</span>
                    <span className="text-amber-400">NEWS {Math.round(state.scoringWeights.news * 100)}%</span>
                    <span className="text-violet-400">LEGIS {Math.round(state.scoringWeights.legislative * 100)}%</span>
                  </div>
                )}

                {/* Recommendations */}
                {state.recommendations.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 font-mono text-[10px]">
                      <Target className="w-3 h-3 text-green-400" />
                      <span className="text-gray-500 uppercase tracking-widest">Ranked Opportunities</span>
                      <span className="ml-auto flex items-center gap-1 text-emerald-400">
                        <ShieldCheck className="w-3 h-3" /> 9-Agent Validated
                      </span>
                    </div>
                    {state.recommendations.map((rec, i) => <RecommendationCard key={`${rec.ticker}-${i}`} rec={rec} rank={i} />)}
                  </div>
                )}

                {state.phase === "done" && state.recommendations.length === 0 && (
                  <div className="p-4 text-center font-mono text-[11px]" style={{ border: "1px solid #fbbf24", background: "#fbbf2408", color: "#fbbf24" }}>
                    Analysis complete — freshness validator or fact-checkers invalidated all picks. Try again or broaden parameters.
                  </div>
                )}

                {/* Live Sources */}
                {(state.news.length > 0 || state.bills.length > 0 || state.optionsFlow.length > 0 || state.politicalStatements.length > 0) && (
                  <LiveSourcesPanel
                    news={state.news}
                    bills={state.bills}
                    flow={state.optionsFlow}
                    political={state.politicalStatements}
                  />
                )}

              </div>
            </ScrollArea>
          </div>
        </div>
      </div>
    </>
  );
}
