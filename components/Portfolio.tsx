"use client";

import Link from "next/link";
import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { motion, useReducedMotion } from "motion/react";
import { getCasePath } from "@/data/cases";
import { getAbout } from "@/data/about";
import { getLocalizedPath } from "@/data/locales";
import { getProjects, type Project } from "@/data/projects";
import type { SiteLocale } from "@/data/locales";
import { getUiText, type UiText } from "@/data/ui-text";
import { OptimizedImage } from "./OptimizedImage";
import { OptimizedVideo } from "./OptimizedVideo";
import { LocaleTextTransition } from "./LocaleTextTransition";
import { SharedCaseCover, useCaseCoverMotion } from "./CaseCoverMotion";
import {
  rememberPortfolioScrollPosition,
  useNavigationViewControls,
} from "./Navigation";
import { trackContactIntent, trackEvent, trackOutboundLink } from "./analytics";

type ViewMode = "birdview" | "snakeview";
type ViewLayerState = "current" | "outgoing" | "incoming" | "hidden";

const easeOutExpo = [0.16, 1, 0.3, 1] as const;
const viewTransitionEase = [0.22, 1, 0.36, 1] as const;
const viewTransitions = {
  snakeviewToBirdview: {
    snakeviewExitScale: 0.9,
    birdviewEnterScale: 1.1,
    birdviewRowGapFrom: "174px",
    birdviewRowGapTo: "120px",
  },
  birdviewToSnakeview: {
    birdviewExitScale: 1.1,
    snakeviewEnterScale: 0.9,
    snakeviewRowGapFrom: "44px",
    snakeviewRowGapTo: "120px",
  },
  duration: 0.32,
  totalDurationMs: 320,
} as const;

const telegramChannelUrl = "https://t.me/mybeautifulheaven";
const telegramRevealDelayMs = 250;
const initialCardRevealDelay = 0.22;

const initialCardVariants = {
  hidden: { opacity: 0, y: 18 },
  visible: (row: number) => ({
    opacity: 1,
    y: 0,
    transition: {
      delay: initialCardRevealDelay + row * 0.09,
      duration: 0.56,
      ease: easeOutExpo,
    },
  }),
};

const initialAboutVariants = {
  hidden: { opacity: 1, y: 0 },
  visible: { opacity: 1, y: 0 },
};

function AboutTextReveal({ text }: { text: string }) {
  const revealRef = useRef<HTMLSpanElement>(null);
  const [lines, setLines] = useState<string[] | null>(null);
  const wordChunks = text.match(/\S+\s*/g) ?? [text];

  useLayoutEffect(() => {
    if (lines) return;

    const words = revealRef.current?.querySelectorAll<HTMLSpanElement>(
      ".about-text-reveal__word",
    );
    if (!words?.length) return;

    const linesByOffset = new Map<number, string>();
    words.forEach((word) => {
      const line = linesByOffset.get(word.offsetTop) ?? "";
      linesByOffset.set(word.offsetTop, line + word.textContent);
    });

    setLines(
      [...linesByOffset.entries()]
        .sort(([firstOffset], [secondOffset]) => firstOffset - secondOffset)
        .map(([, line]) => line),
    );
  }, [lines]);

  useEffect(() => {
    const element = revealRef.current;
    if (!element) return;

    let width = element.getBoundingClientRect().width;
    const resizeObserver = new ResizeObserver((entries) => {
      const nextWidth = entries[0]?.contentRect.width;
      if (nextWidth === undefined || Math.abs(nextWidth - width) < 1) return;

      width = nextWidth;
      setLines(null);
    });

    resizeObserver.observe(element);
    return () => resizeObserver.disconnect();
  }, []);

  return (
    <span
      ref={revealRef}
      className="about-text-reveal"
      data-lines-ready={lines ? "true" : "false"}
    >
      {lines
        ? lines.map((line, index) => (
            <span className="about-text-reveal__line" key={`${line}-${index}`}>
              {line}
            </span>
          ))
        : wordChunks.map((word, index) => (
            <span className="about-text-reveal__word" key={`${word}-${index}`}>
              {word}
            </span>
          ))}
    </span>
  );
}

function ProjectMedia({
  project,
  eager = false,
  view,
  sharedCoverEnabled,
}: {
  project: Project;
  eager?: boolean;
  view: ViewMode;
  sharedCoverEnabled: boolean;
}) {
  if (project.mediaType === "text") {
    return null;
  }

  if (project.mediaType === "video") {
    const sizes =
      view === "snakeview"
        ? "(max-width: 998px) calc(100vw - 64px), 934px"
        : "(max-width: 600px) 50vw, (max-width: 800px) 50vw, 33vw";
    const transitionTarget = project.transitionCoverAsset ? (
      <OptimizedImage
        assetKey={project.transitionCoverAsset}
        alt=""
        sizes={sizes}
        eager
      />
    ) : null;

    return (
      <>
        <SharedCaseCover
          transitionId={project.transitionId}
          enabled={sharedCoverEnabled}
          transitionTarget={transitionTarget}
          className="shared-case-cover"
        >
          <OptimizedVideo
            className="project__img project__video"
            src={project.video}
            posterKey={project.poster}
            title={project.title}
            sizes={sizes}
            eager={eager}
          />
        </SharedCaseCover>
        {project.extraImages ? (
          <div className="project__imgs project__imgs--extra">
            {project.extraImages.map((src) => (
              <OptimizedImage
                className="project__img project__img--half"
                key={src}
                assetKey={src}
                alt={project.title}
                sizes={
                  view === "snakeview"
                    ? "(max-width: 998px) calc((100vw - 64px) / 2), 465px"
                    : "(max-width: 800px) 50vw, 465px"
                }
              />
            ))}
          </div>
        ) : null}
      </>
    );
  }

  return (
    <>
    <SharedCaseCover
      transitionId={project.transitionId}
      enabled={sharedCoverEnabled}
      transitionTarget={
        project.transitionCoverAsset ? (
          <OptimizedImage
            assetKey={project.transitionCoverAsset}
            alt=""
            sizes={
              view === "snakeview"
                ? "(max-width: 998px) calc(100vw - 64px), 934px"
                : "(max-width: 600px) 50vw, (max-width: 800px) 50vw, 33vw"
            }
            eager
          />
        ) : null
      }
      className="shared-case-cover"
    >
      <OptimizedImage
        className="project__img"
        assetKey={project.image}
        alt={project.title}
        sizes={
          view === "snakeview"
            ? "(max-width: 998px) calc(100vw - 64px), 934px"
            : "(max-width: 600px) 50vw, (max-width: 800px) 50vw, 33vw"
        }
        eager={eager}
      />
    </SharedCaseCover>
    </>
  );
}

function ProjectCard({
  project,
  locale,
  localeTextTransitionId,
  text,
  row,
  column,
  eager = false,
  view,
  sharedCoverEnabled,
}: {
  project: Project;
  locale: SiteLocale;
  localeTextTransitionId: number;
  text: UiText;
  row?: number;
  column?: number;
  eager?: boolean;
  view: ViewMode;
  sharedCoverEnabled: boolean;
}) {
  const { active: activeCoverMotion, openCase } = useCaseCoverMotion();
  const interactiveCardRef = useRef<HTMLAnchorElement>(null);
  const projectCaseLinkRef = useRef<HTMLSpanElement>(null);
  const cursorAnimationFrameRef = useRef<number | null>(null);
  const cursorPositionRef = useRef<{ x: number; y: number } | null>(null);
  const cursorTargetRef = useRef<{ x: number; y: number } | null>(null);
  const isCursorReturningRef = useRef(false);

  function setProjectCursorPosition(clientX: number, clientY: number) {
    const interactiveCard = interactiveCardRef.current;

    if (!interactiveCard) return;

    interactiveCard.style.setProperty(
      "--project-cursor-x",
      `${clientX}px`,
    );
    interactiveCard.style.setProperty(
      "--project-cursor-y",
      `${clientY}px`,
    );
  }

  function cancelProjectCursorAnimation() {
    if (cursorAnimationFrameRef.current !== null) {
      cancelAnimationFrame(cursorAnimationFrameRef.current);
      cursorAnimationFrameRef.current = null;
    }
  }

  function runProjectCursorAnimation() {
    const interactiveCard = interactiveCardRef.current;
    const cursorPosition = cursorPositionRef.current;
    const cursorTarget = cursorTargetRef.current;

    if (!interactiveCard || !cursorPosition || !cursorTarget) {
      cancelProjectCursorAnimation();
      return;
    }

    const easing = isCursorReturningRef.current ? 0.18 : 0.35;
    const deltaX = cursorTarget.x - cursorPosition.x;
    const deltaY = cursorTarget.y - cursorPosition.y;

    cursorPosition.x += deltaX * easing;
    cursorPosition.y += deltaY * easing;
    setProjectCursorPosition(cursorPosition.x, cursorPosition.y);

    if (
      isCursorReturningRef.current &&
      Math.hypot(deltaX, deltaY) < 0.75
    ) {
      setProjectCursorPosition(cursorTarget.x, cursorTarget.y);
      const projectCaseLink = projectCaseLinkRef.current;

      if (projectCaseLink) {
        projectCaseLink.style.setProperty("transition", "none");
        projectCaseLink.style.setProperty("opacity", "1");
      }
      delete interactiveCard.dataset.projectCursorState;
      interactiveCard.dataset.projectCursorHandoff = "true";
      requestAnimationFrame(() => {
        projectCaseLink?.style.removeProperty("transition");
        projectCaseLink?.style.removeProperty("opacity");
        delete interactiveCard.dataset.projectCursorHandoff;
      });
      cursorPositionRef.current = null;
      cursorTargetRef.current = null;
      cursorAnimationFrameRef.current = null;
      return;
    }

    cursorAnimationFrameRef.current = requestAnimationFrame(
      runProjectCursorAnimation,
    );
  }

  function startProjectCursorAnimation() {
    if (cursorAnimationFrameRef.current !== null) return;

    cursorAnimationFrameRef.current = requestAnimationFrame(
      runProjectCursorAnimation,
    );
  }

  function showProjectCursor(event: ReactPointerEvent<HTMLAnchorElement>) {
    if (
      event.pointerType !== "mouse" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }

    const interactiveCard = interactiveCardRef.current;
    const projectCaseLink = projectCaseLinkRef.current;

    if (!interactiveCard || !projectCaseLink) return;

    const buttonBounds = projectCaseLink.getBoundingClientRect();
    cancelProjectCursorAnimation();

    const sourcePosition = {
      x: buttonBounds.left + buttonBounds.width / 2,
      y: buttonBounds.top + buttonBounds.height / 2,
    };

    cursorPositionRef.current = sourcePosition;
    cursorTargetRef.current = { x: event.clientX, y: event.clientY };
    isCursorReturningRef.current = false;
    setProjectCursorPosition(sourcePosition.x, sourcePosition.y);
    projectCaseLink.style.setProperty("opacity", "0");
    interactiveCard.dataset.projectCursorState = "active";
    startProjectCursorAnimation();
  }

  function moveProjectCursor(event: ReactPointerEvent<HTMLAnchorElement>) {
    if (event.pointerType !== "mouse") return;

    cursorTargetRef.current = {
      x: event.clientX,
      y: event.clientY,
    };
    isCursorReturningRef.current = false;
    startProjectCursorAnimation();
  }

  function hideProjectCursor() {
    const interactiveCard = interactiveCardRef.current;
    const projectCaseLink = projectCaseLinkRef.current;

    if (!interactiveCard || !projectCaseLink) return;

    const buttonBounds = projectCaseLink.getBoundingClientRect();

    if (!cursorPositionRef.current) return;

    cursorTargetRef.current = {
      x: buttonBounds.left + buttonBounds.width / 2,
      y: buttonBounds.top + buttonBounds.height / 2,
    };
    isCursorReturningRef.current = true;
    interactiveCard.dataset.projectCursorState = "returning";
    startProjectCursorAnimation();
  }

  useEffect(() => cancelProjectCursorAnimation, []);

  const content = (
    <>
      <div className="project__header">
        <h3 className="project__title">
          <LocaleTextTransition transitionId={localeTextTransitionId}>
            {project.title}
          </LocaleTextTransition>
        </h3>
      </div>
      <ProjectMedia
        project={project}
        eager={eager}
        view={view}
        sharedCoverEnabled={sharedCoverEnabled}
      />
      <p className="project__desc">
        <LocaleTextTransition transitionId={localeTextTransitionId} block>
          {project.description}
        </LocaleTextTransition>
      </p>
      {project.slug ? (
        <span ref={projectCaseLinkRef} className="project__case-link">
          <LocaleTextTransition transitionId={localeTextTransitionId}>
            {text.readCase}
          </LocaleTextTransition>
        </span>
      ) : null}
    </>
  );

  const props = {
    className: "project",
    "data-row": row,
    "data-column": column,
    "data-transition-project": project.transitionId,
    "data-case-cover-active":
      activeCoverMotion?.transitionId === project.transitionId
        ? "true"
        : undefined,
  };

  const casePath = project.slug
    ? getCasePath({ locale, slug: project.slug })
    : null;

  function handleCaseOpen(event: ReactMouseEvent<HTMLAnchorElement>) {
    if (!project.slug || !project.transitionId || !casePath) return;

    rememberPortfolioScrollPosition();
    trackEvent("case_opened", {
      case_slug: project.slug,
      locale,
      portfolio_view: view,
    });

    if (
      openCase(event, {
        transitionId: project.transitionId,
        casePath,
        homePath: locale === "ru" ? "/ru/" : "/",
        view,
      })
    ) {
      event.preventDefault();
    }
  }

  return project.slug ? (
    <Link
      {...props}
      ref={interactiveCardRef}
      className="project project--link"
      href={casePath!}
      aria-label={text.openCaseStudy(project.title)}
      onClick={handleCaseOpen}
      onPointerEnter={showProjectCursor}
      onPointerMove={moveProjectCursor}
      onPointerLeave={hideProjectCursor}
    >
      {content}
      <span
        className="project__cursor-read-case"
        aria-hidden="true"
      >
        <LocaleTextTransition transitionId={localeTextTransitionId}>
          {text.readCase}
        </LocaleTextTransition>
      </span>
    </Link>
  ) : (
    <article {...props}>{content}</article>
  );
}

function getProjectIdentity(project: Project) {
  if (project.transitionId) return project.transitionId;
  if (project.slug) return project.slug;
  if (project.mediaType === "image") return project.image;
  if (project.mediaType === "video") return project.video;
  return project.title;
}

function BirdView({
  projects,
  locale,
  localeTextTransitionId,
  isLocaleLayoutTransitionActive,
  showAbout,
  text,
  about,
  viewReady,
  reduceMotion,
  sharedCoverEnabled,
}: {
  projects: Project[];
  locale: SiteLocale;
  localeTextTransitionId: number;
  isLocaleLayoutTransitionActive: boolean;
  showAbout: boolean;
  text: UiText;
  about: ReturnType<typeof getAbout>;
  viewReady: boolean;
  reduceMotion: boolean;
  sharedCoverEnabled: boolean;
}) {
  return (
    <motion.section
      className="projects projects--birdview"
      aria-labelledby="birdview-heading"
      initial={false}
      animate={viewReady || reduceMotion ? "visible" : "hidden"}
    >
      <h2 id="birdview-heading" className="visually-hidden">
        {text.birdview}
      </h2>
      {showAbout ? (
        <motion.div
          className="project-motion-cell"
          layout="position"
          transition={{
            layout: {
              duration: isLocaleLayoutTransitionActive ? 0.24 : 0,
              ease: viewTransitionEase,
            },
          }}
          variants={initialCardVariants}
          custom={0}
        >
          <article
            className="project about-seva"
            data-row="0"
            data-column="0"
          >
            <div className="project__header">
              <h3 className="project__title">
                <LocaleTextTransition transitionId={localeTextTransitionId} block>
                  {about.name}
                </LocaleTextTransition>
              </h3>
            </div>
            <OptimizedImage
              className="project__img"
              assetKey="sevakudrytavtsev"
              alt={about.name}
              sizes="(max-width: 800px) 50vw, 33vw"
              eager
            />
            <p className="project__desc">
              <LocaleTextTransition
                transitionId={localeTextTransitionId}
                block
              >
                {about.paragraphs[0]}
              </LocaleTextTransition>
            </p>
          </article>
        </motion.div>
      ) : null}

      {projects.map((project, index) => {
        const gridIndex = index + (showAbout ? 1 : 0);
        const row = Math.floor(gridIndex / 3);

        return (
          <motion.div
            key={getProjectIdentity(project)}
            className="project-motion-cell"
            layout="position"
            transition={{
              layout: {
                duration: isLocaleLayoutTransitionActive ? 0.24 : 0,
                ease: viewTransitionEase,
              },
            }}
            variants={initialCardVariants}
            custom={row + 1}
          >
            <ProjectCard
              project={project}
              locale={locale}
              localeTextTransitionId={localeTextTransitionId}
              text={text}
              row={row}
              column={gridIndex % 3}
              eager={index < 2}
              view="birdview"
              sharedCoverEnabled={sharedCoverEnabled}
            />
          </motion.div>
        );
      })}
    </motion.section>
  );
}

function SnakeView({
  projects,
  locale,
  localeTextTransitionId,
  isLocaleLayoutTransitionActive,
  showAbout,
  text,
  about,
  viewReady,
  reduceMotion,
  revealAboutTextOnLoad,
  sharedCoverEnabled,
}: {
  projects: Project[];
  locale: SiteLocale;
  localeTextTransitionId: number;
  isLocaleLayoutTransitionActive: boolean;
  showAbout: boolean;
  text: UiText;
  about: ReturnType<typeof getAbout>;
  viewReady: boolean;
  reduceMotion: boolean;
  revealAboutTextOnLoad: boolean;
  sharedCoverEnabled: boolean;
}) {
  const telegramCtaRef = useRef<HTMLAnchorElement>(null);
  const aboutContentRef = useRef<HTMLDivElement>(null);
  const telegramCursorAnimationFrameRef = useRef<number | null>(null);
  const telegramCursorPositionRef = useRef<{ x: number; y: number } | null>(
    null,
  );
  const telegramCursorTargetRef = useRef<{ x: number; y: number } | null>(
    null,
  );
  const telegramCursorIsReturningRef = useRef(false);

  function setTelegramCursorPosition(x: number, y: number) {
    const telegramCta = telegramCtaRef.current;

    if (!telegramCta) return;

    telegramCta.style.setProperty("--telegram-cursor-x", `${x}px`);
    telegramCta.style.setProperty("--telegram-cursor-y", `${y}px`);
  }

  function cancelTelegramCursorAnimation() {
    if (telegramCursorAnimationFrameRef.current !== null) {
      cancelAnimationFrame(telegramCursorAnimationFrameRef.current);
      telegramCursorAnimationFrameRef.current = null;
    }
  }

  function animateTelegramCursor() {
    const cursorPosition = telegramCursorPositionRef.current;
    const cursorTarget = telegramCursorTargetRef.current;

    if (!cursorPosition || !cursorTarget) {
      cancelTelegramCursorAnimation();
      return;
    }

    const easing = telegramCursorIsReturningRef.current ? 0.18 : 0.35;
    cursorPosition.x += (cursorTarget.x - cursorPosition.x) * easing;
    cursorPosition.y += (cursorTarget.y - cursorPosition.y) * easing;
    setTelegramCursorPosition(cursorPosition.x, cursorPosition.y);

    if (
      Math.hypot(cursorTarget.x - cursorPosition.x, cursorTarget.y - cursorPosition.y) <
      0.5
    ) {
      setTelegramCursorPosition(cursorTarget.x, cursorTarget.y);
      if (telegramCursorIsReturningRef.current) {
        const telegramCta = telegramCtaRef.current;
        delete telegramCta?.dataset.cursorState;
        telegramCta?.style.removeProperty("--telegram-cursor-x");
        telegramCta?.style.removeProperty("--telegram-cursor-y");
        telegramCursorPositionRef.current = null;
        telegramCursorTargetRef.current = null;
      }
      telegramCursorAnimationFrameRef.current = null;
      return;
    }

    telegramCursorAnimationFrameRef.current = requestAnimationFrame(
      animateTelegramCursor,
    );
  }

  function startTelegramCursorAnimation() {
    if (telegramCursorAnimationFrameRef.current !== null) return;

    telegramCursorAnimationFrameRef.current = requestAnimationFrame(
      animateTelegramCursor,
    );
  }

  function showTelegramCursor(event: ReactPointerEvent<HTMLAnchorElement>) {
    if (
      event.pointerType !== "mouse" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }

    const telegramCta = telegramCtaRef.current;

    if (!telegramCta) return;

    const bounds = telegramCta.getBoundingClientRect();
    const targetPosition = {
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    };

    cancelTelegramCursorAnimation();
    telegramCursorPositionRef.current = {
      x: bounds.width / 2,
      y: bounds.height / 2,
    };
    telegramCursorTargetRef.current = targetPosition;
    telegramCursorIsReturningRef.current = false;
    setTelegramCursorPosition(bounds.width / 2, bounds.height / 2);
    telegramCta.dataset.cursorState = "active";
    startTelegramCursorAnimation();
  }

  function moveTelegramCursor(event: ReactPointerEvent<HTMLAnchorElement>) {
    if (event.pointerType !== "mouse") return;

    const telegramCta = telegramCtaRef.current;

    if (!telegramCta) return;

    const bounds = telegramCta.getBoundingClientRect();
    telegramCursorTargetRef.current = {
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    };
    telegramCursorIsReturningRef.current = false;
    startTelegramCursorAnimation();
  }

  function hideTelegramCursor() {
    const telegramCta = telegramCtaRef.current;
    const cursorPosition = telegramCursorPositionRef.current;

    if (!telegramCta || !cursorPosition) return;

    const bounds = telegramCta.getBoundingClientRect();
    telegramCursorTargetRef.current = {
      x: bounds.width / 2,
      y: bounds.height / 2,
    };
    telegramCursorIsReturningRef.current = true;
    startTelegramCursorAnimation();
  }

  useEffect(() => cancelTelegramCursorAnimation, []);

  useLayoutEffect(() => {
    const content = aboutContentRef.current;
    if (!content) return;
    const aboutContent = content;

    function orderAboutTextRevealLines() {
      const telegramCta = telegramCtaRef.current;
      if (!telegramCta) return;

      const lines = Array.from(
        aboutContent.querySelectorAll<HTMLElement>(
          ".about-text-reveal__line",
        ),
      );

      if (!lines.length) {
        telegramCta.dataset.textRevealReady = "false";
        return;
      }

      let nextLineDelayMs = 0;

      lines.forEach((line) => {
        const characterCount = line.textContent?.trim().length ?? 0;
        const durationMs = Math.min(480, Math.max(240, 144 + characterCount * 6));
        const lineDelayMs = reduceMotion ? 0 : nextLineDelayMs;

        line.style.setProperty("--about-text-reveal-duration", `${durationMs}ms`);
        line.style.setProperty("--about-text-reveal-delay", `${lineDelayMs}ms`);
        nextLineDelayMs += durationMs * 0.07;
      });

      telegramCta.style.setProperty(
        "--hero-about-telegram-reveal-delay",
        `${reduceMotion ? 0 : telegramRevealDelayMs}ms`,
      );
      telegramCta.dataset.textRevealReady = "true";
    }

    const observer = new MutationObserver(orderAboutTextRevealLines);
    observer.observe(aboutContent, { childList: true, subtree: true });
    orderAboutTextRevealLines();

    return () => observer.disconnect();
  }, [reduceMotion]);

  return (
    <motion.section
      className="projects projects--snakeview"
      aria-labelledby="snakeview-heading"
      data-about-text-reveal={revealAboutTextOnLoad ? "true" : undefined}
      initial={false}
      animate={viewReady || reduceMotion ? "visible" : "hidden"}
    >
      <h2 id="snakeview-heading" className="visually-hidden">
        {text.snakeview}
      </h2>
      {showAbout ? (
        <motion.article
          className="project hero-about"
          layout="position"
          transition={{
            layout: {
              duration: isLocaleLayoutTransitionActive ? 0.24 : 0,
              ease: viewTransitionEase,
            },
          }}
          variants={initialAboutVariants}
        >
          <div className="hero-about__content" ref={aboutContentRef}>
            <div className="hero-about__header">
              <h3 className="hero-about__title">
                <LocaleTextTransition transitionId={localeTextTransitionId}>
                  <AboutTextReveal text={about.name} />
                </LocaleTextTransition>
              </h3>
            </div>
            <p className="hero-about__desc">
              <LocaleTextTransition transitionId={localeTextTransitionId} block>
                <AboutTextReveal text={about.paragraphs[0]} />
              </LocaleTextTransition>
            </p>
            {about.paragraphs.slice(1).map((paragraph) => (
              <p className="hero-about__desc gray" key={paragraph}>
                <LocaleTextTransition transitionId={localeTextTransitionId} block>
                  <AboutTextReveal text={paragraph} />
                </LocaleTextTransition>
            </p>
            ))}
            <a
              ref={telegramCtaRef}
              className="hero-about__telegram"
              href={telegramChannelUrl}
              target="_blank"
              rel="noreferrer"
              aria-label={text.telegramChannelLinkLabel}
              onClick={() => {
                trackOutboundLink("telegram", "snakeview_about_cta");
                trackContactIntent("telegram", "snakeview_about_cta");
              }}
              onPointerEnter={showTelegramCursor}
              onPointerMove={moveTelegramCursor}
              onPointerLeave={hideTelegramCursor}
            >
              <span className="hero-about__telegram-inner">
                <img
                  className="hero-about__telegram-logo"
                  src="/assets/telegram/mybeautifulheaven-logo.png"
                  alt=""
                />
                <span className="hero-about__telegram-copy">
                  <span className="hero-about__telegram-title">
                    <LocaleTextTransition transitionId={localeTextTransitionId}>
                      {text.telegramChannelTitle}
                    </LocaleTextTransition>
                  </span>
                  <span className="hero-about__telegram-description">
                    <span className="hero-about__telegram-description-default">
                      <LocaleTextTransition transitionId={localeTextTransitionId}>
                        {text.telegramChannelDescription}
                      </LocaleTextTransition>
                    </span>
                    <span className="hero-about__telegram-description-hover">
                      <LocaleTextTransition transitionId={localeTextTransitionId}>
                        {text.telegramChannelHoverDescription}
                      </LocaleTextTransition>
                    </span>
                  </span>
                </span>
                <img
                  className="hero-about__telegram-arrow"
                  src="/assets/telegram/external-arrow.svg"
                  alt=""
                />
              </span>
            </a>
          </div>
        </motion.article>
      ) : null}

      {projects.map((project, index) => (
        <motion.div
          key={getProjectIdentity(project)}
          className="project-motion-cell"
          layout="position"
          transition={{
            layout: {
              duration: isLocaleLayoutTransitionActive ? 0.24 : 0,
              ease: viewTransitionEase,
            },
          }}
          variants={initialCardVariants}
          custom={index + 1}
        >
          <ProjectCard
            project={project}
            locale={locale}
            localeTextTransitionId={localeTextTransitionId}
            text={text}
            eager={index === 0}
            view="snakeview"
            sharedCoverEnabled={sharedCoverEnabled}
          />
        </motion.div>
      ))}
    </motion.section>
  );
}

export function Portfolio({ locale = "en" }: { locale?: SiteLocale }) {
  const { active: activeCoverMotion } = useCaseCoverMotion();
  const skipAboutTextRevealRef = useRef(
    activeCoverMotion?.direction === "return",
  );
  const [activeLocale, setActiveLocale] = useState<SiteLocale>(locale);
  const projects = getProjects(activeLocale);
  const about = getAbout(activeLocale);
  const text = getUiText(activeLocale);
  const showAbout = true;
  const [view, setView] = useState<ViewMode>("snakeview");
  const [viewReady, setViewReady] = useState(false);
  const [revealAboutTextOnLoad, setRevealAboutTextOnLoad] = useState(false);
  const [alternateViewPrepared, setAlternateViewPrepared] = useState(false);
  const [nextView, setNextView] = useState<ViewMode | null>(null);
  const [containerHeight, setContainerHeight] = useState<number>();
  const [localeTextTransitionId, setLocaleTextTransitionId] = useState(0);
  const [isLocaleLayoutTransitionActive, setIsLocaleLayoutTransitionActive] =
    useState(false);
  const reduceMotion = useReducedMotion();
  const switchingRef = useRef(false);
  const transitionIdRef = useRef(0);
  const completionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const localeLayoutTransitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const birdviewLayerRef = useRef<HTMLDivElement>(null);
  const snakeviewLayerRef = useRef<HTMLDivElement>(null);
  const heightCacheRef = useRef<Partial<Record<ViewMode, number>>>({});

  const startLocaleLayoutTransition = useCallback(() => {
    if (localeLayoutTransitionTimerRef.current) {
      clearTimeout(localeLayoutTransitionTimerRef.current);
    }

    setIsLocaleLayoutTransitionActive(true);
    localeLayoutTransitionTimerRef.current = setTimeout(() => {
      localeLayoutTransitionTimerRef.current = null;
      setIsLocaleLayoutTransitionActive(false);
    }, 180);
  }, []);

  const switchLocale = useCallback(
    (nextLocale: SiteLocale) => {
      if (nextLocale === activeLocale) return;

      window.history.pushState(null, "", getLocalizedPath({ locale: nextLocale }));
      document.documentElement.lang = nextLocale;
      setActiveLocale(nextLocale);
      setLocaleTextTransitionId((currentId) => currentId + 1);
      startLocaleLayoutTransition();
    },
    [activeLocale, startLocaleLayoutTransition],
  );

  useEffect(() => {
    function syncLocaleWithHistory() {
      const nextLocale: SiteLocale = window.location.pathname.startsWith("/ru")
        ? "ru"
        : "en";
      setActiveLocale(nextLocale);
      document.documentElement.lang = nextLocale;
      setLocaleTextTransitionId((currentId) => currentId + 1);
      startLocaleLayoutTransition();
    }

    window.addEventListener("popstate", syncLocaleWithHistory);
    return () => window.removeEventListener("popstate", syncLocaleWithHistory);
  }, [startLocaleLayoutTransition]);

  function getLayer(mode: ViewMode) {
    return mode === "birdview"
      ? birdviewLayerRef.current
      : snakeviewLayerRef.current;
  }

  function getProjectsHeight(mode: ViewMode) {
    return getLayer(mode)?.querySelector<HTMLElement>(".projects")?.offsetHeight;
  }

  useLayoutEffect(() => {
    const storedView =
      document.documentElement.dataset.portfolioView ??
      window.localStorage.getItem("portfolio-view");
    const initialView = storedView === "birdview" ? "birdview" : "snakeview";
    /* eslint-disable react-hooks/set-state-in-effect -- The client-only preference is applied after hydration. */
    setView(initialView);
    setRevealAboutTextOnLoad(
      initialView === "snakeview" && !skipAboutTextRevealRef.current,
    );
    setViewReady(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  useEffect(() => {
    if (!viewReady || alternateViewPrepared) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const prepareAlternateView = () => {
      timer = setTimeout(() => {
        if (!cancelled) setAlternateViewPrepared(true);
      }, 600);
    };

    if (document.readyState === "complete") {
      prepareAlternateView();
    } else {
      window.addEventListener("load", prepareAlternateView, { once: true });
    }

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener("load", prepareAlternateView);
    };
  }, [alternateViewPrepared, viewReady]);

  useEffect(() => {
    let animationFrame = 0;

    function scheduleScrollPositionSave() {
      if (animationFrame) return;

      animationFrame = requestAnimationFrame(() => {
        animationFrame = 0;
        rememberPortfolioScrollPosition();
      });
    }

    window.addEventListener("scroll", scheduleScrollPositionSave, {
      passive: true,
    });
    window.addEventListener("pagehide", rememberPortfolioScrollPosition);

    return () => {
      window.removeEventListener("scroll", scheduleScrollPositionSave);
      window.removeEventListener("pagehide", rememberPortfolioScrollPosition);
      cancelAnimationFrame(animationFrame);
      rememberPortfolioScrollPosition();
    };
  }, []);

  useEffect(() => {
    return () => {
      if (completionTimerRef.current) {
        clearTimeout(completionTimerRef.current);
      }
      if (localeLayoutTransitionTimerRef.current) {
        clearTimeout(localeLayoutTransitionTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const mode = entry.target.closest(".view-layer--birdview")
          ? "birdview"
          : "snakeview";
        const height = (entry.target as HTMLElement).offsetHeight;

        heightCacheRef.current[mode] = height;

        if (nextView === mode) {
          setContainerHeight((currentHeight) =>
            currentHeight === height ? currentHeight : height,
          );
        }
      }
    });

    for (const mode of ["birdview", "snakeview"] as const) {
      const projectsElement =
        getLayer(mode)?.querySelector<HTMLElement>(".projects");

      if (projectsElement) {
        heightCacheRef.current[mode] = projectsElement.offsetHeight;
        observer.observe(projectsElement);
      }
    }

    return () => observer.disconnect();
  }, [nextView]);

  function persistView(next: ViewMode) {
    window.localStorage.setItem("portfolio-view", next);
    document.documentElement.dataset.portfolioView = next;
  }

  function finishSwitch(next: ViewMode, transitionId: number) {
    if (
      !switchingRef.current ||
      transitionId !== transitionIdRef.current
    ) {
      return;
    }

    switchingRef.current = false;
    completionTimerRef.current = null;
    setView(next);
    setNextView(null);
    setContainerHeight(undefined);
  }

  function toggleView() {
    const transitionSource = nextView ?? view;
    const next: ViewMode =
      transitionSource === "birdview" ? "snakeview" : "birdview";
    persistView(next);
    trackEvent("portfolio_view_changed", {
      portfolio_view: next,
    });

    if (!alternateViewPrepared) {
      setAlternateViewPrepared(true);
    }

    if (reduceMotion) {
      setView(next);
      return;
    }

    if (completionTimerRef.current) {
      clearTimeout(completionTimerRef.current);
      completionTimerRef.current = null;
    }

    const transitionId = transitionIdRef.current + 1;
    transitionIdRef.current = transitionId;
    switchingRef.current = true;

    const currentHeight =
      heightCacheRef.current[transitionSource] ??
      getProjectsHeight(transitionSource);
    const targetHeight =
      heightCacheRef.current[next] ??
      getProjectsHeight(next);

    if (currentHeight && targetHeight) {
      const viewportHeight = window.innerHeight;
      const currentMax = Math.max(1, currentHeight - viewportHeight);
      const targetMax = Math.max(0, targetHeight - viewportHeight);
      const progress = Math.min(1, window.scrollY / currentMax);

      window.scrollTo({
        top: progress * targetMax,
        behavior: "instant",
      });
    }

    setContainerHeight(targetHeight ?? currentHeight);
    setView(transitionSource);
    setNextView(next);
    completionTimerRef.current = setTimeout(() => {
      finishSwitch(next, transitionId);
    }, viewTransitions.totalDurationMs);
  }

  const displayedView = nextView ?? view;
  const transitionDirection =
    nextView === "birdview"
      ? "snakeviewToBirdview"
      : "birdviewToSnakeview";

  useNavigationViewControls({
    view: displayedView,
    busy: nextView !== null,
    toggleView,
    locale: activeLocale,
    switchLocale,
    localeTextTransitionId,
  });

  function getViewLayerState(mode: ViewMode): ViewLayerState {
    if (nextView === mode) return "incoming";
    if (view === mode) return nextView ? "outgoing" : "current";
    return "hidden";
  }

  function layerAnimation(mode: ViewMode) {
    const state = getViewLayerState(mode);

    if (state === "outgoing") {
      return {
        opacity: 0,
        scale:
          transitionDirection === "birdviewToSnakeview"
            ? viewTransitions.birdviewToSnakeview.birdviewExitScale
            : viewTransitions.snakeviewToBirdview.snakeviewExitScale,
        "--project-row-gap":
          mode === "birdview"
            ? viewTransitions.snakeviewToBirdview.birdviewRowGapTo
            : viewTransitions.birdviewToSnakeview.snakeviewRowGapTo,
      };
    }

    if (state === "current") {
      return {
        opacity: 1,
        scale: 1,
        "--project-row-gap":
          mode === "birdview"
            ? viewTransitions.snakeviewToBirdview.birdviewRowGapTo
            : viewTransitions.birdviewToSnakeview.snakeviewRowGapTo,
      };
    }

    if (state === "incoming") {
      return {
        opacity: 1,
        scale: 1,
        "--project-row-gap":
          mode === "birdview"
            ? viewTransitions.snakeviewToBirdview.birdviewRowGapTo
            : viewTransitions.birdviewToSnakeview.snakeviewRowGapTo,
      };
    }

    return {
      opacity: 0,
      scale:
        mode === "birdview"
          ? viewTransitions.snakeviewToBirdview.birdviewEnterScale
          : viewTransitions.birdviewToSnakeview.snakeviewEnterScale,
      "--project-row-gap":
        mode === "birdview"
          ? viewTransitions.snakeviewToBirdview.birdviewRowGapFrom
          : viewTransitions.birdviewToSnakeview.snakeviewRowGapFrom,
    };
  }

  const viewLayerTransition = {
    delay: 0,
    duration: viewTransitions.duration,
    ease: viewTransitionEase,
  };

  return (
    <main id="main-content" className="page">
      <h1 className="visually-hidden">{text.portfolioHeading}</h1>
      <div
        className={`view-stage${nextView ? " view-stage--switching" : ""}`}
        data-view-ready={viewReady ? "true" : "false"}
        style={containerHeight ? { height: containerHeight } : undefined}
      >
            {((view === "birdview") || nextView === "birdview" || alternateViewPrepared) ? <motion.div
              ref={birdviewLayerRef}
              className={`view-layer view-layer--birdview view-layer--${getViewLayerState("birdview")}`}
              initial={false}
              animate={layerAnimation("birdview") as Record<string, string | number>}
              transition={viewLayerTransition}
              aria-hidden={displayedView !== "birdview"}
            >
              <BirdView
                projects={projects}
                locale={activeLocale}
                localeTextTransitionId={localeTextTransitionId}
                isLocaleLayoutTransitionActive={isLocaleLayoutTransitionActive}
                showAbout={showAbout}
                text={text}
                about={about}
                viewReady={
                  viewReady || activeCoverMotion?.direction === "return"
                }
                reduceMotion={Boolean(reduceMotion)}
                sharedCoverEnabled={displayedView === "birdview"}
              />
            </motion.div> : null}

            {((view === "snakeview") || nextView === "snakeview" || alternateViewPrepared) ? <motion.div
              ref={snakeviewLayerRef}
              className={`view-layer view-layer--snakeview view-layer--${getViewLayerState("snakeview")}`}
              initial={false}
              animate={layerAnimation("snakeview") as Record<string, string | number>}
              transition={viewLayerTransition}
              aria-hidden={displayedView !== "snakeview"}
            >
              <SnakeView
                projects={projects}
                locale={activeLocale}
                localeTextTransitionId={localeTextTransitionId}
                isLocaleLayoutTransitionActive={isLocaleLayoutTransitionActive}
                showAbout={showAbout}
                text={text}
                about={about}
                viewReady={
                  viewReady || activeCoverMotion?.direction === "return"
                }
                reduceMotion={Boolean(reduceMotion)}
                revealAboutTextOnLoad={revealAboutTextOnLoad}
                sharedCoverEnabled={displayedView === "snakeview"}
              />
            </motion.div> : null}
      </div>
    </main>
  );
}
