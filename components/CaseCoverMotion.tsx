"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { motion, useReducedMotion } from "motion/react";

type ViewMode = "birdview" | "snakeview";
type Direction = "forward" | "return";
type TransitionPhase = "preflight" | "landing" | "handoff" | "fallback";
type CoverRectSnapshot = {
  left: number;
  top: number;
  width: number;
  height: number;
};
type TransitionSnapshot = {
  transitionId: string;
  casePath: string;
  homePath: string;
  scrollY: number;
  view: ViewMode;
  sourceCoverRect?: CoverRectSnapshot;
};
type ActiveTransition = TransitionSnapshot & {
  direction: Direction;
  phase: TransitionPhase;
  offscreenReturn?: boolean;
  offscreenMotionStartedAt?: number;
  takeoffStartedAt?: number;
  destinationCoverRect?: CoverRectSnapshot;
};

const storageKey = "case-cover-motion-snapshot";
// Forward motion is intentionally shorter than the separate canonical return.
const forwardTakeoffMs = 280;
const forwardLandingMs = 360;
const forwardMotionMs = forwardTakeoffMs + forwardLandingMs;
const forwardNavigationDelayMs = 16;
const forwardPreparationTimeoutMs = 240;
const forwardPreparationAttempts = 12;
const forwardFallbackMs = 180;
// Let the persistent cover establish visible motion before its asset changes.
// Swapping while its rect is still identical to the homepage card reads as a
// blink when the card and case covers are different images.
const forwardCoverFadeStartMs = 64;
const forwardCoverFadeMs = 80;
const returnOffscreenMotionMs = 180;
const returnCoverLandingMs = 250;
const returnHandoffBufferMs = 16;
const returnLandingMs = returnCoverLandingMs + returnHandoffBufferMs;
const returnOffscreenLandingMs =
  returnOffscreenMotionMs + returnHandoffBufferMs;
const returnNavigationDelayMs = 16;
const returnOffscreenFallbackMs = 1000;
const offscreenReturnStartScale = 1.08;
const forwardHandoffBufferMs = 16;
const forwardTotalMs =
  forwardMotionMs + forwardHandoffBufferMs;
const forwardEase = [0.16, 1, 0.3, 1] as const;
const forwardRevealEase = [0.4, 0, 0.2, 1] as const;
// Keep the copy and body reveal proportionally ahead of the cover's finish,
// so it reads as one landing rather than a second delayed event.
const forwardContentRevealLeadMs = 112;
const forwardContentRevealStartMs =
  forwardTakeoffMs - forwardContentRevealLeadMs;
const forwardContentRevealDurationMs = forwardLandingMs;
const returnEase = [0.12, 1, 0.2, 1] as const;
// The cover lands with the quick iOS-like ease, while the surrounding canvas
// keeps its blur readable until the end of the same landing window.
const returnContextEase = [0.4, 0, 0.6, 1] as const;

function getForwardRevealProgress(rawProgress: number): number {
  const progress = Math.min(1, Math.max(0, rawProgress));
  const elapsedMs = progress * forwardMotionMs;
  const contentRevealProgress =
    (elapsedMs - forwardContentRevealStartMs) / forwardContentRevealDurationMs;

  return cubicBezierProgress(contentRevealProgress, forwardRevealEase);
}

function writeMotionTimelineVars(
  direction: Direction,
  easedProgress: number,
  rawProgress = easedProgress,
): void {
  const root = document.documentElement;
  const progress = Math.min(1, Math.max(0, easedProgress));
  root.style.setProperty("--case-cover-motion-eased", String(progress));

  if (direction === "forward") {
    const revealProgress = getForwardRevealProgress(rawProgress);
    root.style.setProperty(
      "--case-cover-motion-context-opacity",
      String(1 - 0.1 * progress),
    );
    root.style.setProperty(
      "--case-cover-motion-context-blur",
      `${7 * progress}px`,
    );
    root.style.setProperty(
      "--case-cover-motion-context-scale",
      String(1 - 0.1 * progress),
    );
    root.style.setProperty(
      "--case-cover-motion-copy-opacity",
      String(revealProgress),
    );
    root.style.setProperty(
      "--case-cover-motion-copy-blur",
      `${12 * (1 - revealProgress)}px`,
    );
    root.style.setProperty(
      "--case-cover-motion-title-progress",
      `${100 * revealProgress}%`,
    );
    return;
  }

  const contextProgress = cubicBezierProgress(rawProgress, returnContextEase);
  const coverProgress = cubicBezierProgress(rawProgress, returnEase);
  root.style.setProperty(
    "--case-cover-motion-context-opacity",
    String(0.33 + 0.67 * contextProgress),
  );
  root.style.setProperty(
    "--case-cover-motion-context-blur",
    `${18 * (1 - contextProgress)}px`,
  );
  root.style.setProperty(
    "--case-cover-motion-context-scale",
    String(0.94 + 0.06 * coverProgress),
  );
  root.style.setProperty(
    "--case-cover-motion-outgoing-opacity",
    String(1 - 0.4 * contextProgress),
  );
  root.style.setProperty(
    "--case-cover-motion-outgoing-blur",
    `${12 * contextProgress}px`,
  );
}

function clearMotionTimelineVars(): void {
  const root = document.documentElement;
  [
    "--case-cover-motion-eased",
    "--case-cover-motion-context-opacity",
    "--case-cover-motion-context-blur",
    "--case-cover-motion-context-scale",
    "--case-cover-motion-copy-opacity",
    "--case-cover-motion-copy-blur",
    "--case-cover-motion-title-progress",
    "--case-cover-motion-outgoing-opacity",
    "--case-cover-motion-outgoing-blur",
  ].forEach((property) => root.style.removeProperty(property));
}

function snapshotCoverRect(rect: DOMRect | undefined): CoverRectSnapshot | undefined {
  if (!rect) return undefined;

  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

function getCoverTransform(
  source: CoverRectSnapshot,
  destination: CoverRectSnapshot,
  progress: number,
): string {
  const eased = Math.max(0, progress);
  const initialScaleX = source.width / destination.width;
  const initialScaleY = source.height / destination.height;
  const translateX =
    (source.left - destination.left) * (1 - eased);
  const translateY =
    (source.top - destination.top) * (1 - eased);
  const scaleX = initialScaleX + (1 - initialScaleX) * eased;
  const scaleY = initialScaleY + (1 - initialScaleY) * eased;

  return `translate3d(${translateX}px, ${translateY}px, 0) scale(${scaleX}, ${scaleY})`;
}

function cubicBezierProgress(
  progress: number,
  ease: readonly [number, number, number, number],
): number {
  const [x1, y1, x2, y2] = ease;
  const clamped = Math.min(1, Math.max(0, progress));
  let low = 0;
  let high = 1;
  let parameter = clamped;

  for (let index = 0; index < 12; index += 1) {
    const x =
      3 * (1 - parameter) ** 2 * parameter * x1 +
      3 * (1 - parameter) * parameter ** 2 * x2 +
      parameter ** 3;
    if (x < clamped) low = parameter;
    else high = parameter;
    parameter = (low + high) / 2;
  }

  return (
    3 * (1 - parameter) ** 2 * parameter * y1 +
    3 * (1 - parameter) * parameter ** 2 * y2 +
    parameter ** 3
  );
}

function getOffscreenReturnTransform(
  rect: CoverRectSnapshot,
  progress: number,
): string {
  const scale =
    1 + (offscreenReturnStartScale - 1) * (1 - progress);
  const offsetX = -((rect.width * (scale - 1)) / 2);
  const offsetY = -((rect.height * (scale - 1)) / 2);
  return `translate3d(${offsetX}px, ${offsetY}px, 0) scale(${scale})`;
}

type CaseCoverMotionContextValue = {
  active: ActiveTransition | null;
  registerCoverContent: (
    transitionId: string,
    target: boolean,
    content: ReactNode,
  ) => void;
  openCase: (
    event: ReactMouseEvent<HTMLAnchorElement>,
    snapshot: Omit<
      TransitionSnapshot,
      "scrollY" | "sourceCoverRect"
    >,
  ) => boolean;
  returnHome: (event: ReactMouseEvent<HTMLAnchorElement>) => boolean;
};

const CaseCoverMotionContext = createContext<CaseCoverMotionContextValue | null>(
  null,
);

function readSnapshot() {
  try {
    const value = sessionStorage.getItem(storageKey);
    return value ? (JSON.parse(value) as TransitionSnapshot) : null;
  } catch {
    return null;
  }
}

function writeSnapshot(snapshot: TransitionSnapshot) {
  try {
    sessionStorage.setItem(storageKey, JSON.stringify(snapshot));
  } catch {
    // Navigation remains functional when storage is unavailable.
  }
}

function removeSnapshot() {
  try {
    sessionStorage.removeItem(storageKey);
  } catch {
    // Nothing to clean up when storage is unavailable.
  }
}

function getVisibleCover(
  transitionId: string,
  role?: "source" | "target",
): HTMLElement | undefined {
  const roleSelector = role ? `[data-case-cover-role="${role}"]` : "";
  const selector = `[data-case-cover-motion="${CSS.escape(transitionId)}"]${roleSelector}`;
  const activeViewCover = document.querySelector<HTMLElement>(
    `[aria-hidden="false"] ${selector}`,
  );
  if (activeViewCover) return activeViewCover;

  return [...document.querySelectorAll<HTMLElement>(selector)].find((element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const canMeasureHiddenCover =
      role === "target" ||
      (role === "source" &&
        document.documentElement.dataset.caseCoverMotionDirection === "return");
    const viewLayer = element.closest<HTMLElement>(".view-layer");
    return (
      style.display !== "none" &&
      (canMeasureHiddenCover || style.visibility !== "hidden") &&
      (!viewLayer || getComputedStyle(viewLayer).opacity !== "0") &&
      rect.width > 0
    );
  });
}

export function CaseCoverMotionProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const [active, setActive] = useState<ActiveTransition | null>(null);
  const [transitionContent, setTransitionContent] = useState<ReactNode | null>(
    null,
  );
  const [replacementContent, setReplacementContent] =
    useState<ReactNode | null>(null);
  const activeRef = useRef<ActiveTransition | null>(null);
  // The provider survives the client route handoff, so this is the reliable
  // primary return snapshot. sessionStorage remains the reload/back fallback.
  const lastSnapshotRef = useRef<TransitionSnapshot | null>(null);
  const coverContentRegistryRef = useRef(
    new Map<string, { source?: ReactNode; target?: ReactNode }>(),
  );
  const navigationTimerRef = useRef<number | null>(null);
  const completionTimerRef = useRef<number | null>(null);
  const handoffTimerRef = useRef<number | null>(null);

  const setTransition = useCallback((next: ActiveTransition | null) => {
    const previous = activeRef.current;
    activeRef.current = next;
    setActive(next);
    document.documentElement.toggleAttribute(
      "data-case-cover-motion-active",
      Boolean(next),
    );
    if (next) {
      const startsNewTimeline =
        !previous ||
        previous.transitionId !== next.transitionId ||
        previous.direction !== next.direction;
      if (startsNewTimeline) {
        writeMotionTimelineVars(next.direction, 0);
      }
      document.documentElement.dataset.caseCoverMotionDirection = next.direction;
      document.documentElement.dataset.caseCoverMotionId = next.transitionId;
      document.documentElement.dataset.caseCoverMotionPhase = next.phase;
      document.documentElement.toggleAttribute(
        "data-case-cover-motion-offscreen",
        Boolean(next.offscreenReturn),
      );
    } else {
      delete document.documentElement.dataset.caseCoverMotionDirection;
      delete document.documentElement.dataset.caseCoverMotionId;
      delete document.documentElement.dataset.caseCoverMotionPhase;
      document.documentElement.removeAttribute(
        "data-case-cover-motion-offscreen",
      );
      clearMotionTimelineVars();
    }
  }, []);

  const registerCoverContent = useCallback(
    (transitionId: string, target: boolean, content: ReactNode) => {
      const registered =
        coverContentRegistryRef.current.get(transitionId) ?? {};
      coverContentRegistryRef.current.set(transitionId, {
        ...registered,
        ...(target ? { target: content } : { source: content }),
      });
      // If a route target is registered after navigation, keep it as a
      // fallback only. The homepage normally pre-registers the target poster,
      // so the persistent crop-frame can start its fade at the click itself.
      const current = activeRef.current;
      if (
        target &&
        current?.direction === "forward" &&
        current.transitionId === transitionId
      ) {
        setReplacementContent((currentContent) => currentContent ?? content);
      }
    },
    [],
  );

  const complete = useCallback(() => {
    if (completionTimerRef.current !== null) {
      window.clearTimeout(completionTimerRef.current);
      completionTimerRef.current = null;
    }
    if (handoffTimerRef.current !== null) {
      window.clearTimeout(handoffTimerRef.current);
      handoffTimerRef.current = null;
    }
    const completed = activeRef.current;
    setTransition(null);
    setTransitionContent(null);
    setReplacementContent(null);
    if (completed?.direction === "return") {
      lastSnapshotRef.current = null;
      removeSnapshot();
    }
  }, [setTransition]);

  const armNavigation = useCallback(
    (navigate: () => void, delayMs: number) => {
      navigationTimerRef.current = window.setTimeout(() => {
        if (!activeRef.current) return;
        navigate();
      }, Math.max(0, delayMs));
    },
    [],
  );

  const armFallback = useCallback((durationMs = forwardTotalMs) => {
    if (completionTimerRef.current !== null) {
      window.clearTimeout(completionTimerRef.current);
    }
    completionTimerRef.current = window.setTimeout(
      complete,
      reduceMotion ? 50 : durationMs,
    );
  }, [complete, reduceMotion]);

  const openCase = useCallback(
    (
      event: ReactMouseEvent<HTMLAnchorElement>,
      snapshot: Omit<
        TransitionSnapshot,
        "scrollY" | "sourceCoverRect"
      >,
    ) => {
      const isPlainPrimaryClick =
        !event.metaKey &&
        !event.ctrlKey &&
        !event.shiftKey &&
        !event.altKey;
      if (!isPlainPrimaryClick || reduceMotion) return false;
      if (activeRef.current) return true;

      // Prevent the anchor's native navigation before arming the delayed
      // router handoff; otherwise the document can reload over the first
      // painted frame and discard the persistent transition layer.
      event.preventDefault();

      const cover = event.currentTarget.querySelector<HTMLElement>(
        `[data-case-cover-motion="${CSS.escape(snapshot.transitionId)}"]`,
      );
      const coverRect = cover?.getBoundingClientRect();
      const nextSnapshot = {
        ...snapshot,
        scrollY: window.scrollY,
        sourceCoverRect: snapshotCoverRect(coverRect),
      };
      lastSnapshotRef.current = nextSnapshot;
      setTransitionContent(
        coverContentRegistryRef.current.get(snapshot.transitionId)?.source ??
          null,
      );
      setReplacementContent(
        coverContentRegistryRef.current.get(snapshot.transitionId)?.target ??
          null,
      );
      writeSnapshot(nextSnapshot);
      setTransition({
        ...nextSnapshot,
        direction: "forward",
        phase: "preflight",
      });
      armFallback(forwardPreparationTimeoutMs + forwardFallbackMs);
      armNavigation(
        () => router.push(snapshot.casePath, { scroll: false }),
        forwardNavigationDelayMs,
      );
      return true;
    },
    [armFallback, armNavigation, reduceMotion, router, setTransition],
  );

  const returnHome = useCallback((event: ReactMouseEvent<HTMLAnchorElement>) => {
    if (activeRef.current) {
      event.preventDefault();
      return true;
    }
    const snapshot = lastSnapshotRef.current ?? readSnapshot();
    if (
      !snapshot ||
      reduceMotion ||
      pathname.replace(/\/$/, "") !== snapshot.casePath.replace(/\/$/, "")
    ) {
      return false;
    }

    event.preventDefault();
    const cover = getVisibleCover(snapshot.transitionId, "target");
    const coverRect = cover?.getBoundingClientRect();
    // All exits use the same compact landing motion. Keep the homepage card's
    // own cover in the persistent layer from the first return frame; the
    // case's first media image must never flash into the feed.
    // When the case cover is still in the viewport, preserve the canonical
    // return flight from that rect into the saved homepage card. Deep-scroll
    // exits keep the no-flight fallback because their source is not visible.
    const offscreenReturn =
      !coverRect ||
      coverRect.bottom < 0 ||
      coverRect.top > window.innerHeight;

    document.documentElement.dataset.portfolioView = snapshot.view;
    try {
      localStorage.setItem("portfolio-view", snapshot.view);
    } catch {
      // The in-memory snapshot still restores the current transition.
    }
    // Return starts directly in the same landing timeline at every scroll
    // position. Navigation is delayed by one frame only, so the case shell
    // can paint its outgoing blur before the homepage canvas appears.
    const phase: TransitionPhase = "landing";
    setTransitionContent(
      coverContentRegistryRef.current.get(snapshot.transitionId)?.source ??
        coverContentRegistryRef.current.get(snapshot.transitionId)?.target ??
        null,
    );
    setReplacementContent(null);
    setTransition({
      ...snapshot,
      sourceCoverRect: snapshotCoverRect(coverRect),
      direction: "return",
      phase,
      offscreenReturn,
      takeoffStartedAt: Date.now(),
      destinationCoverRect: snapshot.sourceCoverRect,
    });
    armFallback(offscreenReturn ? returnOffscreenFallbackMs : returnLandingMs);
    armNavigation(
      () => router.push(snapshot.homePath, { scroll: false }),
      returnNavigationDelayMs,
    );
    return true;
  }, [armFallback, armNavigation, pathname, reduceMotion, router, setTransition]);

  useEffect(() => {
    const handlePopState = () => {
      const snapshot = lastSnapshotRef.current ?? readSnapshot();
      if (!snapshot || activeRef.current || reduceMotion) return;
      if (
        window.location.pathname.replace(/\/$/, "") !==
        snapshot.homePath.replace(/\/$/, "")
      ) {
        return;
      }
      document.documentElement.dataset.portfolioView = snapshot.view;
      const cover = getVisibleCover(snapshot.transitionId, "source");
      const coverRect = cover?.getBoundingClientRect();
      setTransitionContent(
        coverContentRegistryRef.current.get(snapshot.transitionId)?.source ??
          coverContentRegistryRef.current.get(snapshot.transitionId)?.target ??
          null,
      );
      setReplacementContent(null);
      setTransition({
        ...snapshot,
        sourceCoverRect: snapshotCoverRect(coverRect),
        direction: "return",
        phase: "landing",
        takeoffStartedAt: Date.now(),
        destinationCoverRect: snapshot.sourceCoverRect,
        offscreenReturn: true,
      });
      armFallback(returnOffscreenFallbackMs);
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [armFallback, reduceMotion, setTransition]);

  useLayoutEffect(() => {
    if (!active) return;
    const normalizedPath = pathname.replace(/\/$/, "");
    if (
      active.direction === "forward" &&
      normalizedPath === active.casePath.replace(/\/$/, "")
    ) {
      window.scrollTo({ top: 0, behavior: "instant" });
    }
    if (
      active.direction === "return" &&
      normalizedPath === active.homePath.replace(/\/$/, "")
    ) {
      // The homepage restores its preferred view in its own layout effect.
      // Re-apply the captured scroll after those layout changes as well, or
      // the real card can drift away from the fixed transition layer.
      window.scrollTo({ top: active.scrollY, behavior: "instant" });
      let secondFrame = 0;
      let thirdFrame = 0;
      let startMotionFrame = 0;
      let visualMotionFrame = 0;
      const restoreAfterLayout = () => {
        window.scrollTo({ top: active.scrollY, behavior: "instant" });
        thirdFrame = window.requestAnimationFrame(() => {
          window.scrollTo({ top: active.scrollY, behavior: "instant" });
        });
      };
      secondFrame = window.requestAnimationFrame(restoreAfterLayout);
      // Let the returned homepage paint one whole frame with the cover at
      // its start scale. Otherwise a mobile route handoff consumes the first
      // part of the landing against the outgoing case and makes the cover
      // appear static when the blurred homepage becomes visible.
      if (active.offscreenReturn && !active.offscreenMotionStartedAt) {
        startMotionFrame = window.requestAnimationFrame(() => {
          visualMotionFrame = window.requestAnimationFrame(() => {
            const latest = activeRef.current;
            if (
              latest?.transitionId === active.transitionId &&
              latest.direction === "return" &&
              latest.offscreenReturn &&
              !latest.offscreenMotionStartedAt
            ) {
              setTransition({
                ...latest,
                offscreenMotionStartedAt: Date.now(),
              });
              armFallback(returnOffscreenLandingMs);
            }
          });
        });
      }
      return () => {
        window.cancelAnimationFrame(secondFrame);
        window.cancelAnimationFrame(thirdFrame);
        window.cancelAnimationFrame(startMotionFrame);
        window.cancelAnimationFrame(visualMotionFrame);
      };
    }
  }, [active, armFallback, pathname, setTransition]);

  useLayoutEffect(() => {
    const current = activeRef.current;
    if (
      !current ||
      pathname.replace(/\/$/, "") !== current.homePath.replace(/\/$/, "")
    ) {
      return;
    }

    let frame = 0;
    let attempts = 0;
    const alignProjectsToViewport = () => {
      const projects = document.querySelector<HTMLElement>(
        ".view-layer--current .projects",
      );
      if (!projects) {
        if (attempts < 6) {
          attempts += 1;
          frame = window.requestAnimationFrame(alignProjectsToViewport);
        }
        return;
      }

      const rect = projects.getBoundingClientRect();
      // Both directions use the same viewport-centered canvas scale. The
      // long page itself must not become the transform origin, otherwise the
      // visible cards appear to grow from the top of the document.
      projects.style.transformOrigin = `${window.innerWidth / 2 - rect.left}px ${window.innerHeight / 2 - rect.top}px`;
    };

    alignProjectsToViewport();
    frame = window.requestAnimationFrame(alignProjectsToViewport);

    return () => {
      window.cancelAnimationFrame(frame);
      const projects = document.querySelector<HTMLElement>(
        ".view-layer--current .projects",
      );
      projects?.style.removeProperty("transform-origin");
    };
  }, [
    active?.direction,
    active?.homePath,
    active?.offscreenReturn,
    active?.takeoffStartedAt,
    active?.transitionId,
    pathname,
  ]);

  useLayoutEffect(() => {
    const current = active;
    const normalizedPath = pathname.replace(/\/$/, "");
    if (!current) return;

    const destinationPath =
      current.direction === "forward" ? current.casePath : current.homePath;
    if (normalizedPath !== destinationPath.replace(/\/$/, "")) return;
    if (current.direction === "forward" && current.phase === "fallback") {
      return;
    }

    // Return already knows the saved homepage rect, so it does not need a
    // second takeoff tween after the homepage mounts. The persistent cover
    // and the homepage canvas are both driven by the same RAF timeline.
    if (current.destinationCoverRect) {
      if (
        current.direction === "return" &&
        !current.offscreenReturn &&
        current.phase === "landing"
      ) {
        if (handoffTimerRef.current !== null) {
          window.clearTimeout(handoffTimerRef.current);
        }
        // Reveal the homepage cover without restarting the canvas keyframe.
        // Both layers now have the same saved card geometry and content.
        handoffTimerRef.current = window.setTimeout(() => {
          handoffTimerRef.current = null;
          const latest = activeRef.current;
          if (
            latest?.transitionId === current.transitionId &&
            latest.direction === "return" &&
            latest.phase === "landing"
          ) {
            setTransition({ ...latest, phase: "handoff" });
          }
        }, returnCoverLandingMs);
      }
      return;
    }

    const destinationRole = current.direction === "forward" ? "target" : "source";
    let frame = 0;
    let attempts = 0;
    let previousDestination: CoverRectSnapshot | undefined;

    const hasStableGeometry = (next: CoverRectSnapshot) => {
      if (!previousDestination) {
        previousDestination = next;
        return false;
      }

      const delta = Math.max(
        Math.abs(previousDestination.left - next.left),
        Math.abs(previousDestination.top - next.top),
        Math.abs(previousDestination.width - next.width),
        Math.abs(previousDestination.height - next.height),
      );
      previousDestination = next;
      return delta < 0.5;
    };

    const measureDestination = () => {
      attempts += 1;
      const destination = getVisibleCover(current.transitionId, destinationRole);
      const destinationRect = destination?.getBoundingClientRect();

      if (destinationRect && destinationRect.width > 0) {
        const destinationSnapshot = snapshotCoverRect(destinationRect);
        if (!destinationSnapshot || !hasStableGeometry(destinationSnapshot)) {
          if (attempts < forwardPreparationAttempts) {
            frame = window.requestAnimationFrame(measureDestination);
          } else if (current.direction === "forward") {
            setTransition({
              ...current,
              phase: "fallback",
              takeoffStartedAt: Date.now(),
              destinationCoverRect: undefined,
            });
            armFallback(forwardFallbackMs);
          }
          return;
        }
        setTransition({
          ...current,
          // Start only after two consecutive measurements of the real route
          // DOM agree. There is no approximate geometry and no retarget later.
          phase: "landing",
          takeoffStartedAt: Date.now(),
          destinationCoverRect: destinationSnapshot,
        });
        if (current.direction === "forward") {
          const targetContent =
            coverContentRegistryRef.current.get(current.transitionId)?.target;
          if (targetContent !== undefined) {
            setReplacementContent((currentContent) => currentContent ?? targetContent);
          }
        } else if (!current.offscreenReturn) {
          if (handoffTimerRef.current !== null) {
            window.clearTimeout(handoffTimerRef.current);
          }
          // Reveal the homepage cover at the end of the 400 ms cover landing,
          // while the persistent layer is still present. This makes the
          // handoff overlap instead of exposing a final-frame geometry gap.
          handoffTimerRef.current = window.setTimeout(() => {
            handoffTimerRef.current = null;
            const latest = activeRef.current;
            if (
              latest?.transitionId === current.transitionId &&
              latest.direction === "return" &&
              latest.phase === "landing"
            ) {
              setTransition({ ...latest, phase: "handoff" });
            }
          }, returnCoverLandingMs);
        }
        armFallback(
          current.direction === "forward"
            ? forwardTotalMs
            : returnLandingMs,
        );
        return;
      }

      if (
        attempts <
        (current.direction === "forward" ? forwardPreparationAttempts : 8)
      ) {
        frame = window.requestAnimationFrame(measureDestination);
      } else if (current.direction === "forward") {
        setTransition({
          ...current,
          phase: "fallback",
          takeoffStartedAt: Date.now(),
          destinationCoverRect: undefined,
        });
        armFallback(forwardFallbackMs);
      }
    };

    frame = window.requestAnimationFrame(measureDestination);
    return () => window.cancelAnimationFrame(frame);
  }, [active, armFallback, pathname, setTransition]);

  useEffect(
    () => () => {
      if (completionTimerRef.current !== null) {
        window.clearTimeout(completionTimerRef.current);
      }
      if (handoffTimerRef.current !== null) {
        window.clearTimeout(handoffTimerRef.current);
      }
      if (navigationTimerRef.current !== null) {
        window.clearTimeout(navigationTimerRef.current);
      }
      document.documentElement.removeAttribute("data-case-cover-motion-active");
      delete document.documentElement.dataset.caseCoverMotionDirection;
      delete document.documentElement.dataset.caseCoverMotionId;
      delete document.documentElement.dataset.caseCoverMotionPhase;
      document.documentElement.removeAttribute(
        "data-case-cover-motion-offscreen",
      );
      clearMotionTimelineVars();
    },
    [],
  );

  return (
    <CaseCoverMotionContext.Provider
      value={{ active, registerCoverContent, openCase, returnHome }}
    >
      {children}
      <CaseCoverMotionBackdrop />
      <CaseCoverTransitionLayer
        content={transitionContent}
        replacementContent={replacementContent}
      />
    </CaseCoverMotionContext.Provider>
  );
}

export function CaseMotionRoutes({ children }: { children: ReactNode }) {
  return <div className="case-motion-route">{children}</div>;
}

function CaseCoverMotionBackdrop() {
  const { active } = useCaseCoverMotion();

  if (!active) return null;

  return <div className="case-cover-motion-backdrop" aria-hidden="true" />;
}

function CaseCoverTransitionLayer({
  content,
  replacementContent,
}: {
  content: ReactNode | null;
  replacementContent: ReactNode | null;
}) {
  const { active } = useCaseCoverMotion();
  const pathname = usePathname();
  const isOffscreenReturn =
    active?.direction === "return" && Boolean(active.offscreenReturn);
  const destinationRect = active?.destinationCoverRect;
  const sourceRect = isOffscreenReturn
    ? destinationRect
    : active?.sourceCoverRect;
  const layerRef = useRef<HTMLDivElement>(null);
  const sourceContentRef = useRef<HTMLDivElement>(null);
  const replacementContentRef = useRef<HTMLDivElement>(null);
  const forwardMotionStartedAtRef = useRef<number | null>(null);
  const forwardMotionKeyRef = useRef<string | null>(null);
  const [targetReadyContent, setTargetReadyContent] = useState<ReactNode | null>(
    null,
  );

  const activeDirection = active?.direction;
  const activeTransitionId = active?.transitionId;
  const activePhase = active?.phase;
  const activeHomePath = active?.homePath;
  const activeOffscreenMotionStartedAt = active?.offscreenMotionStartedAt;
  const activeTakeoffStartedAt = active?.takeoffStartedAt;
  const animationTargetRect = destinationRect;
  const layoutRect = destinationRect ?? sourceRect;
  const targetReady =
    activeDirection === "forward" &&
    Boolean(replacementContent) &&
    targetReadyContent === replacementContent;

  useLayoutEffect(() => {
    const layer = layerRef.current;
    if (!layer || !layoutRect) return;

    layer.style.setProperty("--case-cover-motion-left", `${layoutRect.left}px`);
    layer.style.setProperty("--case-cover-motion-top", `${layoutRect.top}px`);
    layer.style.setProperty("--case-cover-motion-width", `${layoutRect.width}px`);
    layer.style.setProperty("--case-cover-motion-height", `${layoutRect.height}px`);
  }, [
    layoutRect,
    layoutRect?.height,
    layoutRect?.left,
    layoutRect?.top,
    layoutRect?.width,
  ]);

  useLayoutEffect(() => {
    const layer = layerRef.current;
    if (!layer || !activeDirection || !activeTransitionId || !sourceRect) {
      return;
    }

    const isForwardTransition = activeDirection === "forward";
    const isFallback = activePhase === "fallback";
    const transitionKey = `${activeTransitionId}-${activeDirection}`;
    if (forwardMotionKeyRef.current !== transitionKey) {
      forwardMotionKeyRef.current = transitionKey;
      forwardMotionStartedAtRef.current = null;
    }
    if (isForwardTransition && activePhase === "preflight") {
      forwardMotionStartedAtRef.current = null;
      writeMotionTimelineVars("forward", 0, 0);
      layer.style.opacity = "1";
      layer.style.transform = "none";
      return;
    }
    if (
      isForwardTransition &&
      !isFallback &&
      (activePhase !== "landing" || !targetReady)
    ) {
      writeMotionTimelineVars("forward", 0, 0);
      layer.style.opacity = "1";
      layer.style.transform = "none";
      return;
    }
    const isHomeReturnRoute =
      activeDirection === "return" &&
      activeHomePath !== undefined &&
      pathname.replace(/\/$/, "") === activeHomePath.replace(/\/$/, "");
    if (
      isOffscreenReturn &&
      (!isHomeReturnRoute || activeOffscreenMotionStartedAt === undefined)
    ) {
      writeMotionTimelineVars("return", 0, 0);
      if (animationTargetRect) {
        layer.style.transform = getOffscreenReturnTransform(
          animationTargetRect,
          0,
        );
        layer.style.opacity = "1";
      }
      return;
    }
    if (!isForwardTransition && !animationTargetRect) return;

    const startedAt = isForwardTransition
      ? (forwardMotionStartedAtRef.current ??= Date.now())
      : isOffscreenReturn
        ? (activeOffscreenMotionStartedAt ?? Date.now())
        : (activeTakeoffStartedAt ?? Date.now());
    const durationMs = isFallback
      ? forwardFallbackMs
      : isOffscreenReturn
        ? returnOffscreenMotionMs
        : isForwardTransition
          ? forwardMotionMs
          : returnCoverLandingMs;
    const ease = isForwardTransition ? forwardEase : returnEase;
    let frame = 0;

    const updateMotion = () => {
      const elapsed = Math.max(0, Date.now() - startedAt);
      const progress = isForwardTransition && !isFallback
        ? Math.min(1, elapsed / forwardMotionMs)
        : Math.min(1, elapsed / durationMs);
      const easedProgress = cubicBezierProgress(progress, ease);
      const offscreenReturnProgress = cubicBezierProgress(progress, returnEase);
      writeMotionTimelineVars(
        isForwardTransition ? "forward" : "return",
        easedProgress,
        progress,
      );
      if (isFallback) {
        layer.style.transform = "none";
        layer.style.opacity = String(1 - easedProgress);
      } else if (animationTargetRect) {
        layer.style.transform = isOffscreenReturn
          ? getOffscreenReturnTransform(
              animationTargetRect,
              offscreenReturnProgress,
            )
          : getCoverTransform(sourceRect, animationTargetRect, easedProgress);
        layer.style.opacity = "1";
      }

      if (progress < 1) {
        frame = window.requestAnimationFrame(updateMotion);
      }
    };

    updateMotion();
    return () => window.cancelAnimationFrame(frame);
  }, [
    activePhase,
    activeDirection,
    activeTakeoffStartedAt,
    activeTransitionId,
    animationTargetRect,
    isOffscreenReturn,
    activeHomePath,
    activeOffscreenMotionStartedAt,
    pathname,
    targetReady,
    sourceRect,
    sourceRect?.height,
    sourceRect?.left,
    sourceRect?.top,
    sourceRect?.width,
  ]);

  useEffect(() => {
    let cancelled = false;
    const replacement = replacementContentRef.current;

    if (!replacementContent || !replacement || activeDirection !== "forward") {
      return () => {
        cancelled = true;
      };
    }

    const images = [...replacement.querySelectorAll("img")];
    const videos = [...replacement.querySelectorAll("video")];
    if (images.length === 0 && videos.length === 0) {
      Promise.resolve().then(() => {
        if (!cancelled) setTargetReadyContent(replacementContent);
      });
      return () => {
        cancelled = true;
      };
    }

    const imageReady = (image: HTMLImageElement) =>
      image.complete && image.naturalWidth > 0
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            const finish = () => {
              image.removeEventListener("load", finish);
              image.removeEventListener("error", finish);
              resolve();
            };
            image.addEventListener("load", finish, { once: true });
            image.addEventListener("error", finish, { once: true });
          }).then(() => image.decode?.().catch(() => undefined));
    const videoReady = (video: HTMLVideoElement) =>
      video.readyState >= 2
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            const finish = () => {
              video.removeEventListener("loadeddata", finish);
              video.removeEventListener("error", finish);
              resolve();
            };
            video.addEventListener("loadeddata", finish, { once: true });
            video.addEventListener("error", finish, { once: true });
          });

    Promise.all([
      ...images.map(imageReady),
      ...videos.map(videoReady),
    ]).then(() => {
      if (!cancelled) setTargetReadyContent(replacementContent);
    });

    return () => {
      cancelled = true;
    };
  }, [activeDirection, activeTransitionId, replacementContent]);

  useLayoutEffect(() => {
    const layer = layerRef.current;
    if (!layer || !activeDirection || !activeTransitionId || !content) {
      return;
    }

    const isForwardTransition = activeDirection === "forward";
    if (
      !isForwardTransition ||
      activePhase !== "landing" ||
      !replacementContent ||
      !targetReady ||
      forwardMotionStartedAtRef.current === null
    ) {
      if (sourceContentRef.current) sourceContentRef.current.style.opacity = "1";
      if (replacementContentRef.current) {
        replacementContentRef.current.style.opacity = "0";
      }
      return;
    }

    const startedAt = forwardMotionStartedAtRef.current;
    if (startedAt === null) return;
    let frame = 0;

    const updateContentCrossfade = () => {
      const elapsed = Math.max(0, Date.now() - startedAt);
      const progress = Math.min(
        1,
        Math.max(0, (elapsed - forwardCoverFadeStartMs) / forwardCoverFadeMs),
      );
      const opacity = cubicBezierProgress(progress, forwardRevealEase);
      if (sourceContentRef.current) {
        sourceContentRef.current.style.opacity = String(1 - opacity);
      }
      if (replacementContentRef.current) {
        replacementContentRef.current.style.opacity = String(opacity);
      }

      if (progress < 1) {
        frame = window.requestAnimationFrame(updateContentCrossfade);
      }
    };

    updateContentCrossfade();
    return () => window.cancelAnimationFrame(frame);
  }, [
    activePhase,
    activeDirection,
    activeTransitionId,
    content,
    replacementContent,
    targetReady,
  ]);

  if (!active || !content || !sourceRect) return null;

  return (
    <motion.div
      ref={layerRef}
      key={`${active.transitionId}-${active.direction}`}
      className="case-cover-motion-layer"
      initial={false}
    >
      <div
        ref={sourceContentRef}
        className="case-cover-motion-layer__content"
      >
        {content}
      </div>
      {replacementContent ? (
        <div
          ref={replacementContentRef}
          className="case-cover-motion-layer__content case-cover-motion-layer__content--replacement"
        >
          {replacementContent}
        </div>
      ) : null}
    </motion.div>
  );
}

export function SharedCaseCover({
  transitionId,
  enabled = true,
  target = false,
  transitionTarget,
  className,
  children,
}: {
  transitionId?: string;
  enabled?: boolean;
  target?: boolean;
  transitionTarget?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const { active, registerCoverContent } = useCaseCoverMotion();
  const coverRef = useRef<HTMLDivElement>(null);
  const isActiveCover = active?.transitionId === transitionId;
  const participates = Boolean(transitionId) && enabled && isActiveCover;
  // Keep the homepage source visible through forward preflight: the fixed
  // layer mounts at the same rect in that phase, then becomes its owner as
  // landing begins. This prevents a compositor gap exactly at click time.
  // On return, hide the route-local card cover while the persistent cover
  // lands over the black canvas. Reveal it only once both geometries match.
  const isReturnCoverAtHandoff =
    !target &&
    active?.direction === "return" &&
    active.phase === "handoff";
  const isForwardPreflight =
    active?.direction === "forward" && active.phase === "preflight";
  const isHiddenByTransition =
    participates &&
    !isForwardPreflight &&
    !isReturnCoverAtHandoff;

  useLayoutEffect(() => {
    if (!transitionId || !enabled) return;
    registerCoverContent(transitionId, target, children);
    if (!target && transitionTarget) {
      registerCoverContent(transitionId, true, transitionTarget);
    }
  }, [
    children,
    enabled,
    registerCoverContent,
    target,
    transitionId,
    transitionTarget,
  ]);

  return (
    <motion.div
      ref={coverRef}
      className={className}
      data-case-cover-motion={transitionId}
      data-case-cover-role={target ? "target" : "source"}
      initial={false}
      style={{
        transformOrigin: "50% 50%",
        visibility: isHiddenByTransition ? "hidden" : undefined,
      }}
    >
      {children}
      {!target && transitionTarget ? (
        <span
          className="shared-case-cover__target-preload"
          aria-hidden="true"
        >
          {transitionTarget}
        </span>
      ) : null}
    </motion.div>
  );
}

export function useCaseCoverMotion() {
  const value = useContext(CaseCoverMotionContext);
  if (!value) {
    throw new Error(
      "useCaseCoverMotion must be used inside CaseCoverMotionProvider",
    );
  }
  return value;
}
