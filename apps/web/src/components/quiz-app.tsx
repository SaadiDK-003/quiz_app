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
import { demoCatalog, demoQuestions, englishDemo } from "@/lib/demo";
import { Fox, MathWorld, EnglishWorld, DiscoveryWorld } from "./illustrations";
import { AuthDialog, ParentPanel } from "./parent-panel";
export const api = createClient();
const emptyProgress: Progress = {
  completed: 0,
  stars: 0,
  accuracy: 0,
  skills: [],
  recent: [],
  stickers: [],
};
export type Notice = (message: string) => void;
export default function QuizApp() {
  const [session, setSession] = useState<Session | null>(null),
    [catalog, setCatalog] = useState<Subject[]>(demoCatalog),
    [progress, setProgress] = useState<Progress>(emptyProgress),
    [attempt, setAttempt] = useState<Attempt | null>(null),
    [view, setView] = useState("home"),
    [subject, setSubject] = useState<number | null>(null),
    [auth, setAuth] = useState<string | null>(null),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [menu, setMenu] = useState(false),
    [picker, setPicker] = useState(false),
    [selected, setSelected] = useState<string | null>(null),
    [online, setOnline] = useState(true),
    [demoAvatar, setDemoAvatar] = useState("fox"),
    [demoHydrated, setDemoHydrated] = useState(false);
  const [authParams, setAuthParams] = useState({
    invite: "",
    email: "",
    token: "",
  });
  const audioRef = useRef<HTMLAudioElement | null>(null),
    noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notify: Notice = useCallback((message) => {
    setNotice(message);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(""), 6500);
  }, []);
  const demo = !session,
    child = session?.child,
    nickname = child?.nickname || "explorer";
  const refresh = useCallback(async (s: Session) => {
    setSession(s);
    if (s.mode === "adult") {
      setProgress(emptyProgress);
      setAttempt(null);
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
      setProgress(p);
      setAttempt(a);
      setView("home");
    } else setView("parent");
  }, []);
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    setAuthParams({
      invite: params.get("invite") || "",
      email: params.get("email") || "",
      token: params.get("reset_token") || "",
    });
    if (params.has("invite")) setAuth("register");
    if (params.has("reset_token")) setAuth("reset");
    if (params.has("verified"))
      notify("Email verified. Welcome to your next adventure!");
    try {
      const saved = localStorage.getItem("little-quest-demo");
      if (saved) {
        const d = JSON.parse(saved);
        setAttempt(d.attempt || null);
        setProgress(d.progress || emptyProgress);
        setDemoAvatar(d.avatar || "fox");
      }
    } catch {}
    setDemoHydrated(true);
    api
      .get<Session>("/session")
      .then(refresh)
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
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
      audioRef.current?.pause();
    };
  }, [refresh, notify]);
  useEffect(() => {
    if (demo && demoHydrated)
      localStorage.setItem(
        "little-quest-demo",
        JSON.stringify({ attempt, progress, avatar: demoAvatar }),
      );
  }, [attempt, progress, demo, demoAvatar, demoHydrated]);
  useEffect(() => {
    setSelected(attempt?.feedback?.selected_choice_id || null);
    audioRef.current?.pause();
  }, [attempt?.id, attempt?.position, attempt?.feedback]);
  useEffect(() => {
    if (view === "quiz")
      document
        .querySelector<HTMLElement>(".question-panel h1, .celebration h1")
        ?.focus();
  }, [view, attempt?.id, attempt?.position, attempt?.status]);
  const handleError = (e: unknown) => {
    notify(
      e instanceof Error
        ? e.message
        : "Something went wrong. Please try again.",
    );
    if (e instanceof ApiError && e.status === 409 && attempt && !demo) {
      void api
        .get<Attempt>(`/attempts/${attempt.id}`)
        .then(setAttempt)
        .catch(() => {});
    }
    if (e instanceof ApiError && e.status === 401 && session) {
      setSession(null);
      setProgress(emptyProgress);
      setAttempt(null);
      setAuth("login");
      setView("home");
    }
    if (!demo)
      void api.post("/events/error", { code: "request" }).catch(() => {});
  };
  const navigate = (next: string) => {
    setMenu(false);
    setView(next);
    setSubject(null);
  };
  const parent = () => {
    setMenu(false);
    if (!session) setAuth("login");
    else if (session.mode === "child") setAuth("reauth");
    else setView("parent");
  };
  const entered = async (s: Session) => {
    setAuth(null);
    setPicker(false);
    try {
      await refresh(s);
    } catch (e) {
      handleError(e);
    }
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
    if (session?.mode === "adult") {
      setPicker(true);
      return;
    }
    setBusy(true);
    try {
      if (attempt?.status === "active") {
        setView("quiz");
        return;
      }
      const target = skill || suggested;
      if (demo) {
        const english = target?.subject_id === 2;
        setAttempt({
          id: Date.now(),
          skill_id: target?.id || 2,
          skill_name: english ? "English sampler" : "Maths sampler",
          subject_slug: english ? "english" : "maths",
          status: "active",
          position: 0,
          total: 5,
          answered: 0,
          score: 0,
          question: (english ? englishDemo : demoQuestions)[0],
          feedback: null,
          reward: null,
        });
      } else {
        const a = await api.post<Attempt>("/attempts", { skill_id: target.id });
        setAttempt(a);
      }
      setView("quiz");
    } catch (e) {
      handleError(e);
    } finally {
      setBusy(false);
    }
  }
  async function answer() {
    if (!attempt || !selected || busy || attempt.feedback) return;
    setBusy(true);
    try {
      if (demo) {
        const q = (
          attempt.subject_slug === "english" ? englishDemo : demoQuestions
        )[attempt.position];
        setAttempt({
          ...attempt,
          answered: attempt.position + 1,
          score: attempt.score + (q.choices[q.answer].id === selected ? 1 : 0),
          feedback: {
            correct: q.choices[q.answer].id === selected,
            correct_choice_id: q.choices[q.answer].id,
            selected_choice_id: selected,
            explanation: q.explanation,
          },
        });
      } else
        setAttempt(
          await api.post<Attempt>(`/attempts/${attempt.id}/answers`, {
            position: attempt.position,
            question_id: attempt.question!.id,
            choice_id: selected,
          }),
        );
    } catch (e) {
      handleError(e);
    } finally {
      setBusy(false);
    }
  }
  async function next() {
    if (!attempt || busy) return;
    setBusy(true);
    try {
      if (demo) {
        if (attempt.position === 4) {
          const p = {
            ...progress,
            completed: progress.completed + 1,
            stars: progress.stars + 1,
            stickers: [
              {
                id: attempt.id,
                name: attempt.skill_name + " explorer",
                icon: attempt.subject_slug === "maths" ? "star" : "book",
                earned_at: new Date().toISOString(),
              },
              ...progress.stickers,
            ],
          };
          setProgress(p);
          setAttempt({
            ...attempt,
            status: "completed",
            question: null,
            feedback: null,
            reward: attempt.skill_name + " explorer",
          });
        } else
          setAttempt({
            ...attempt,
            position: attempt.position + 1,
            question: (attempt.subject_slug === "english"
              ? englishDemo
              : demoQuestions)[attempt.position + 1],
            feedback: null,
          });
      } else {
        const a = await api.post<Attempt>(`/attempts/${attempt.id}/next`, {
          position: attempt.position,
        });
        setAttempt(a);
        if (a.status === "completed" && child) {
          setProgress(
            await api.get<Progress>(`/children/${child.id}/progress`),
          );
          setCatalog(await api.get<Subject[]>("/catalog"));
        }
      }
    } catch (e) {
      handleError(e);
    } finally {
      setBusy(false);
    }
  }
  function listen() {
    const url = attempt?.question?.audio_url;
    if (!url) {
      notify(
        "Audio hasn’t been added to this question yet. You can still read it and keep exploring.",
      );
      return;
    }
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
    ) ||
    available[0] ||
    allSkills[0];
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
    <div className="app-shell">
      <a href="#main-content" className="skip-link">
        Skip to adventure
      </a>
      <aside className={`sidebar ${menu ? "open" : ""}`}>
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
            className={`nav-item ${view === "stickers" ? "active" : ""}`}
            onClick={() => navigate("stickers")}
          >
            <Star size={21} />
            My stickers
            {progress.stars > 0 && (
              <span className="nav-count">{progress.stars}</span>
            )}
          </button>
        </nav>
        <div className="side-divider" />
        <button
          className={`nav-item parent-nav ${view === "parent" ? "active" : ""}`}
          onClick={parent}
        >
          <ShieldCheck size={21} />
          Parent corner
          <LockKeyhole size={14} className="nav-lock" />
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
          aria-label="Close navigation"
        />
      )}
      <div className="main-shell">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="icon-btn mobile-menu"
              onClick={() => setMenu(!menu)}
              aria-label="Open navigation"
            >
              <Menu />
            </button>
            <Sun size={20} className="sun-icon" />
            <span>A little curiosity goes a long way.</span>
          </div>
          <div className="topbar-right">
            {demo && <span className="demo-badge">DEMO</span>}
            <div
              className="star-counter"
              aria-label={`${progress.stars} adventure stars`}
            >
              <Star size={18} fill="currentColor" />
              <strong>{progress.stars}</strong>
              <span>stars</span>
            </div>
            <button
              className="profile-button"
              aria-label={`Choose explorer. Current: ${child?.nickname || "Explorer"}`}
              onClick={() => setPicker(true)}
            >
              <span className="avatar">{avatar}</span>
              <span>{child?.nickname || "Explorer"}</span>
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
                  <div className="eyebrow">A NEW DAY, A NEW DISCOVERY</div>
                  <h1>
                    Hey, {nickname}! <span className="wave">👋</span>
                  </h1>
                  <p>What wonderful things will you learn today?</p>
                </div>
                <div className="gentle-pill">
                  <Leaf size={15} /> A little every day
                </div>
              </div>
              <section className="adventure-hero" aria-labelledby="hero-title">
                <div className="hero-copy">
                  <span className="hero-label">
                    <Sparkles size={14} /> YOUR NEXT LITTLE QUEST
                  </span>
                  <h2 id="hero-title">
                    A little learning.
                    <br />A <span>lot of adventure.</span>
                  </h2>
                  <p>
                    Curious minds, big smiles. Let’s discover
                    <br className="desktop-break" /> something new together!
                  </p>
                  <button
                    className="button primary hero-button"
                    onClick={() => start()}
                    disabled={busy}
                  >
                    <Play size={17} fill="currentColor" />
                    {attempt?.status === "active"
                      ? "Resume adventure"
                      : "Continue adventure"}
                    <ArrowRight size={18} />
                  </button>
                  <div className="hero-meta">
                    <span>
                      <Check size={13} /> Just 5 questions
                    </span>
                    <span>
                      <Heart size={13} /> Go at your pace
                    </span>
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
                  {catalog.map((s, i) => (
                    <button
                      key={s.id}
                      className={`subject-card ${s.color}`}
                      onClick={() => {
                        setSubject(s.id);
                        setView("explore");
                      }}
                    >
                      <div className="subject-card-copy">
                        <span className="subject-icon">
                          {s.icon === "calculator" ? (
                            <span>＋</span>
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
                        <span className="subject-footer">
                          {s.skills.length} little adventures{" "}
                          <span className="round-arrow">
                            <ArrowRight size={17} />
                          </span>
                        </span>
                      </div>
                      <div className="subject-art">
                        {s.icon === "calculator" ? (
                          <MathWorld />
                        ) : s.icon === "book" ? (
                          <EnglishWorld />
                        ) : (
                          <DiscoveryWorld globe={s.icon === "globe"} />
                        )}
                      </div>
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
          {view === "stickers" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">LOOK HOW FAR YOU’VE COME</div>
                  <h1>
                    Your little victories <span>🌟</span>
                  </h1>
                  <p>A happy reminder of every adventure you’ve explored.</p>
                </div>
                <div className="gentle-pill">
                  <Trophy size={16} />
                  {progress.stars} adventures complete
                </div>
              </div>
              {!progress.stickers.length ? (
                <div className="empty-state">
                  <span className="empty-sticker">
                    <Star size={60} />
                  </span>
                  <h2>Your first sticker is waiting!</h2>
                  <p>
                    Finish a little adventure to start your collection.
                    <br />
                    Every step is something to celebrate.
                  </p>
                  <button className="button primary" onClick={() => start()}>
                    Let’s explore <ArrowRight size={18} />
                  </button>
                </div>
              ) : (
                <div className="sticker-grid">
                  {progress.stickers.map((s, i) => (
                    <div className={`sticker-card sticker-${i % 3}`} key={s.id}>
                      <span>{["🌟", "🦋", "🌈", "🌻", "🚀", "🍀"][i % 6]}</span>
                      <h2>{s.name}</h2>
                      <p>
                        {new Date(s.earned_at).toLocaleDateString("en", {
                          day: "numeric",
                          month: "short",
                        })}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
          {view === "quiz" && attempt && (
            <>
              {attempt.status === "completed" ? (
                <section className="celebration">
                  <span className="celebration-stars">✦　✧　✦</span>
                  <Fox celebrate />
                  <div className="eyebrow">A LITTLE QUEST, A BIG HIGH FIVE</div>
                  <h1 tabIndex={-1}>You did it, {nickname}!</h1>
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
                  <div className="celebration-actions">
                    <button
                      className="button primary"
                      onClick={() => {
                        setAttempt(null);
                        navigate("home");
                      }}
                    >
                      Back to my adventure <Home size={18} />
                    </button>
                    <button
                      className="text-button"
                      onClick={() => {
                        setAttempt(null);
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
                      <ArrowLeft size={18} />
                      Save & leave
                    </button>
                    <span className="quiz-subject">
                      {attempt.subject_slug === "maths" ? "MATHS" : "ENGLISH"} /{" "}
                      {attempt.skill_name}
                    </span>
                    <span className="question-count">
                      {attempt.position + 1} of 5
                    </span>
                  </div>
                  <div
                    className="quiz-progress"
                    aria-label={`Question ${attempt.position + 1} of 5`}
                  >
                    {Array.from({ length: 5 }, (_, i) => (
                      <span
                        key={i}
                        className={i <= attempt.position ? "filled" : ""}
                      />
                    ))}
                  </div>
                  <div className="question-panel">
                    <div className="question-label">
                      <span>LET’S THINK ABOUT THIS</span>
                      <button className="listen-button" onClick={listen}>
                        <Volume2 size={18} />
                        Listen
                      </button>
                    </div>
                    <h1 tabIndex={-1} key={attempt.question?.id}>
                      {attempt.question?.prompt}
                    </h1>
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
                      {attempt.question?.choices.map((c, i) => (
                        <button
                          key={c.id}
                          aria-pressed={selected === c.id}
                          className={`answer-card ${selected === c.id ? "chosen" : ""} ${attempt.feedback?.correct_choice_id === c.id ? "correct-answer" : ""}`}
                          disabled={!!attempt.feedback || busy}
                          onClick={() => setSelected(c.id)}
                        >
                          <span className="answer-letter">
                            {String.fromCharCode(65 + i)}
                          </span>
                          {c.image_url && <img src={c.image_url} alt="" />}
                          <span>{c.text}</span>
                          {selected === c.id && <Check size={22} />}
                        </button>
                      ))}
                    </div>
                    {attempt.feedback ? (
                      <div
                        className={`feedback ${attempt.feedback.correct ? "positive" : "learning"}`}
                        role="status"
                      >
                        <span className="feedback-icon">
                          {attempt.feedback.correct ? "🌟" : "🌱"}
                        </span>
                        <div>
                          <h2>
                            {attempt.feedback.correct
                              ? "Lovely exploring!"
                              : "A little moment to learn."}
                          </h2>
                          <p>{attempt.feedback.explanation}</p>
                        </div>
                      </div>
                    ) : (
                      <div className="question-encouragement">
                        <Heart size={15} />
                        Take your time. There’s no rush.
                      </div>
                    )}
                    <div className="quiz-actions">
                      {attempt.feedback ? (
                        <button
                          className="button primary"
                          onClick={next}
                          disabled={busy || (!demo && !online)}
                        >
                          {busy
                            ? "Saving…"
                            : attempt.position === 4
                              ? "Finish adventure"
                              : "Next question"}
                          <ArrowRight size={18} />
                        </button>
                      ) : (
                        <button
                          className="button primary"
                          onClick={answer}
                          disabled={!selected || busy || (!demo && !online)}
                        >
                          {busy ? "Saving…" : "Check my answer"}
                          <ArrowRight size={18} />
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="quiz-fox-note">
                    <span>🦊</span>“Trying is how we grow. I’m cheering for
                    you!”
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
              onLogout={() => {
                setSession(null);
                setCatalog(demoCatalog);
                setProgress(emptyProgress);
                setAttempt(null);
                navigate("home");
              }}
              notify={notify}
            />
          )}
          <footer className="page-footer">
            <span>
              little quest. <Heart size={11} />
            </span>
            <span>
              {demo
                ? "Interactive demo · progress stays on this device"
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
      {auth && (
        <AuthDialog
          mode={auth}
          params={authParams}
          onClose={() => setAuth(null)}
          onMode={setAuth}
          onSession={entered}
          notify={notify}
        />
      )}
      {picker && (
        <Dialog
          title={session ? "Who’s ready to explore?" : "Make yourself at home"}
          onClose={() => setPicker(false)}
        >
          <p className="dialog-description">
            {session
              ? "Choose your explorer to begin a little adventure."
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
              <p>Add your first explorer in the parent corner.</p>
              <button
                className="button primary"
                onClick={() => {
                  setPicker(false);
                  parent();
                }}
              >
                Open parent corner
              </button>
            </>
          )}
          {!session && (
            <button
              className="text-button dialog-signin"
              onClick={() => {
                setPicker(false);
                parent();
              }}
            >
              Have an invitation? Sign in or join <ArrowRight size={16} />
            </button>
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
  useEffect(() => {
    const old = document.activeElement as HTMLElement | null;
    const bodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const el = ref.current;
    el?.querySelector<HTMLElement>("input,button,select,textarea")?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        const items = Array.from(
          el?.querySelectorAll<HTMLElement>(
            "button:not([disabled]),input:not([disabled]),select,textarea,a[href]",
          ) || [],
        );
        const first = items[0],
          last = items.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => {
      document.body.style.overflow = bodyOverflow;
      document.removeEventListener("keydown", handler);
      old?.focus();
    };
  }, [onClose]);
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
