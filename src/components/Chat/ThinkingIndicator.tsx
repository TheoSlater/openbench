import React, { useState, useEffect, useMemo, useRef } from "react";
import { Box, Typography, Stack, useTheme } from "@mui/material";
import { styled } from "@mui/material/styles";
import { motion } from "motion/react";
import { ChevronDown, ChevronUp } from "lucide-react";

interface ThinkingIndicatorProps {
  text?: string;
  duration?: number;
  spread?: number;
  isActive?: boolean;
  isExpanded?: boolean;
  thinkingDuration?: number;
}

const ShimmerContainer = styled(Box)({
  display: "inline-flex",
  position: "relative",
  overflow: "hidden",
});

const ThinkingIndicator: React.FC<ThinkingIndicatorProps> = React.memo(
  ({
    text,
    duration = 2,
    spread = 0.5,
    isActive = false,
    isExpanded = false,
    thinkingDuration,
  }) => {
    const theme = useTheme();
    const [seconds, setSeconds] = useState(thinkingDuration || 0);
    const startTimeRef = useRef<number | null>(null);

    useEffect(() => {
      if (thinkingDuration !== undefined && !isActive) {
        setSeconds(thinkingDuration);
      }
    }, [thinkingDuration, isActive]);

    useEffect(() => {
      let interval: NodeJS.Timeout;
      if (isActive) {
        if (startTimeRef.current === null) {
          startTimeRef.current = Date.now();
        }
        interval = setInterval(() => {
          if (startTimeRef.current !== null) {
            setSeconds((Date.now() - startTimeRef.current) / 1000);
          }
        }, 100);
      }
      return () => {
        if (interval) clearInterval(interval);
      };
    }, [isActive]);

    const formattedTime = useMemo(() => {
      if (seconds < 1) return "less than a second";
      if (seconds < 60) {
        return `${Math.floor(seconds)} second${Math.floor(seconds) === 1 ? "" : "s"}`;
      }
      const mins = Math.floor(seconds / 60);
      const secs = Math.floor(seconds % 60);
      return `${mins} minute${mins === 1 ? "" : "s"} ${secs} second${secs === 1 ? "" : "s"}`;
    }, [seconds]);

    const displayIndicator = useMemo(() => {
      if (text) return text;
      if (isActive) return "Thinking...";
      return `Thought for ${formattedTime}`;
    }, [isActive, text, formattedTime]);

    const shimmerGradient = useMemo(() => {
      const baseColor = theme.palette.text.secondary;
      const highlightColor = "rgba(255, 255, 255, 0.8)"; // Bright white shimmer for both modes

      const spreadPct = spread * 100;

      return `linear-gradient(90deg,
        ${baseColor} 0%,
        ${baseColor} ${Math.max(0, 50 - spreadPct / 2)}%,
        ${highlightColor} 50%,
        ${baseColor} ${Math.min(100, 50 + spreadPct / 2)}%,
        ${baseColor} 100%
      )`;
    }, [theme.palette.text.secondary, spread]);

    return (
      <Stack
        direction="row"
        spacing={0.8}
        alignItems="center"
        sx={{
          cursor: "pointer",
          userSelect: "none",
          "&:hover": {
            opacity: 0.8,
          },
        }}
      >
        <ShimmerContainer>
          <motion.div
            animate={
              isActive
                ? {
                    backgroundPosition: ["100% 0", "-100% 0"],
                  }
                : {}
            }
            transition={{
              duration: duration,
              ease: "linear",
              repeat: isActive ? Infinity : 0,
            }}
            style={
              isActive
                ? {
                    backgroundImage: shimmerGradient,
                    backgroundSize: "200% 100%",
                    WebkitBackgroundClip: "text",
                    backgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                    display: "inline-block",
                  }
                : {
                    color: theme.palette.text.secondary,
                    display: "inline-block",
                  }
            }
          >
            <Typography
              variant="body2"
              sx={{
                fontSize: "14px",
                fontWeight: 500,
                color: "inherit",
              }}
            >
              {displayIndicator}
            </Typography>
          </motion.div>
        </ShimmerContainer>

        {isExpanded ? (
          <ChevronUp
            size={16}
            style={{ color: theme.palette.text.secondary }}
          />
        ) : (
          <ChevronDown
            size={16}
            style={{ color: theme.palette.text.secondary }}
          />
        )}
      </Stack>
    );
  },
);

ThinkingIndicator.displayName = "ThinkingIndicator";

export default ThinkingIndicator;
