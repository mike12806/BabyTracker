import { useEffect, useRef, useState } from "react";
import { Box, ButtonBase, Typography, useMediaQuery } from "@mui/material";
import { keyframes } from "@emotion/react";
import BedtimeIcon from "@mui/icons-material/Bedtime";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import { API_BASE } from "../api/client";
import { boopMessage, childPhotoUrl, detailedAge, greeting, milestone } from "../utils/childMoments";
import type { CategoryColorSet } from "../theme/categoryColors";
import type { Child } from "../types/models";

/** How long a boop line stays before the age line fades back in. */
const BOOP_DURATION_MS = 2200;
/** Long enough for the slowest particle to finish and fade. */
const PARTICLE_LIFETIME_MS = 1200;
const PARTICLES_PER_BOOP = 7;
const PARTICLE_GLYPHS = ["💛", "✨", "💫", "🩵", "⭐️"];

// The ring around a sleeping baby breathes, slowly, roughly at a settled
// infant's rate. It is the only thing on the page that moves on its own.
const breathe = keyframes`
  0%, 100% { transform: scale(1); opacity: 0.85; }
  50% { transform: scale(1.045); opacity: 1; }
`;

const squish = keyframes`
  0% { transform: scale(1) rotate(0deg); }
  35% { transform: scale(0.92) rotate(-3.5deg); }
  65% { transform: scale(1.06) rotate(2.5deg); }
  100% { transform: scale(1) rotate(0deg); }
`;

const floatUp = keyframes`
  0% { transform: translate(0, 0) scale(0.6); opacity: 0; }
  15% { opacity: 1; }
  100% { transform: translate(var(--drift), -58px) scale(1.05); opacity: 0; }
`;

const fadeSwap = keyframes`
  from { opacity: 0; transform: translateY(3px); }
  to { opacity: 1; transform: translateY(0); }
`;

interface Particle {
  id: number;
  glyph: string;
  drift: string;
  delay: number;
}

interface Props {
  child: Child;
  /** Set while a sleep entry is open, which switches the card to its night look. */
  napping: boolean;
  /** Category palette for the current theme mode, from `buildCategoryColors`. */
  cat: Record<"feed" | "sleep" | "tummy" | "note", CategoryColorSet>;
  isDark: boolean;
  /** Yesterday's blurb, written once a day by the server. Absent until the
   *  first cron run, and simply not rendered when there is none. */
  dailyNote?: string | null;
  /** Whether that blurb came from the model or the deterministic fallback
   *  template. The sparkle only marks the former — a plain template sentence
   *  has no business claiming to be AI-written. */
  dailyNoteSource?: "ai" | "fallback" | null;
  /** Injectable for tests; defaults to the real clock. */
  now?: Date;
}

/**
 * The top of the dashboard: his face, how old he is today, and — if you poke
 * him — a small reward for it. Everything else on this page is a number about
 * a baby; this is the baby.
 */
export default function ChildHero({ child, napping, cat, isDark, dailyNote, dailyNoteSource, now = new Date() }: Props) {
  const reduceMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const [taps, setTaps] = useState(0);
  const [boop, setBoop] = useState<string | null>(null);
  const [particles, setParticles] = useState<Particle[]>([]);
  const [squishing, setSquishing] = useState(false);
  const [photoFailed, setPhotoFailed] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const nextParticleId = useRef(0);

  // Every branch below schedules cleanup work; unmounting mid-boop (switching
  // child, navigating away) must not leave a setState pointed at a dead tree.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach(clearTimeout);
      pending.length = 0;
    };
  }, []);

  const later = (fn: () => void, ms: number) => {
    timers.current.push(setTimeout(fn, ms));
  };

  // A fresh upload for the same child changes the URL, so give it another try.
  const photoUrl = childPhotoUrl(child, API_BASE);
  useEffect(() => {
    setPhotoFailed(false);
  }, [photoUrl]);

  const age = detailedAge(child.birth_date, now);
  const today = milestone(child.birth_date, now);
  const accent = napping ? cat.sleep : today ? cat.feed : cat.tummy;
  const secondAccent = napping ? cat.note : cat.feed;

  const handleBoop = () => {
    setBoop(boopMessage(child.first_name, taps, now));
    setTaps((n) => n + 1);
    later(() => setBoop(null), BOOP_DURATION_MS);

    if (reduceMotion) return;

    setSquishing(true);
    later(() => setSquishing(false), 420);

    const burst = Array.from({ length: PARTICLES_PER_BOOP }, (_, i) => ({
      id: nextParticleId.current++,
      glyph: PARTICLE_GLYPHS[Math.floor(Math.random() * PARTICLE_GLYPHS.length)],
      drift: `${Math.round((Math.random() - 0.5) * 54)}px`,
      delay: i * 45,
    }));
    setParticles((prev) => [...prev, ...burst]);
    const burstIds = new Set(burst.map((p) => p.id));
    later(
      () => setParticles((prev) => prev.filter((p) => !burstIds.has(p.id))),
      PARTICLE_LIFETIME_MS + burst.length * 45,
    );
  };

  const showPhoto = !!photoUrl && !photoFailed;

  return (
    <Box
      sx={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        gap: { xs: 1.5, sm: 2 },
        p: { xs: "10px 12px", sm: "14px 16px" },
        mb: 1.25,
        borderRadius: 2.5,
        border: `1px solid ${accent.edge}`,
        background: `linear-gradient(135deg, ${accent.soft}, ${secondAccent.soft})`,
        overflow: "hidden",
      }}
    >
      <ButtonBase
        onClick={handleBoop}
        aria-label={`${child.first_name} — tap for a little hello`}
        sx={{
          position: "relative",
          flexShrink: 0,
          borderRadius: "50%",
          // The ring: a soft conic sweep of the accent, breathing while he naps.
          "&::before": {
            content: '""',
            position: "absolute",
            inset: -3,
            borderRadius: "50%",
            background: `conic-gradient(from 140deg, ${accent.solid}, ${secondAccent.solid}, ${accent.solid})`,
            opacity: 0.85,
            ...(napping && !reduceMotion && {
              animation: `${breathe} 4.5s ease-in-out infinite`,
            }),
          },
          "&:focus-visible": { outline: `2px solid ${accent.solid}`, outlineOffset: 4 },
        }}
      >
        <Box
          sx={{
            position: "relative",
            width: { xs: 62, sm: 74 },
            height: { xs: 62, sm: 74 },
            borderRadius: "50%",
            overflow: "hidden",
            border: `3px solid ${isDark ? "#161b27" : "#fff"}`,
            bgcolor: accent.solid,
            color: isDark ? "#0c1018" : "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: { xs: 24, sm: 28 },
            fontWeight: 700,
            letterSpacing: "-0.02em",
            ...(squishing && { animation: `${squish} 400ms cubic-bezier(0.34, 1.56, 0.64, 1)` }),
          }}
        >
          {showPhoto ? (
            <Box
              component="img"
              src={photoUrl}
              alt={`${child.first_name}`}
              onError={() => setPhotoFailed(true)}
              sx={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
            />
          ) : (
            child.first_name[0]
          )}
        </Box>
        {napping && (
          <Box
            aria-hidden
            sx={{
              position: "absolute",
              right: -2,
              bottom: -2,
              width: 22,
              height: 22,
              borderRadius: "50%",
              bgcolor: cat.sleep.solid,
              color: isDark ? "#0c1018" : "#fff",
              border: `2px solid ${isDark ? "#161b27" : "#fff"}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <BedtimeIcon sx={{ fontSize: 11 }} />
          </Box>
        )}
        {/* Particles ride above the photo but must never eat the next tap. */}
        <Box aria-hidden sx={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
          {particles.map((p) => (
            <Box
              key={p.id}
              sx={{
                position: "absolute",
                left: "50%",
                top: "10%",
                fontSize: 15,
                lineHeight: 1,
                "--drift": p.drift,
                animation: `${floatUp} ${PARTICLE_LIFETIME_MS}ms ease-out ${p.delay}ms both`,
              }}
            >
              {p.glyph}
            </Box>
          ))}
        </Box>
      </ButtonBase>

      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography
          sx={{
            fontSize: 10.5,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.07em",
            color: accent.ink,
            opacity: 0.85,
            lineHeight: 1.1,
          }}
          noWrap
        >
          {greeting(now)}
        </Typography>
        <Typography
          sx={{
            fontSize: { xs: 19, sm: 22 },
            fontWeight: 700,
            letterSpacing: "-0.025em",
            lineHeight: 1.15,
            mt: 0.125,
          }}
          noWrap
        >
          {child.first_name}
        </Typography>
        {/* One line, two things it can say: the age, or the boop reply. Keyed so
            the swap animates instead of the text silently changing under you. */}
        <Typography
          key={boop ?? "age"}
          sx={{
            fontSize: { xs: 12.5, sm: 13.5 },
            color: boop ? accent.ink : "text.secondary",
            fontWeight: boop ? 700 : 500,
            lineHeight: 1.25,
            mt: 0.25,
            ...(!reduceMotion && { animation: `${fadeSwap} 220ms ease-out` }),
          }}
          noWrap
        >
          {boop ?? age}
        </Typography>
        {dailyNote && !boop && (
          <Box sx={{ display: "flex", alignItems: "flex-start", gap: 0.5, mt: 0.5 }}>
            {dailyNoteSource === "ai" && (
              <AutoAwesomeIcon
                titleAccess="Written by AI"
                sx={{ fontSize: 13, color: cat.tummy.solid, opacity: 0.85, mt: "1px", flexShrink: 0 }}
              />
            )}
            <Typography
              sx={{
                fontSize: { xs: 12, sm: 12.5 },
                color: "text.secondary",
                lineHeight: 1.35,
                // Two lines on a phone, then ellipsis — the card must not grow
                // to fit whatever the model felt like writing.
                display: "-webkit-box",
                WebkitLineClamp: 3,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {dailyNote}
            </Typography>
          </Box>
        )}
        {today && !boop && (
          <Box
            sx={{
              display: "inline-flex",
              alignItems: "center",
              gap: 0.5,
              mt: 0.625,
              px: "8px",
              py: "3px",
              borderRadius: 99,
              bgcolor: isDark ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.72)",
              border: `1px solid ${accent.edge}`,
              maxWidth: "100%",
            }}
          >
            <Box component="span" aria-hidden sx={{ fontSize: 11, lineHeight: 1 }}>
              {today.emoji}
            </Box>
            <Typography
              sx={{ fontSize: 11, fontWeight: 700, color: accent.ink, letterSpacing: "-0.005em" }}
              noWrap
            >
              {today.label}
            </Typography>
          </Box>
        )}
      </Box>
    </Box>
  );
}
