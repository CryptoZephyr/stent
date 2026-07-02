"use client";

import { useEffect, useRef } from "react";

/**
 * Hero centerpiece — a living machine-economy network: autonomous agents (left)
 * route calls through the central Stent hub to priced endpoints (right), with
 * payments settling back. Flowing edges + travelling particles carry the motion
 * the reference hero had, scaled up to fill the column. Pure network viz — no
 * character/figure. Sits behind the floating chips and Agent Console.
 *
 * The travelling particles are SMIL (<animateMotion>), which the global CSS
 * `animation: none` reduced-motion kill does NOT stop — so the SVG timeline is
 * paused here explicitly (and the particle dots are hidden in CSS) to give
 * reduced-motion users a fully static graphic.
 */
const HUB = { x: 300, y: 282 };

const AGENTS = [
  { x: 70, y: 120 },
  { x: 56, y: 250 },
  { x: 74, y: 372 },
  { x: 98, y: 474 },
];

const ENDPOINTS = [
  { x: 524, y: 98, label: "arc-stats" },
  { x: 536, y: 214, label: "usdc-volume" },
  { x: 528, y: 332, label: "crypto-news" },
  { x: 510, y: 452, label: "fx.rates" },
];

const agentPath = (a: { x: number; y: number }) =>
  `M${a.x} ${a.y} C ${a.x + 120} ${a.y}, ${HUB.x - 120} ${HUB.y}, ${HUB.x} ${HUB.y}`;
const epPath = (e: { x: number; y: number }) =>
  `M${HUB.x} ${HUB.y} C ${HUB.x + 120} ${HUB.y}, ${e.x - 130} ${e.y}, ${e.x} ${e.y}`;

export function NetworkViz({ className }: { className?: string }) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || typeof svg.pauseAnimations !== "function") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => {
      if (mq.matches) {
        svg.pauseAnimations();
        svg.setCurrentTime(0);
      } else {
        svg.unpauseAnimations();
      }
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  return (
    <svg
      ref={svgRef}
      className={className}
      viewBox="0 0 600 560"
      preserveAspectRatio="xMidYMid slice"
      role="img"
      aria-label="A live network of agents, endpoints, and payment routes"
    >
      <defs>
        <linearGradient id="nv-edge" x1="0" x2="1">
          <stop offset="0" stopColor="#2EE6D6" stopOpacity=".5" />
          <stop offset="1" stopColor="#2EE6D6" stopOpacity=".12" />
        </linearGradient>
        <linearGradient id="nv-edge-back" x1="0" x2="1">
          <stop offset="0" stopColor="#46D483" stopOpacity=".12" />
          <stop offset="1" stopColor="#46D483" stopOpacity=".5" />
        </linearGradient>
        <linearGradient id="nv-dash" x1="0" x2="1">
          <stop offset="0" stopColor="#2EE6D6" stopOpacity="0" />
          <stop offset=".5" stopColor="#2EE6D6" stopOpacity=".6" />
          <stop offset="1" stopColor="#46D483" stopOpacity="0" />
        </linearGradient>
        <radialGradient id="nv-halo" cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#2EE6D6" stopOpacity=".16" />
          <stop offset="1" stopColor="#06080A" stopOpacity="0" />
        </radialGradient>
        <filter id="nv-glow" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="3.2" />
        </filter>
      </defs>

      {/* ambient halo behind the hub */}
      <ellipse cx={HUB.x} cy={HUB.y} rx="250" ry="240" fill="url(#nv-halo)" />

      {/* drifting ambient flow lines (depth) */}
      <path d="M10 70 C 200 50, 330 150, 590 110" fill="none" stroke="url(#nv-dash)" strokeWidth="1.2" strokeDasharray="5 10" className="land-dash" />
      <path d="M14 500 C 200 470, 360 420, 588 470" fill="none" stroke="url(#nv-dash)" strokeWidth="1.2" strokeDasharray="5 12" className="land-dash slow" />

      {/* structural edges: agents → hub */}
      {AGENTS.map((a, i) => (
        <path key={`ae${i}`} id={`nv-ag${i}`} d={agentPath(a)} fill="none" stroke="url(#nv-edge)" strokeWidth="1.5" />
      ))}
      {/* hub → endpoints */}
      {ENDPOINTS.map((e, i) => (
        <path key={`ee${i}`} id={`nv-ep${i}`} d={epPath(e)} fill="none" stroke="url(#nv-edge-back)" strokeWidth="1.5" />
      ))}

      {/* travelling particles: calls (cyan, agent → hub → endpoint) */}
      {AGENTS.map((_, i) => (
        <circle key={`ap${i}`} r="3.2" fill="#2EE6D6" className="land-spark">
          <animateMotion dur="2.6s" begin={`${i * 0.5}s`} repeatCount="indefinite">
            <mpath href={`#nv-ag${i}`} />
          </animateMotion>
        </circle>
      ))}
      {ENDPOINTS.map((_, i) => (
        <circle key={`cp${i}`} r="3.2" fill="#2EE6D6" className="land-spark">
          <animateMotion dur="2.6s" begin={`${0.4 + i * 0.5}s`} repeatCount="indefinite">
            <mpath href={`#nv-ep${i}`} />
          </animateMotion>
        </circle>
      ))}
      {/* payments back (green, endpoint → hub) */}
      {ENDPOINTS.slice(0, 3).map((_, i) => (
        <circle key={`pp${i}`} r="3.2" fill="#46D483" className="land-spark">
          <animateMotion dur="3.2s" begin={`${1 + i * 0.7}s`} repeatCount="indefinite" keyPoints="1;0" keyTimes="0;1">
            <mpath href={`#nv-ep${i}`} />
          </animateMotion>
        </circle>
      ))}

      {/* agent nodes */}
      {AGENTS.map((a, i) => (
        <g key={`an${i}`}>
          <circle cx={a.x} cy={a.y} r="13" fill="#0C1116" stroke="rgba(46,230,214,.5)" strokeWidth="1.4" />
          <circle cx={a.x} cy={a.y} r="4.5" fill="#2EE6D6" filter="url(#nv-glow)" />
        </g>
      ))}

      {/* endpoint nodes + labels */}
      {ENDPOINTS.map((e, i) => (
        <g key={`en${i}`}>
          <rect x={e.x - 13} y={e.y - 13} width="26" height="26" rx="8" fill="#0C1116" stroke="rgba(70,212,131,.5)" strokeWidth="1.4" />
          <rect x={e.x - 4} y={e.y - 4} width="8" height="8" rx="2" fill="#46D483" filter="url(#nv-glow)" />
          <text x={e.x + 22} y={e.y + 4} fill="#919EAA" fontFamily="'Geist Mono', monospace" fontSize="12">
            {e.label}
          </text>
        </g>
      ))}

      {/* central Stent hub */}
      <g>
        <circle cx={HUB.x} cy={HUB.y} r="30" fill="none" stroke="#2EE6D6" strokeOpacity=".6" className="nv-ring" />
        <rect x={HUB.x - 27} y={HUB.y - 27} width="54" height="54" rx="15" fill="#0C1116" stroke="rgba(46,230,214,.55)" strokeWidth="1.5" transform={`rotate(45 ${HUB.x} ${HUB.y})`} />
        <rect x={HUB.x - 11} y={HUB.y - 11} width="22" height="22" rx="5" fill="#2EE6D6" filter="url(#nv-glow)" transform={`rotate(45 ${HUB.x} ${HUB.y})`} />
        <text x={HUB.x} y={HUB.y + 54} fill="#E8EDF1" fontFamily="'Geist Mono', monospace" fontSize="12" textAnchor="middle">
          Stent
        </text>
      </g>
    </svg>
  );
}
