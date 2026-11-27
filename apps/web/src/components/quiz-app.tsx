"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Compass,
  Flag,
  Flower2,
  Globe,
  Heart,
  Home,
  Leaf,
  LockKeyhole,
  Map,
  Menu,
  Play,
  Plus,
  ShieldCheck,
  Sparkles,
  Star,
  Sun,
  Trophy,
  Volume2,
  X,
} from "lucide-react";
import {
  createClient,
  ApiError,
  type Attempt,
  type Child,
  type Progress,
  type Session,
  type Skill,
  type Subject,
} from "@little-quest/api-client";
import { demoCatalog } from "@/lib/demo";
import {
  emptyDemo,
  restoreDemo,
  startDemo,
  answerDemo,
  nextDemo,
} from "@/lib/demo-state";
import { Fox, MathWorld, EnglishWorld, DiscoveryWorld } from "./illustrations";
import { AuthDialog, ParentPanel } from "./parent-panel";
import { AccountSetupDialog } from "./account-setup-dialog";
import { ExplorerBadgeMark, ExplorerRankCard } from "./explorer-rank-card";
import { ExplorerRewards } from "./explorer-rewards";
import {
  adventurePoints,
  earnedExplorerBadges,
  explorerRank,
} from "@/lib/explorer-rank";
export const api = createClient();
const emptyProgress: Progress = {
  completed: 0,
  stars: 0,
  accuracy: 0,
  skills: [],
  recent: [],
  stickers: [],
  explorer_rank: explorerRank(0),
};
export type Notice = (message: string) => void;
type Destination = "home" | "explore" | "rewards" | "parent" | "picker";
const drawerViewport = "(max-width: 900px)";

export default function QuizApp() {
  const [session, setSession] = useState<Session | null>(null),
    [catalog, setCatalog] = useState<Subject[]>(demoCatalog),
    [liveProgress, setLiveProgress] = useState<Progress>(emptyProgress),
    [liveAttempt, setLiveAttempt] = useState<Attempt | null>(null),
    [view, setView] = useState("home"),
    [subject, setSubject] = useState<number | null>(null),
    [auth, setAuth] = useState<string | null>(null),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [menu, setMenu] = useState(false),
    [picker, setPicker] = useState(false),
    [selected, setSelected] = useState<string | null>(null),
    [answerError, setAnswerError] = useState(false),
    [online, setOnline] = useState(true),
    [demoState, setDemoState] = useState(() => emptyDemo(emptyProgress)),
    [demoHydrated, setDemoHydrated] = useState(false);
  const [leaveDestination, setLeaveDestination] = useState<Destination | null>(
    null,
  );
  const [switchTarget, setSwitchTarget] = useState<Skill | null>(null);
  const [completionSummary, setCompletionSummary] = useState<{
    attemptId: number;
    points: number;
    previousPoints: number;
  } | null>(null);
  const [authParams, setAuthParams] = useState({
    invite: "",
    email: "",
    token: "",
    setup: "",
  });
  const audioRef = useRef<HTMLAudioElement | null>(null),
    noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const quizActionPending = useRef(false);
  const questionHeading = useRef<HTMLHeadingElement>(null);
  const feedbackHeading = useRef<HTMLHeadingElement>(null);
  const celebrationHeading = useRef<HTMLHeadingElement>(null);
  const answerErrorRef = useRef<HTMLParagraphElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const notify: Notice = useCallback((message) => {
    setNotice(message);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(""), 6500);
  }, []);
  const demo = !session,
    attempt = demo ? demoState.attempt : liveAttempt,
    progress = demo ? demoState.progress : liveProgress,
    demoAvatar = demoState.avatar,
    child = session?.child,
    nickname = child?.nickname || "explorer";
  const feedback = attempt?.feedback;
  const adultMode = session?.mode === "adult";
  const resumeAttempt = attempt?.status === "active" ? attempt : null;
  const activeSubjectName = resumeAttempt
    ? (catalog.find((s) => s.slug === resumeAttempt.subject_slug)?.name ??
      resumeAttempt.skill_name)
    : null;
  const playing = view === "quiz" && resumeAttempt !== null;
  const completedReward =
    completionSummary?.attemptId === attempt?.id ? completionSummary : null;
  const currentBadge = earnedExplorerBadges(progress.explorer_rank.points).at(
    -1,
  );
  const unlockedBadge =
    completedReward &&
    currentBadge &&
    currentBadge.min_points > completedReward.previousPoints
      ? currentBadge
      : null;
  const setDemoAvatar = (avatar: string) =>
    setDemoState((state) => ({ ...state, avatar }));
  const clearAdventure = () => {
    setCompletionSummary(null);
    if (demo)
      setDemoState((state) => ({ ...state, attempt: null, sequence: [] }));
    else setLiveAttempt(null);
  };
  const refresh = useCallback(async (s: Session) => {
    setSession(s);
    if (s.mode === "adult") {
      setLiveProgress(emptyProgress);
      setLiveAttempt(null);
    }
    if (!s.user.email_verified_at) {
      setView("parent");
      return;
    }
    const data = await api.get<Subject[]>("/catalog");
    setCatalog(data);
    if (s.mode === "child" && s.child) {
      const [p, a] = await Promise.all([
        api.get<Progress>(`/children/${s.child.id}/progress`),
        api.get<Attempt | null>("/attempts/active"),
      ]);
      setLiveProgress(p);
      setLiveAttempt(a);
      setView("home");
    } else setView("parent");
  }, []);
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const setup =
      new URLSearchParams(location.hash.slice(1)).get("setup") || "";
    setAuthParams({
      invite: params.get("invite") || "",
      email: params.get("email") || "",
      token: params.get("reset_token") || "",
      setup,
    });
    if (params.has("invite")) setAuth("register");
    if (params.has("reset_token")) setAuth("reset");
    if (setup) setAuth("setup");
    const openSetupLink = () => {
      const token = new URLSearchParams(location.hash.slice(1)).get("setup");
      if (token) {
        setAuthParams((previous) => ({ ...previous, setup: token }));
        setAuth("setup");
      }
    };
    window.addEventListener("hashchange", openSetupLink);
    try {
      setDemoState(
        restoreDemo(localStorage.getItem("little-quest-demo"), emptyProgress),
      );
    } catch {}
    setDemoHydrated(true);
    api
      .get<Session>("/session")
      .then(async (s) => {
        await refresh(s);
        if (
          new URLSearchParams(location.search).has("verified") &&
          s.user.email_verified_at
        ) {
          notify("Email verified. Welcome to your next adventure!");
          const url = new URL(location.href);
          url.searchParams.delete("verified");
          history.replaceState(
            history.state,
            "",
            `${url.pathname}${url.search}${url.hash}`,
          );
        }
      })
      .catch((e) => {
        if (!(e instanceof ApiError && e.status === 401))
          notify("We can’t connect right now. You can still explore the demo.");
      });
    const up = () => setOnline(true),
      down = () => setOnline(false);
    setOnline(navigator.onLine);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("hashchange", openSetupLink);
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
      audioRef.current?.pause();
    };
  }, [refresh, notify]);
  useEffect(() => {
    if (demo && demoHydrated) {
      try {
        localStorage.setItem("little-quest-demo", JSON.stringify(demoState));
      } catch {}
    }
  }, [demoState, demo, demoHydrated]);
  useEffect(() => {
    setSelected(attempt?.feedback?.selected_choice_id || null);
    setAnswerError(false);
    audioRef.current?.pause();
  }, [
    attempt?.id,
    attempt?.position,
    attempt?.question?.id,
    attempt?.feedback,
  ]);
  useEffect(() => {
    if (view !== "quiz") return;
    const heading =
      attempt?.status === "completed"
        ? celebrationHeading.current
        : feedback
          ? feedbackHeading.current
          : questionHeading.current;
    heading?.focus({ preventScroll: true });
    if (feedback)
      heading?.closest(".feedback")?.scrollIntoView({ block: "nearest" });
    else heading?.scrollIntoView({ block: "nearest" });
  }, [view, attempt?.id, attempt?.position, attempt?.status, feedback]);
  useEffect(() => {
    if (answerError) {
      answerErrorRef.current?.scrollIntoView({ block: "nearest" });
    }
  }, [answerError]);
  useEffect(() => {
    if (!menu) return;
    const drawer = drawerRef.current;
    const opener = menuButtonRef.current;
    if (!drawer) return;
    const viewport = window.matchMedia(drawerViewport);
    const closeForDesktop = () => {
      if (!viewport.matches) setMenu(false);
    };
    const controls = () =>
      Array.from(
        drawer.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
      ).filter((button) => button.getClientRects().length > 0);
    controls()[0]?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setMenu(false);
      }
      if (event.key !== "Tab") return;
      const items = controls();
      const first = items[0];
      const last = items.at(-1);
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !drawer?.contains(active))) {
        event.preventDefault();
        last?.focus();
      } else if (
        !event.shiftKey &&
        (active === last || !drawer?.contains(active))
      ) {
        event.preventDefault();
        first?.focus();
      }
    }
    viewport.addEventListener("change", closeForDesktop);
    document.addEventListener("keydown", onKeyDown);
    closeForDesktop();
    return () => {
      viewport.removeEventListener("change", closeForDesktop);
      document.removeEventListener("keydown", onKeyDown);
      queueMicrotask(() => {
        const active = document.activeElement;
        if (
          viewport.matches &&
          (active === document.body || drawer.contains(active))
        ) {
          opener?.focus();
        }
      });
    };
  }, [menu]);
  const handleError = (e: unknown) => {
    notify(
      e instanceof Error
        ? e.message
        : "Something went wrong. Please try again.",
    );
    if (e instanceof ApiError && e.status === 409 && !demo) {
      void api
        .get<Attempt | null>("/attempts/active")
        .then((current) => {
          setLiveAttempt(current);
          setLeaveDestination(null);
          setSwitchTarget(null);
          if (!current) setView("home");
        })
        .catch(() => {});
    }
    if (e instanceof ApiError && e.status === 401 && session) {
      setSession(null);
      setLiveProgress(emptyProgress);
      setLiveAttempt(null);
      setLeaveDestination(null);
      setSwitchTarget(null);
      setAuth("login");
      setView("home");
    }
    if (!demo)
      void api.post("/events/error", { code: "request" }).catch(() => {});
  };
  const goTo = (next: Destination) => {
    setMenu(false);
    audioRef.current?.pause();
    setSubject(null);
    if (next === "parent") {
      if (view === "quiz") setView("home");
      if (!session) setAuth("login");
      else if (session.mode === "child") setAuth("reauth");
      else setView("parent");
    } else if (next === "picker") {
      if (view === "quiz") setView("home");
      setPicker(true);
    } else setView(next);
  };
  const navigate = (next: Destination) => {
    if (busy) return;
    setMenu(false);
    audioRef.current?.pause();
    if (
      view === "quiz" &&
      attempt?.status === "active" &&
      attempt.answered > 0
    ) {
      setLeaveDestination(next);
      return;
    }
    goTo(next);
  };
  const parent = () => navigate("parent");
  const entered = async (s: Session) => {
    setAuth(null);
    setPicker(false);
    try {
      await refresh(s);
    } catch (e) {
      handleError(e);
    }
  };
  const signedOut = () => {
    setSession(null);
    setCatalog(demoCatalog);
    setLiveProgress(emptyProgress);
    setLiveAttempt(null);
    goTo("home");
  };
  const enterChild = async (c: Child) => {
    try {
      setBusy(true);
      await entered(await api.post<Session>(`/children/${c.id}/enter`));
    } catch (e) {
      handleError(e);
    } finally {
      setBusy(false);
    }
  };
  async function start(skill?: Skill) {
    if (busy || quizActionPending.current) return;
    if (session?.mode === "adult") {
      setPicker(true);
      return;
    }
    quizActionPending.current = true;
    setBusy(true);
    setAnswerError(false);
    setCompletionSummary(null);
    try {
      if (
        attempt?.status === "active" &&
        (!skill || skill.id === attempt.skill_id)
      ) {
        if (!demo)
          setLiveAttempt(await api.get<Attempt>(`/attempts/${attempt.id}`));
        setView("quiz");
        return;
      }
      const target = skill ?? suggested;
      if (!target) {
        goTo("explore");
        return;
      }
      if (attempt?.status === "active" && attempt.answered > 0) {
        setSwitchTarget(target);
        return;
      }
      if (demo) {
        setDemoState((state) => startDemo(state, target));
      } else {
        const a = await api.post<Attempt>("/attempts", { skill_id: target.id });
        setLiveAttempt(a);
        if (a.skill_id !== target.id) {
          setSwitchTarget(target);
          return;
        }
      }
      setView("quiz");
    } catch (e) {
      handleError(e);
    } finally {
      quizActionPending.current = false;
      setBusy(false);
    }
  }
  async function answer() {
    if (
      !attempt?.question ||
      !selected ||
      busy ||
      feedback ||
      quizActionPending.current ||
      (!demo && !online)
    )
      return;
    quizActionPending.current = true;
    setBusy(true);
    setAnswerError(false);
    try {
      if (demo) {
        const checkedAt = Date.now();
        setDemoState((state) => answerDemo(state, selected, checkedAt));
      } else
        setLiveAttempt(
          await api.post<Attempt>(`/attempts/${attempt.id}/answers`, {
            position: attempt.position,
            question_id: attempt.question.id,
            choice_id: selected,
          }),
        );
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 409)) {
        handleError(e);
      } else {
        setAnswerError(true);
        if (!demo)
          void api.post("/events/error", { code: "request" }).catch(() => {});
      }
    } finally {
      quizActionPending.current = false;
      setBusy(false);
    }
  }
  async function next() {
    if (
      !attempt ||
      !feedback ||
      busy ||
      quizActionPending.current ||
      (!demo && !online)
    )
      return;
    quizActionPending.current = true;
    setBusy(true);
    try {
      if (demo) {
        const advancedAt = Date.now();
        if (
          attempt.position === 4 &&
          attempt.feedback &&
          attempt.status === "active"
        ) {
          setCompletionSummary({
            attemptId: attempt.id,
            points: adventurePoints(attempt.score),
            previousPoints: progress.explorer_rank.points,
          });
        }
        setDemoState((state) => nextDemo(state, advancedAt));
      } else {
        const a = await api.post<Attempt>(`/attempts/${attempt.id}/next`, {
          position: attempt.position,
        });
        setLiveAttempt(a);
        if (a.status === "completed" && child) {
          setCompletionSummary({
            attemptId: a.id,
            points: adventurePoints(a.score),
            previousPoints: progress.explorer_rank.points,
          });
          setLiveProgress(
            await api.get<Progress>(`/children/${child.id}/progress`),
          );
          setCatalog(await api.get<Subject[]>("/catalog"));
        }
      }
    } catch (e) {
      handleError(e);
    } finally {
      quizActionPending.current = false;
      setBusy(false);
    }
  }
  function listen() {
    const url = attempt?.question?.audio_url;
    if (!url) return;
    audioRef.current?.pause();
    const audio = new Audio(url);
    audioRef.current = audio;
    audio
      .play()
      .catch(() =>
        notify("That audio could not play. You can still read the question."),
      );
    audio.onerror = () => {
      notify(
        "Audio is taking a little rest. The question is still ready to read.",
      );
      if (!demo)
        void api.post("/events/error", { code: "audio" }).catch(() => {});
    };
  }
  const allSkills = catalog.flatMap((s) => s.skills),
    available = allSkills.filter((s) => s.question_count >= 5);
  const starts = child?.starting_skills || {};
  const suggested =
    available.find(
      (k) =>
        !k.completed &&
        (!starts[String(k.subject_id)] ||
          k.position >=
            (allSkills.find((s) => s.id === starts[String(k.subject_id)])
              ?.position || 0)),
    ) || available[0];
  const currentSubject = catalog.find((s) => s.id === subject);
  const avatarEmoji: Record<string, string> = {
    fox: "🦊",
    bear: "🐻",
    bunny: "🐰",
    panda: "🐼",
    cat: "🐱",
    frog: "🐸",
  };
  const avatar = avatarEmoji[child?.avatar || demoAvatar];
  return (
    <div className={`app-shell ${playing ? "playing-adventure" : ""}`}>
      <a href="#main-content" className="skip-link" inert={menu}>
        Skip to adventure
      </a>
      <aside
        className={`sidebar ${menu ? "open" : ""}`}
        id="quest-navigation"
        ref={drawerRef}
        role={menu ? "dialog" : undefined}
        aria-modal={menu || undefined}
        aria-label={menu ? "Little Quest menu" : undefined}
      >
        {menu && (
          <button
            className="icon-btn drawer-close"
            onClick={() => setMenu(false)}
            aria-label="Close navigation"
          >
            <X size={22} />
          </button>
        )}
        <button
          className="brand"
          onClick={() => navigate("home")}
          aria-label="Little Quest home"
        >
          <span className="brand-mark">
            <Fox />
          </span>
          <span>
            little
            <span className="brand-second">
              quest<span className="brand-dot">.</span>
            </span>
          </span>
        </button>
        <div className="sidebar-caption">YOUR HAPPY LEARNING PLACE</div>
        <nav aria-label="Main navigation">
          <button
            className={`nav-item ${view === "home" ? "active" : ""}`}
            onClick={() => navigate("home")}
          >
            <Home size={21} />
            My adventure<span className="nav-spark">✦</span>
          </button>
          <button
            className={`nav-item ${view === "explore" ? "active" : ""}`}
            onClick={() => navigate("explore")}
          >
            <Compass size={21} />
            Explore subjects
          </button>
          <button
            className={`nav-item ${view === "rewards" ? "active" : ""}`}
            onClick={() => navigate("rewards")}
          >
            <Trophy size={21} />
            My rewards
          </button>
        </nav>
        <div className="side-divider" />
        <button
          className={`nav-item parent-nav ${view === "parent" ? "active" : ""}`}
          onClick={parent}
        >
          <ShieldCheck size={21} />
          Parent dashboard
          {!adultMode && <LockKeyhole size={14} className="nav-lock" />}
        </button>
        <div className="sidebar-bottom">
          <div className="fox-note">
            <span className="tiny-star">✦</span>
            <Fox />
            <p>
              Big discoveries
              <br />
              start with <strong>little steps.</strong>
            </p>
          </div>
          <div className="made-with">
            Made for curious little minds <Heart size={12} />
          </div>
        </div>
      </aside>
      {menu && (
        <button
          className="mobile-scrim"
          onClick={() => setMenu(false)}
          aria-hidden="true"
          tabIndex={-1}
        />
      )}
      <div className="main-shell" inert={menu}>
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="icon-btn mobile-menu"
              ref={menuButtonRef}
              onClick={() => setMenu(true)}
              aria-label="Open navigation"
              aria-expanded={menu}
              aria-controls="quest-navigation"
            >
              <Menu />
            </button>
            <Sun size={20} className="sun-icon" />
            <span>A little curiosity goes a long way.</span>
          </div>
          <div className="topbar-right">
            {!adultMode && (
              <div
                className="star-counter"
                aria-label={`${progress.completed} completed adventures`}
              >
                <Flag size={18} aria-hidden="true" />
                <strong>{progress.completed}</strong>
                <span>finished</span>
              </div>
            )}
            <button
              className="profile-button"
              aria-label={
                adultMode
                  ? "Choose a child profile"
                  : `Choose explorer. Current: ${child?.nickname || "Explorer"}`
              }
              onClick={() => navigate("picker")}
            >
              <span className="avatar">{adultMode ? "👤" : avatar}</span>
              <span>
                {adultMode ? "Choose child" : child?.nickname || "Explorer"}
              </span>
              <ChevronDown size={15} />
            </button>
          </div>
        </header>
        <main
          id="main-content"
          className={`main-content ${view === "quiz" ? "quiz-main" : ""}`}
        >
          {!online && (
            <div className="connection-banner" role="status">
              You’re offline. Your saved answers are safe. Reconnect to keep
              going.
            </div>
          )}
          {view === "home" && (
            <>
              <div className="page-heading">
                <div>
                  <h1>
                    Hey, {nickname}! <span className="wave">👋</span>
                  </h1>
                </div>
              </div>
              <section className="adventure-hero" aria-labelledby="hero-title">
                <div className="hero-copy">
                  <h2 id="hero-title">
                    {resumeAttempt
                      ? "Pick up where you left off"
                      : suggested
                        ? "Ready for an adventure?"
                        : "More adventures coming soon"}
                  </h2>
                  {resumeAttempt ? (
                    <p>{resumeAttempt.skill_name}</p>
                  ) : suggested ? (
                    <p>{suggested.name} · 5 questions at your pace</p>
                  ) : (
                    <p>
                      Take a look at the subjects we’re getting ready for you.
                    </p>
                  )}
                  <div className="home-actions">
                    {resumeAttempt || suggested ? (
                      <button
                        className="button primary hero-button"
                        onClick={() => void start()}
                        disabled={busy || (demo ? !demoHydrated : !online)}
                      >
                        <Play
                          size={17}
                          fill="currentColor"
                          aria-hidden="true"
                        />
                        <span>
                          {resumeAttempt
                            ? `Resume ${activeSubjectName} · Question ${resumeAttempt.position + 1} of ${resumeAttempt.total}`
                            : "Start adventure"}
                        </span>
                        <ArrowRight size={18} aria-hidden="true" />
                      </button>
                    ) : null}
                    <button
                      className={`button ${resumeAttempt || suggested ? "secondary" : "primary"}`}
                      onClick={() => navigate("explore")}
                      disabled={busy}
                    >
                      <Compass size={18} aria-hidden="true" />
                      Explore subjects
                    </button>
                  </div>
                </div>
                <div className="hero-art">
                  <span className="hero-cloud cloud-one" />
                  <span className="hero-cloud cloud-two" />
                  <span className="float-symbol symbol-one">✦</span>
                  <span className="float-symbol symbol-two">✧</span>
                  <span className="float-symbol symbol-three">+</span>
                  <div className="fox-bubble">
                    You’ve got this! <Heart size={12} fill="currentColor" />
                  </div>
                  <Fox className="hero-fox" celebrate />
                  <div className="hero-hill" />
                  <span className="hero-flower">
                    <Flower2 />
                  </span>
                </div>
              </section>
              {demo && (
                <aside
                  className="family-signup-prompt"
                  aria-label="Family accounts"
                >
                  <p>
                    Save a separate quiz history for each child with a family
                    account.
                  </p>
                  <button
                    className="text-button"
                    onClick={() => setAuth("signup")}
                  >
                    Create a family account{" "}
                    <ArrowRight size={16} aria-hidden="true" />
                  </button>
                </aside>
              )}
              <ExplorerRankCard
                rank={progress.explorer_rank}
                onViewRewards={() => navigate("rewards")}
              />
              <section className="subject-section">
                <div className="section-heading">
                  <div>
                    <h2>
                      A world to explore <span>✦</span>
                    </h2>
                    <p>Pick a path. Follow your curiosity.</p>
                  </div>
                  <button
                    className="text-button"
                    onClick={() => navigate("explore")}
                  >
                    See all subjects <ArrowRight size={16} />
                  </button>
                </div>
                <div className="subject-grid">
                  {catalog.map((s) => (
                    <button
                      key={s.id}
                      className={`subject-card ${s.color}`}
                      onClick={() => {
                        setSubject(s.id);
                        setView("explore");
                      }}
                    >
                      <div className="subject-card-copy">
                        <span className="subject-icon" aria-hidden="true">
                          {s.icon === "calculator" ? (
                            <Plus size={21} />
                          ) : s.icon === "leaf" ? (
                            <Leaf size={21} />
                          ) : s.icon === "globe" ? (
                            <Globe size={21} />
                          ) : (
                            <BookOpen size={21} />
                          )}
                        </span>
                        <h3>{s.name}</h3>
                        <p>{s.description}</p>
                      </div>
                      <div className="subject-art" aria-hidden="true">
                        {s.icon === "calculator" ? (
                          <MathWorld />
                        ) : s.icon === "book" ? (
                          <EnglishWorld />
                        ) : (
                          <DiscoveryWorld globe={s.icon === "globe"} />
                        )}
                      </div>
                      <span className="subject-footer">
                        {s.skills.length}{" "}
                        {s.skills.length === 1
                          ? "little adventure"
                          : "little adventures"}
                        <span className="round-arrow" aria-hidden="true">
                          <ArrowRight size={17} />
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              </section>
              <section className="steps-section">
                <div className="section-heading">
                  <div>
                    <h2>Your next little steps</h2>
                    <p>There’s something wonderful waiting for you.</p>
                  </div>
                  <span className="small-label">SMALL STEPS. BIG SMILES.</span>
                </div>
                <div className="steps-grid">
                  {[allSkills[1], allSkills[6], allSkills[0]]
                    .filter(Boolean)
                    .map((s, i) => (
                      <button
                        className="step-card"
                        key={s.id}
                        onClick={() => start(s)}
                        disabled={busy || (!demo && s.question_count < 5)}
                      >
                        <span className={`step-icon step-${i}`}>
                          {i === 0 ? (
                            <Plus />
                          ) : i === 1 ? (
                            <BookOpen />
                          ) : (
                            <Flag />
                          )}
                        </span>
                        <span>
                          <span className="step-subject">
                            {catalog.find((x) => x.id === s.subject_id)?.name}
                          </span>
                          <strong>{s.name}</strong>
                          <span className="step-length">
                            {s.question_count >= 5
                              ? "5 questions · Your pace"
                              : "Coming soon"}
                          </span>
                        </span>
                        <ChevronRight size={18} />
                      </button>
                    ))}
                </div>
              </section>
              <div className="kind-note">
                <span>🌱</span>
                <p>
                  You don’t have to know it all.{" "}
                  <strong>You just have to be curious.</strong>
                </p>
              </div>
            </>
          )}
          {view === "explore" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">FOLLOW YOUR CURIOSITY</div>
                  <h1>
                    {currentSubject
                      ? currentSubject.name + " adventures"
                      : "A world to explore"}{" "}
                    <span>🧭</span>
                  </h1>
                  <p>Choose a little adventure. Every discovery counts.</p>
                </div>
              </div>
              <div className="filter-tabs">
                <button
                  className={!subject ? "selected" : ""}
                  onClick={() => setSubject(null)}
                >
                  All subjects
                </button>
                {catalog.map((s) => (
                  <button
                    className={subject === s.id ? "selected" : ""}
                    key={s.id}
                    onClick={() => setSubject(s.id)}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
              <div className="explore-grid">
                {catalog
                  .filter((s) => !subject || s.id === subject)
                  .flatMap((s) =>
                    s.skills.map((k, i) => (
                      <button
                        key={k.id}
                        className={`explore-card ${s.color}`}
                        disabled={busy || (!demo && k.question_count < 5)}
                        onClick={() => start(k)}
                      >
                        <div className="explore-top">
                          <span className="lesson-number">
                            {String(i + 1).padStart(2, "0")}
                          </span>
                          {k.completed ? (
                            <span className="completed-chip">
                              <Check size={13} />
                              Explored
                            </span>
                          ) : (
                            <span className="small-label">{s.name}</span>
                          )}
                        </div>
                        <span className="explore-symbol">
                          {s.slug === "maths"
                            ? ["123", "＋", "−", "×", "÷", "½"][i % 6]
                            : ["Aa", "abc", "“ ”", "?!", "↔", "📖"][i % 6]}
                        </span>
                        <h2>{k.name}</h2>
                        <p>{k.description}</p>
                        <span className="explore-footer">
                          {k.question_count >= 5
                            ? "Let’s explore · 5 questions"
                            : "Adventure coming soon"}
                          <ArrowRight size={18} />
                        </span>
                      </button>
                    )),
                  )}
              </div>
            </>
          )}
          {view === "rewards" && (
            <ExplorerRewards
              progress={progress}
              onExplore={() => void start()}
              busy={busy}
            />
          )}
          {view === "quiz" && attempt && (
            <>
              {attempt.status === "completed" ? (
                <section className="celebration">
                  <span className="celebration-stars" aria-hidden="true">
                    ✦　✧　✦
                  </span>
                  <Fox celebrate />
                  <div className="eyebrow">A LITTLE QUEST, A BIG HIGH FIVE</div>
                  <h1 ref={celebrationHeading} tabIndex={-1}>
                    You did it, {nickname}!
                  </h1>
                  <p>
                    You explored, you tried, and you learned something new.
                    <br />
                    That’s what being an adventurer is all about.
                  </p>
                  <div className="earned-sticker">
                    <Star fill="currentColor" />
                    <span>
                      NEW STICKER<strong>{attempt.reward}</strong>
                    </span>
                    <Sparkles />
                  </div>
                  {completedReward && (
                    <div className="earned-points" role="status">
                      <strong>
                        +{completedReward.points} adventure points
                      </strong>
                      {unlockedBadge && (
                        <div className="badge-unlocked">
                          <ExplorerBadgeMark badge={unlockedBadge} />
                          <span>
                            <strong>New badge!</strong> {unlockedBadge.title}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                  <ExplorerRankCard rank={progress.explorer_rank} />
                  <div className="celebration-actions">
                    <button
                      className="button primary"
                      disabled={busy}
                      onClick={() => {
                        clearAdventure();
                        navigate("home");
                      }}
                    >
                      Back to my adventure <Home size={18} />
                    </button>
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() => {
                        clearAdventure();
                        navigate("rewards");
                      }}
                    >
                      See my rewards <Trophy size={18} aria-hidden="true" />
                    </button>
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() => {
                        clearAdventure();
                        navigate("explore");
                      }}
                    >
                      Explore something else <ArrowRight size={16} />
                    </button>
                  </div>
                </section>
              ) : (
                <section className="quiz-container">
                  <div className="quiz-top">
                    <button
                      className="text-button"
                      onClick={() => navigate("home")}
                    >
                      <ArrowLeft size={18} aria-hidden="true" />
                      {attempt.answered > 0
                        ? "Save & leave"
                        : "Back to adventures"}
                    </button>
                    <span className="quiz-subject">
                      <span>{activeSubjectName}</span>
                      {activeSubjectName !== attempt.skill_name &&
                        attempt.skill_name}
                    </span>
                    <span className="question-count">
                      {attempt.position + 1} of {attempt.total}
                    </span>
                  </div>
                  <div
                    className="quiz-progress"
                    role="img"
                    aria-label={`Question ${attempt.position + 1} of ${attempt.total}`}
                  >
                    {Array.from({ length: attempt.total }, (_, i) => (
                      <span
                        key={i}
                        className={i <= attempt.position ? "filled" : ""}
                      />
                    ))}
                  </div>
                  <div className="question-panel">
                    <div className="question-heading">
                      <h1
                        ref={questionHeading}
                        tabIndex={-1}
                        key={attempt.question?.id}
                      >
                        {attempt.question?.prompt}
                      </h1>
                      {attempt.question?.audio_url && (
                        <button className="listen-button" onClick={listen}>
                          <Volume2 size={18} aria-hidden="true" />
                          Listen
                        </button>
                      )}
                    </div>
                    {attempt.question?.image_url && (
                      <img
                        className="question-image"
                        src={attempt.question.image_url}
                        alt={attempt.question.image_alt || ""}
                      />
                    )}
                    <p className="question-instruction">
                      {attempt.question?.instruction}
                    </p>
                    <div
                      className="answer-grid"
                      role="group"
                      aria-label="Answer choices"
                    >
                      {attempt.question?.choices.map((c, i) => {
                        const chosen =
                          (feedback?.selected_choice_id ?? selected) === c.id;
                        const correct = feedback?.correct_choice_id === c.id;
                        let state = chosen ? "Selected" : "";
                        if (feedback) {
                          state = correct
                            ? chosen
                              ? "Your answer is correct"
                              : "Correct answer"
                            : chosen
                              ? "Your answer"
                              : "";
                        }
                        return (
                          <button
                            key={c.id}
                            aria-pressed={chosen}
                            className={`answer-card ${chosen ? "chosen" : ""} ${correct ? "correct-answer" : ""}`}
                            disabled={!!feedback || busy}
                            onClick={() => setSelected(c.id)}
                          >
                            <span className="answer-letter">
                              {String.fromCharCode(65 + i)}
                            </span>
                            <span className="answer-copy">
                              {c.image_url && <img src={c.image_url} alt="" />}
                              <span>{c.text}</span>
                              {state && (
                                <span className="answer-state">
                                  {(correct || !feedback) && (
                                    <Check size={16} aria-hidden="true" />
                                  )}
                                  {state}
                                </span>
                              )}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    {feedback && (
                      <div
                        className={`feedback ${feedback.correct ? "positive" : "learning"}`}
                      >
                        <span className="feedback-icon" aria-hidden="true">
                          {feedback.correct ? "🌟" : "🌱"}
                        </span>
                        <div>
                          <h2
                            ref={feedbackHeading}
                            tabIndex={-1}
                            aria-describedby="answer-explanation"
                          >
                            {feedback.correct ? "You got it!" : "Let’s see why"}
                          </h2>
                          <p id="answer-explanation">{feedback.explanation}</p>
                        </div>
                      </div>
                    )}
                    {answerError && !feedback && (
                      <p
                        className="answer-retry"
                        ref={answerErrorRef}
                        role="alert"
                      >
                        We couldn’t check your answer. Your choice is still
                        here. Tap Check my answer to try again.
                      </p>
                    )}
                    <div className="quiz-actions">
                      <button
                        className="button primary"
                        onClick={(event) => {
                          if (event.detail > 1) return;
                          void (feedback ? next() : answer());
                        }}
                        disabled={
                          (!feedback && !selected) || busy || (!demo && !online)
                        }
                      >
                        {busy
                          ? "Saving…"
                          : feedback
                            ? attempt.position + 1 === attempt.total
                              ? "Finish adventure"
                              : "Next question"
                            : "Check my answer"}
                        <ArrowRight size={18} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                  <div className="quiz-fox-note">
                    <span aria-hidden="true">🦊</span>“Trying is how we grow.
                    I’m cheering for you!”
                  </div>
                </section>
              )}
            </>
          )}
          {view === "parent" && session && (
            <ParentPanel
              session={session}
              catalog={catalog}
              onSession={entered}
              onLogout={signedOut}
              notify={notify}
            />
          )}
          <footer className="page-footer">
            <span>
              little quest. <Heart size={11} />
            </span>
            <span>
              {demo
                ? "Playing as a guest. Progress is saved in this browser."
                : "A happy little place to learn"}
            </span>
            {demo && (
              <button onClick={parent}>
                Parent sign in <ArrowRight size={12} />
              </button>
            )}
          </footer>
        </main>
      </div>
      {leaveDestination && (
        <Dialog
          title="A little break?"
          onClose={() => setLeaveDestination(null)}
        >
          <Fox className="dialog-mascot" />
          <p className="dialog-description">
            Your answers are safe. Would you like to keep playing or save and
            leave?
          </p>
          <div className="dialog-actions">
            <button
              className="button primary"
              onClick={() => setLeaveDestination(null)}
            >
              Keep playing <Play size={18} />
            </button>
            <button
              className="button secondary"
              onClick={() => {
                const destination = leaveDestination;
                setLeaveDestination(null);
                goTo(destination);
              }}
            >
              Save & leave <ArrowRight size={18} />
            </button>
          </div>
        </Dialog>
      )}
      {switchTarget && attempt && (
        <Dialog
          title="Your adventure is waiting!"
          onClose={() => setSwitchTarget(null)}
        >
          <Fox className="dialog-mascot" celebrate />
          <p className="dialog-description">
            Your{" "}
            {catalog.find((s) => s.slug === attempt.subject_slug)?.name ||
              attempt.subject_slug}{" "}
            adventure is waiting! Let’s finish {attempt.skill_name}, then
            explore{" "}
            {catalog.find((s) => s.id === switchTarget.subject_id)?.name ||
              "something new"}
            .
          </p>
          <div className="dialog-actions">
            <button
              className="button primary"
              disabled={busy}
              onClick={() => {
                setSwitchTarget(null);
                void start();
              }}
            >
              Continue adventure <Play size={18} />
            </button>
            <button
              className="button secondary"
              onClick={() => setSwitchTarget(null)}
            >
              Go back <ArrowLeft size={18} />
            </button>
          </div>
        </Dialog>
      )}
      {(auth === "signup" || auth === "setup") && (
        <AccountSetupDialog
          key={auth === "setup" ? authParams.setup : auth}
          token={auth === "setup" ? authParams.setup : null}
          session={session}
          onClose={() => setAuth(null)}
          onSignIn={(email) => {
            if (email) setAuthParams((previous) => ({ ...previous, email }));
            setAuth(email ? "setup-login" : "login");
          }}
          onSignedOut={signedOut}
          onComplete={async (account, moderator) => {
            if (location.hash.startsWith("#setup="))
              history.replaceState(
                history.state,
                "",
                location.pathname + location.search,
              );
            setAuthParams((previous) => ({
              ...previous,
              setup: "",
              email: "",
            }));
            await entered(account);
            notify(
              moderator
                ? "Invitation accepted. Open Content Studio from your Parent dashboard."
                : "Your family account is ready. Add your first child profile to get started.",
            );
          }}
        />
      )}
      {auth && auth !== "signup" && auth !== "setup" && (
        <AuthDialog
          mode={auth === "setup-login" ? "login" : auth}
          params={authParams}
          onClose={() => setAuth(null)}
          onMode={setAuth}
          onSession={async (s) => {
            await entered(s);
            if (auth === "setup-login") setAuth("setup");
          }}
          notify={notify}
        />
      )}
      {picker && (
        <Dialog
          title={session ? "Choose a child profile" : "Make yourself at home"}
          onClose={() => setPicker(false)}
        >
          <p className="dialog-description">
            {session
              ? session.children.length
                ? "Choose your name to open your quizzes and saved progress."
                : "Add a child profile from the parent dashboard first."
              : "Choose a friend for your demo adventure."}
          </p>
          <div className="avatar-grid">
            {session
              ? session.children.map((c) => (
                  <button
                    disabled={busy}
                    key={c.id}
                    onClick={() => enterChild(c)}
                  >
                    <span>{avatarEmoji[c.avatar]}</span>
                    <strong>{c.nickname}</strong>
                  </button>
                ))
              : Object.entries(avatarEmoji).map(([key, emoji]) => (
                  <button
                    key={key}
                    className={demoAvatar === key ? "selected" : ""}
                    onClick={() => {
                      setDemoAvatar(key);
                      setPicker(false);
                    }}
                  >
                    <span>{emoji}</span>
                    <strong>{key[0].toUpperCase() + key.slice(1)}</strong>
                  </button>
                ))}
          </div>
          {session && !session.children.length && (
            <>
              <button
                className="button primary"
                onClick={() => {
                  setPicker(false);
                  parent();
                }}
              >
                Open parent dashboard
              </button>
            </>
          )}
          {!session && (
            <div className="auth-links">
              <button
                onClick={() => {
                  setPicker(false);
                  parent();
                }}
              >
                Parent sign in
              </button>
              <button
                onClick={() => {
                  setPicker(false);
                  setAuth("signup");
                }}
              >
                Create a family account
              </button>
            </div>
          )}
        </Dialog>
      )}
      {notice && (
        <div className="toast" role="status">
          <span>{notice}</span>
          <button onClick={() => setNotice("")} aria-label="Dismiss message">
            <X size={18} />
          </button>
        </div>
      )}
    </div>
  );
}
export function Dialog({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const old = document.activeElement as HTMLElement | null;
    const bodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const el = ref.current;
    const firstField = el?.querySelector<HTMLElement>(
      'input:not([type="hidden"]):not([disabled]),select:not([disabled]),textarea:not([disabled])',
    );
    const firstAction = el?.querySelector<HTMLElement>(
      "button:not(.dialog-close):not([disabled]),a[href]",
    );
    (
      firstField ||
      firstAction ||
      el?.querySelector<HTMLElement>("button")
    )?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeRef.current();
      }
      if (e.key === "Tab") {
        const items = Array.from(
          el?.querySelectorAll<HTMLElement>(
            'button:not([disabled]),input:not([type="hidden"]):not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href]',
          ) || [],
        ).filter((item) => item.getClientRects().length > 0);
        const first = items[0],
          last = items.at(-1);
        if (
          e.shiftKey &&
          (document.activeElement === first ||
            !el?.contains(document.activeElement))
        ) {
          e.preventDefault();
          last?.focus();
        } else if (
          !e.shiftKey &&
          (document.activeElement === last ||
            !el?.contains(document.activeElement))
        ) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => {
      document.body.style.overflow = bodyOverflow;
      document.removeEventListener("keydown", handler);
      if (
        old?.isConnected &&
        old.getClientRects().length > 0 &&
        getComputedStyle(old).visibility === "visible"
      ) {
        old.focus();
      } else {
        document
          .querySelector<HTMLElement>(".question-panel h1, .celebration h1")
          ?.focus();
      }
    };
  }, [title]);
  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className={`dialog ${wide ? "wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <button
          className="dialog-close icon-btn"
          onClick={onClose}
          aria-label="Close dialog"
        >
          <X size={21} />
        </button>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}
