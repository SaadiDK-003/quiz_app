"use client";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  Check,
  ChevronRight,
  LogOut,
  Mail,
  Pencil,
  Plus,
  Settings2,
  ShieldCheck,
  Star,
  Trash2,
  Users,
} from "lucide-react";
import type {
  Child,
  Progress,
  Session,
  Subject,
} from "@little-quest/api-client";
import { api, Dialog, type Notice } from "./quiz-app";
import { AdminPanel } from "./admin-panel";
export function AuthDialog({
  mode,
  params,
  onClose,
  onMode,
  onSession,
  notify,
}: {
  mode: string;
  params: { invite: string; email: string; token: string };
  onClose: () => void;
  onMode: (s: string) => void;
  onSession: (s: Session) => Promise<void>;
  notify: Notice;
}) {
  const [email, setEmail] = useState(params.email),
    [password, setPassword] = useState(""),
    [confirmation, setConfirmation] = useState(""),
    [name, setName] = useState(""),
    [invite, setInvite] = useState(params.invite),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    setError("");
    setPassword("");
    setConfirmation("");
  }, [mode]);
  const titles: Record<string, string> = {
    login: "Welcome, grown-ups.",
    register: "Your family adventure starts here.",
    reauth: "A little grown-up check.",
    forgot: "Let’s get you back in.",
    reset: "Choose a fresh password.",
  };
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (mode === "forgot") {
        const r = await api.post<{ message: string }>("/auth/forgot-password", {
          email,
        });
        notify(r.message);
        onMode("login");
      } else if (mode === "reset") {
        const r = await api.post<{ message: string }>("/auth/reset-password", {
          email,
          token: params.token,
          password,
          password_confirmation: confirmation,
        });
        notify(r.message);
        history.replaceState(null, "", "/");
        onMode("login");
      } else {
        const path =
          mode === "reauth"
            ? "reauthenticate"
            : mode === "register"
              ? "register"
              : "login";
        const s = await api.post<Session>(`/auth/${path}`, {
          email,
          password,
          password_confirmation: confirmation,
          name,
          invite,
        });
        await onSession(s);
        if (mode === "register") {
          history.replaceState(null, "", "/");
          notify(
            "Your account is ready. Please verify your email to add explorers.",
          );
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title={titles[mode] || titles.login} onClose={onClose}>
      <div className="auth-emblem">
        <ShieldCheck size={28} />
      </div>
      <p className="dialog-description">
        {mode === "reauth"
          ? "Enter your parent password to open settings and family progress."
          : mode === "register"
            ? "Little Quest is an invitation-only family pilot. Let’s create your parent account."
            : "A quiet corner to look after your little explorers."}
      </p>
      <form onSubmit={submit} className="form-stack">
        {mode === "register" && (
          <label>
            Your name
            <input
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={80}
            />
          </label>
        )}
        {mode !== "reauth" && (
          <label>
            Email address
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
        )}
        {mode === "register" && (
          <label>
            Invitation code
            <input
              value={invite}
              onChange={(e) => setInvite(e.target.value)}
              required
              placeholder="From your invitation link"
            />
          </label>
        )}
        {mode !== "forgot" && (
          <label>
            {mode === "reset" ? "New password" : "Password"}
            <input
              type="password"
              autoComplete={
                mode === "register" || mode === "reset"
                  ? "new-password"
                  : "current-password"
              }
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={mode === "register" || mode === "reset" ? 10 : 1}
            />
          </label>
        )}
        {(mode === "register" || mode === "reset") && (
          <>
            <small>
              Use at least 10 characters, including letters and numbers.
            </small>
            <label>
              Confirm password
              <input
                type="password"
                autoComplete="new-password"
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                required
              />
            </label>
          </>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button disabled={busy} className="button primary full-width">
          {busy
            ? "One little moment…"
            : mode === "login"
              ? "Sign in"
              : mode === "register"
                ? "Create parent account"
                : mode === "reauth"
                  ? "Open parent corner"
                  : mode === "forgot"
                    ? "Send reset link"
                    : "Reset password"}
          <ArrowRight size={18} />
        </button>
      </form>
      {mode === "login" && (
        <div className="auth-links">
          <button onClick={() => onMode("forgot")}>Forgot password?</button>
          <button onClick={() => onMode("register")}>
            I have an invitation <ChevronRight size={14} />
          </button>
        </div>
      )}
      {["register", "forgot", "reset"].includes(mode) && (
        <button
          className="text-button dialog-signin"
          onClick={() => onMode("login")}
        >
          Back to sign in
        </button>
      )}
    </Dialog>
  );
}
export function ParentPanel({
  session,
  catalog,
  onSession,
  onLogout,
  notify,
}: {
  session: Session;
  catalog: Subject[];
  onSession: (s: Session) => Promise<void>;
  onLogout: () => void;
  notify: Notice;
}) {
  const [children, setChildren] = useState<Child[]>(session.children),
    [chosen, setChosen] = useState<number | null>(
      session.children[0]?.id || null,
    ),
    [progress, setProgress] = useState<Progress | null>(null),
    [editor, setEditor] = useState<Child | true | null>(null),
    [tab, setTab] = useState("family"),
    [busy, setBusy] = useState(false),
    [deleteAccount, setDeleteAccount] = useState(false),
    [password, setPassword] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    setChildren(session.children);
  }, [session.children]);
  useEffect(() => {
    setProgress(null);
    if (chosen && session.user.email_verified_at)
      api
        .get<Progress>(`/children/${chosen}/progress`)
        .then(setProgress)
        .catch((e) => notify(e.message));
  }, [chosen, session.user.email_verified_at, notify]);
  async function loadChildren() {
    const c = await api.get<Child[]>("/children");
    setChildren(c);
    if (!chosen || !c.find((x) => x.id === chosen)) setChosen(c[0]?.id || null);
    setEditor(null);
    await onSession(await api.get<Session>("/session"));
  }
  async function logout() {
    try {
      await api.post("/auth/logout");
      onLogout();
    } catch (e) {
      notify((e as Error).message);
    }
  }
  async function enter(c: Child) {
    setBusy(true);
    try {
      await onSession(await api.post<Session>(`/children/${c.id}/enter`));
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(c: Child) {
    if (
      !confirm(
        `Delete ${c.nickname}’s profile and all their learning progress? This cannot be undone.`,
      )
    )
      return;
    try {
      await api.delete(`/children/${c.id}`);
      await loadChildren();
      notify("Explorer profile deleted.");
    } catch (e) {
      notify((e as Error).message);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">A LITTLE SPACE FOR GROWN-UPS</div>
          <h1>
            Parent corner <span>🌿</span>
          </h1>
          <p>
            Hello, {session.user.name}. Here’s how your little explorers are
            growing.
          </p>
        </div>
        <button className="button secondary" onClick={logout}>
          <LogOut size={17} />
          Sign out
        </button>
      </div>
      {!session.user.email_verified_at ? (
        <div className="empty-state">
          <Mail size={50} />
          <h2>One little check before we begin.</h2>
          <p>
            Please open the verification email sent to {session.user.email}.
            <br />
            Then refresh this page to set up your explorers.
          </p>
          <button
            className="button primary"
            onClick={async () => {
              try {
                const r = await api.post<{ message: string }>(
                  "/auth/verification-notification",
                );
                notify(r.message);
              } catch (e) {
                notify((e as Error).message);
              }
            }}
          >
            Send verification email
          </button>
        </div>
      ) : (
        <>
          <div className="filter-tabs">
            <button
              className={tab === "family" ? "selected" : ""}
              onClick={() => setTab("family")}
            >
              <Users size={16} />
              My family
            </button>
            {session.user.role === "admin" && (
              <button
                className={tab === "admin" ? "selected" : ""}
                onClick={() => setTab("admin")}
              >
                <Settings2 size={16} />
                Content studio
              </button>
            )}
            <button
              className={tab === "account" ? "selected" : ""}
              onClick={() => setTab("account")}
            >
              Account
            </button>
          </div>
          {tab === "family" && (
            <>
              <div className="section-heading">
                <h2>Your explorers</h2>
                <button
                  className="button secondary"
                  onClick={() => setEditor(true)}
                >
                  <Plus size={18} />
                  Add explorer
                </button>
              </div>
              <div className="children-grid">
                {children.map((c) => (
                  <div
                    className={`child-card ${chosen === c.id ? "selected" : ""}`}
                    key={c.id}
                  >
                    <button
                      className="child-select"
                      onClick={() => setChosen(c.id)}
                    >
                      <span>
                        {
                          {
                            fox: "🦊",
                            bear: "🐻",
                            bunny: "🐰",
                            panda: "🐼",
                            cat: "🐱",
                            frog: "🐸",
                          }[c.avatar]
                        }
                      </span>
                      <strong>{c.nickname}</strong>
                      <small>Ages {c.age_band}</small>
                    </button>
                    <button
                      className="button primary"
                      disabled={busy}
                      onClick={() => enter(c)}
                    >
                      Let’s explore <ArrowRight size={16} />
                    </button>
                    <div className="child-actions">
                      <button onClick={() => setEditor(c)}>
                        <Pencil size={14} />
                        Edit
                      </button>
                      <button onClick={() => remove(c)}>
                        <Trash2 size={14} />
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
                {!children.length && (
                  <div className="empty-state small">
                    <Users size={40} />
                    <h2>Meet your first explorer.</h2>
                    <p>
                      Add a nickname, pick an avatar, and choose a starting
                      skill.
                    </p>
                    <button
                      className="button primary"
                      onClick={() => setEditor(true)}
                    >
                      <Plus size={18} />
                      Add explorer
                    </button>
                  </div>
                )}
              </div>
              {chosen && (
                <>
                  <div className="section-heading">
                    <div>
                      <h2>
                        {children.find((c) => c.id === chosen)?.nickname}’s
                        little victories
                      </h2>
                      <p>
                        Practice is progress. These numbers show completed
                        adventures.
                      </p>
                    </div>
                  </div>
                  <div className="stats-grid">
                    <div>
                      <span>
                        <FlagIcon />
                        Adventures completed
                      </span>
                      <strong>{progress?.completed ?? "—"}</strong>
                    </div>
                    <div>
                      <span>
                        <Star size={18} />
                        First-answer accuracy
                      </span>
                      <strong>
                        {progress?.completed ? progress.accuracy + "%" : "—"}
                      </strong>
                    </div>
                    <div>
                      <span>
                        <Check size={18} />
                        Skills explored
                      </span>
                      <strong>{progress?.skills.length ?? "—"}</strong>
                    </div>
                  </div>
                  <div className="report-grid">
                    <section className="report-card">
                      <h3>Growing skills</h3>
                      {progress?.skills.length ? (
                        progress.skills.map((s) => (
                          <div className="skill-report" key={s.id}>
                            <div>
                              <strong>{s.name}</strong>
                              <span>
                                {s.subject} · {s.completed} adventures
                              </span>
                            </div>
                            <span
                              className={
                                s.accuracy < 70 ? "review-tag" : "good-tag"
                              }
                            >
                              {s.accuracy < 70
                                ? "Worth revisiting"
                                : s.accuracy + "%"}
                            </span>
                          </div>
                        ))
                      ) : (
                        <p className="muted">
                          Complete an adventure to see learning progress here.
                        </p>
                      )}
                    </section>
                    <section className="report-card">
                      <h3>Recent discoveries</h3>
                      {progress?.recent.length ? (
                        progress.recent.map((a) => (
                          <div className="skill-report" key={a.id}>
                            <div>
                              <strong>{a.skill_name}</strong>
                              <span>
                                {new Date(a.completed_at).toLocaleDateString(
                                  "en",
                                  { month: "short", day: "numeric" },
                                )}
                              </span>
                            </div>
                            <span>
                              {a.score} / {a.total}
                            </span>
                          </div>
                        ))
                      ) : (
                        <p className="muted">
                          Your explorer’s first discovery is waiting.
                        </p>
                      )}
                    </section>
                  </div>
                </>
              )}
            </>
          )}
          {tab === "admin" && session.user.role === "admin" && (
            <AdminPanel
              notify={notify}
              onCatalogChanged={async () => {
                await onSession(await api.get<Session>("/session"));
              }}
            />
          )}
          {tab === "account" && (
            <section className="report-card account-card">
              <h2>Your parent account</h2>
              <p>{session.user.email}</p>
              <p className="muted">
                Child profiles use nicknames and age bands. No child email
                address or date of birth is needed.
              </p>
              <button
                className="button danger"
                onClick={() => setDeleteAccount(true)}
              >
                <Trash2 size={17} />
                Delete account and family data
              </button>
            </section>
          )}
        </>
      )}
      {editor && (
        <ProfileEditor
          child={editor === true ? null : editor}
          catalog={catalog}
          onClose={() => setEditor(null)}
          onSaved={loadChildren}
        />
      )}
      {deleteAccount && (
        <Dialog
          title="Delete your family account?"
          onClose={() => setDeleteAccount(false)}
        >
          <p className="dialog-description">
            This permanently deletes your account, child profiles, progress, and
            stickers. Enter your password to confirm.
          </p>
          <form
            className="form-stack"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              try {
                await api.delete("/account", { password });
                onLogout();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              Parent password
              <input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            {error && (
              <p role="alert" className="form-error">
                {error}
              </p>
            )}
            <button className="button danger" disabled={busy}>
              Permanently delete family account
            </button>
          </form>
        </Dialog>
      )}
    </>
  );
}
function FlagIcon() {
  return <ShieldCheck size={18} />;
}
function ProfileEditor({
  child,
  catalog,
  onClose,
  onSaved,
}: {
  child: Child | null;
  catalog: Subject[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [nickname, setNickname] = useState(child?.nickname || ""),
    [avatar, setAvatar] = useState(child?.avatar || "fox"),
    [age, setAge] = useState(child?.age_band || "7-8"),
    [starts, setStarts] = useState<Record<string, number>>(
      child?.starting_skills ||
        Object.fromEntries(
          catalog
            .filter((s) => s.skills.length)
            .map((s) => [s.id, s.skills[0].id]),
        ),
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <Dialog
      title={child ? "A little explorer update." : "Meet your little explorer."}
      onClose={onClose}
    >
      <form
        className="form-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            const data = {
              nickname,
              avatar,
              age_band: age,
              starting_skills: starts,
            };
            if (child) await api.put(`/children/${child.id}`, data);
            else await api.post("/children", data);
            await onSaved();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Nickname
          <input
            required
            maxLength={40}
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder="What should we call your explorer?"
          />
        </label>
        <fieldset className="avatar-fieldset">
          <legend>Choose a friend</legend>
          <div className="avatar-grid compact">
            {Object.entries({
              fox: "🦊",
              bear: "🐻",
              bunny: "🐰",
              panda: "🐼",
              cat: "🐱",
              frog: "🐸",
            }).map(([key, emoji]) => (
              <button
                type="button"
                aria-label={key}
                aria-pressed={avatar === key}
                className={avatar === key ? "selected" : ""}
                key={key}
                onClick={() => setAvatar(key)}
              >
                <span>{emoji}</span>
              </button>
            ))}
          </div>
        </fieldset>
        <label>
          Age band
          <select value={age} onChange={(e) => setAge(e.target.value)}>
            <option value="7-8">7–8 years</option>
            <option value="9-10">9–10 years</option>
          </select>
        </label>
        {catalog.map((s) => (
          <label key={s.id}>
            {s.name}: start exploring from
            <select
              value={starts[s.id] || ""}
              onChange={(e) =>
                setStarts({ ...starts, [s.id]: Number(e.target.value) })
              }
            >
              {s.skills.map((k) => (
                <option value={k.id} key={k.id}>
                  {k.name}
                </option>
              ))}
            </select>
          </label>
        ))}
        <small>
          This guides their next adventure. They can still explore other topics.
        </small>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="button primary" disabled={busy}>
          {busy ? "Saving…" : child ? "Save explorer" : "Add explorer"}
          <ArrowRight size={18} />
        </button>
      </form>
    </Dialog>
  );
}
