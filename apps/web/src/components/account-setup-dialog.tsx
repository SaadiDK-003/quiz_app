"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowRight, Mail } from "lucide-react";
import {
  ApiError,
  type AccountSetupDetails,
  type Session,
} from "@little-quest/api-client";
import { api, Dialog } from "./quiz-app";

export function AccountSetupDialog({
  token,
  session,
  onClose,
  onSignIn,
  onSignedOut,
  onComplete,
}: {
  token: string | null;
  session: Session | null;
  onClose: () => void;
  onSignIn: (email?: string) => void;
  onSignedOut: () => void;
  onComplete: (session: Session, moderator: boolean) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [emailRequested, setEmailRequested] = useState(false);
  const [resendAt, setResendAt] = useState(0);
  const [details, setDetails] = useState<AccountSetupDetails | null>(null);
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const emailHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!token) return;
    let current = true;
    api
      .post<AccountSetupDetails>("/auth/setup/check", { token })
      .then((result) => {
        if (current) setDetails(result);
      })
      .catch((cause: Error) => {
        if (current) setError(cause.message);
      })
      .finally(() => {
        if (current) setChecked(true);
      });
    return () => {
      current = false;
    };
  }, [token]);

  useEffect(() => {
    if (emailRequested) emailHeading.current?.focus();
  }, [emailRequested]);

  useEffect(() => {
    if (!resendAt) return;
    const timer = setTimeout(
      () => setResendAt(0),
      Math.max(0, resendAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [resendAt]);

  async function run(action: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Please try again.");
      if (!token && cause instanceof ApiError && cause.retryAfterSeconds) {
        setResendAt(Date.now() + cause.retryAfterSeconds * 1000);
      }
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  async function requestEmail(e?: FormEvent) {
    e?.preventDefault();
    if (resendAt) return;
    await run(async () => {
      await api.post("/auth/signup", { name, email });
      setEmailRequested(true);
      setResendAt(Date.now() + 60_000);
    });
  }

  async function complete(e: FormEvent) {
    e.preventDefault();
    await run(async () => {
      const account = await api.post<Session>("/auth/setup/complete", {
        token,
        name,
        password,
        password_confirmation: confirmation,
      });
      await onComplete(account, details?.purpose === "moderator");
    });
  }

  const moderator = details?.purpose === "moderator";
  const existing = details?.requires_sign_in;
  const matchingAdult =
    session?.user.email.toLowerCase() === details?.email &&
    session?.mode === "adult";
  const title = token
    ? moderator
      ? "Moderator invitation"
      : "Set up your account"
    : "Create a family account";

  return (
    <Dialog
      title={title}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="auth-emblem">
        <Mail size={28} aria-hidden="true" />
      </div>
      {!token && !emailRequested && (
        <form className="form-stack account-setup-form" onSubmit={requestEmail}>
          <p>
            Save a separate learning record for each child. We’ll email you a
            link to set your password.
          </p>
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
          <label>
            Parent email address
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              maxLength={254}
            />
          </label>
          <button
            className="button primary"
            disabled={busy || Boolean(resendAt)}
          >
            {busy ? "Sending…" : "Email me a setup link"}{" "}
            <ArrowRight size={18} aria-hidden="true" />
          </button>
        </form>
      )}
      {!token && emailRequested && (
        <div className="form-stack account-setup-form">
          <h3 ref={emailHeading} tabIndex={-1}>
            Check your email
          </h3>
          <p>
            If <strong>{email.trim()}</strong> can be used for a new account,
            you’ll receive a setup link. Check your spam folder if the email
            takes a while.
          </p>
          <button
            className="button secondary"
            onClick={() => void requestEmail()}
            disabled={busy || Boolean(resendAt)}
          >
            {busy
              ? "Sending…"
              : resendAt
                ? "Resend available shortly"
                : "Resend setup email"}
          </button>
          <button
            className="text-button"
            onClick={() => {
              setEmailRequested(false);
              setResendAt(0);
              setError("");
            }}
            disabled={busy}
          >
            Change email address
          </button>
        </div>
      )}
      {token && !checked && (
        <p className="dialog-description" role="status">
          Checking your link…
        </p>
      )}
      {token && details && (
        <div className="form-stack account-setup-form">
          <p>
            {moderator
              ? "Accept this invitation to help prepare quiz content in Content Studio."
              : "Choose a password to finish creating your family account."}
          </p>
          <p>
            Email address <strong>{details.email}</strong>
          </p>
          {existing && !matchingAdult ? (
            <button
              className="button primary"
              onClick={() => onSignIn(details.email)}
            >
              Sign in to accept <ArrowRight size={18} aria-hidden="true" />
            </button>
          ) : !existing && session ? (
            <button
              className="button secondary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await api.post("/auth/logout");
                  onSignedOut();
                })
              }
            >
              Sign out to continue
            </button>
          ) : (
            <form className="form-stack" onSubmit={complete}>
              {!existing && (
                <>
                  {moderator && (
                    <label>
                      Your name
                      <input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        autoComplete="name"
                        required
                        maxLength={80}
                      />
                    </label>
                  )}
                  <label>
                    Password
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      minLength={10}
                    />
                  </label>
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
                      minLength={10}
                    />
                  </label>
                </>
              )}
              <button className="button primary" disabled={busy}>
                {busy
                  ? "Saving…"
                  : moderator
                    ? "Accept moderator invitation"
                    : "Create family account"}{" "}
                <ArrowRight size={18} aria-hidden="true" />
              </button>
            </form>
          )}
        </div>
      )}
      {error && (
        <p className="form-error account-setup-error" role="alert">
          {error}
        </p>
      )}
      {(!token || (checked && !details)) && (
        <button
          className="text-button dialog-signin"
          onClick={() => onSignIn()}
        >
          Back to sign in
        </button>
      )}
    </Dialog>
  );
}
