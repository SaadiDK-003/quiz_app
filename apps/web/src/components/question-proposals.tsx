"use client";

import { useRef, useState, type FormEvent } from "react";
import { ArrowRight, Eye, Pencil, Send } from "lucide-react";
import {
  ApiError,
  type AdminQuestion,
  type QuestionProposal,
} from "@little-quest/api-client";
import { api, Dialog } from "./quiz-app";
import { ageRangeLabels } from "../lib/age-ranges";

const proposalStatuses: Record<QuestionProposal["state"], string> = {
  draft: "Draft",
  in_review: "In review",
  changes_requested: "Changes requested",
  published: "Published",
};

export function QuestionProposals({
  proposals,
  admin,
  onPreview,
  onEdit,
  onReview,
  onSubmit,
}: {
  proposals: QuestionProposal[];
  admin: boolean;
  onPreview: (proposal: QuestionProposal) => void;
  onEdit: (proposal: QuestionProposal) => void;
  onReview: (proposal: QuestionProposal) => void;
  onSubmit: (proposal: QuestionProposal) => Promise<void>;
}) {
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const visible = admin
    ? proposals.filter((draft) => draft.state === "in_review")
    : proposals;

  async function submit(proposal: QuestionProposal) {
    if (pending.current) return;
    pending.current = true;
    setPendingId(proposal.id);
    setError("");
    try {
      await onSubmit(proposal);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The draft could not be submitted.",
      );
    } finally {
      pending.current = false;
      setPendingId(null);
    }
  }

  return (
    <section
      className="proposal-list"
      aria-label={admin ? "Questions awaiting review" : "Your quiz drafts"}
    >
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!visible.length && (
        <p className="muted">
          {admin
            ? "No questions are waiting for review."
            : "Create a draft or propose an edit from the quiz library."}
        </p>
      )}
      {visible.map((proposal) => {
        const editable =
          proposal.state === "draft" || proposal.state === "changes_requested";
        return (
          <article className="proposal-row" key={proposal.id}>
            <div className="question-copy">
              <strong>{proposal.question.prompt}</strong>
              <small>
                {proposal.question.skill_name} ·{" "}
                {proposal.question_id ? "Question update" : "New question"}
                {admin && proposal.author_name
                  ? ` · ${proposal.author_name}`
                  : ""}
              </small>
              {proposal.review_note && (
                <p className="proposal-note">
                  <strong>Review feedback</strong> {proposal.review_note}
                </p>
              )}
            </div>
            <span className={`status-tag ${proposal.state}`}>
              {proposalStatuses[proposal.state]}
            </span>
            <div className="proposal-actions">
              {admin ? (
                <button
                  className="button secondary"
                  onClick={() => onReview(proposal)}
                >
                  Review <ArrowRight size={16} aria-hidden="true" />
                </button>
              ) : (
                <>
                  <button
                    className="studio-row-action"
                    onClick={() => onPreview(proposal)}
                  >
                    <Eye size={18} aria-hidden="true" /> Preview
                  </button>
                  {editable && (
                    <>
                      <button
                        className="studio-row-action"
                        onClick={() => onEdit(proposal)}
                        disabled={pendingId !== null}
                      >
                        <Pencil size={18} aria-hidden="true" /> Edit
                      </button>
                      <button
                        className="button secondary"
                        onClick={() => void submit(proposal)}
                        disabled={pendingId !== null}
                      >
                        <Send size={16} aria-hidden="true" />{" "}
                        {pendingId === proposal.id
                          ? "Sending…"
                          : "Send for review"}
                      </button>
                    </>
                  )}
                </>
              )}
            </div>
          </article>
        );
      })}
    </section>
  );
}

function ReviewQuestion({
  title,
  question,
}: {
  title: string;
  question: AdminQuestion;
}) {
  return (
    <section className="review-question">
      <h3>{title}</h3>
      <p className="muted">
        {question.skill_name} · {question.difficulty} ·{" "}
        {question.age_bands.length
          ? `Ages ${ageRangeLabels(question.age_bands)}`
          : "Needs an age group"}
      </p>
      <strong>{question.prompt}</strong>
      <p>{question.instruction}</p>
      {question.image_path && (
        <img
          className="question-image"
          src={"/storage/" + question.image_path}
          alt={question.image_alt || ""}
        />
      )}
      <ul>
        {question.choices.map((choice) => (
          <li key={choice.id}>
            {choice.image_url && (
              <img className="editor-image" src={choice.image_url} alt="" />
            )}
            {choice.text}{" "}
            {choice.id === question.correct_choice_id && (
              <strong>(correct)</strong>
            )}
          </li>
        ))}
      </ul>
      <p>{question.explanation}</p>
      {question.audio_path ? (
        <audio
          controls
          aria-label={`Listen to ${title.toLowerCase()}`}
          src={"/storage/" + question.audio_path}
        />
      ) : (
        <p className="muted">Text only</p>
      )}
    </section>
  );
}

export function ProposalReviewDialog({
  proposal,
  current,
  onClose,
  onRefresh,
  onReviewed,
}: {
  proposal: QuestionProposal;
  current?: AdminQuestion;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onReviewed: (published: boolean) => Promise<void>;
}) {
  const [answers, setAnswers] = useState(false);
  const [explanation, setExplanation] = useState(false);
  const [narration, setNarration] = useState(false);
  const [returning, setReturning] = useState(false);
  const [note, setNote] = useState("");
  const [stale, setStale] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending.current || stale) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await api.post(`/studio/proposals/${proposal.id}/review`, {
        decision: returning ? "return" : "publish",
        version: proposal.version,
        question_version: current?.version ?? null,
        review_note: returning ? note : null,
        answers_reviewed: answers,
        explanation_reviewed: explanation,
        narration_reviewed: narration,
      });
      await onReviewed(!returning);
    } catch (cause) {
      setStale(cause instanceof ApiError && cause.status === 409);
      setError(
        cause instanceof Error
          ? cause.message
          : "The review could not be saved.",
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <Dialog
      title="Review a quiz draft"
      onClose={() => {
        if (!busy) onClose();
      }}
      wide
    >
      {current && current.version !== proposal.base_version && (
        <p className="form-error">
          The question changed after this draft was started. Compare it with the
          current version before publishing.
        </p>
      )}
      <div className="proposal-comparison">
        {current && (
          <ReviewQuestion
            title={
              current.status === "published"
                ? "Live question"
                : "Current question"
            }
            question={current}
          />
        )}
        <ReviewQuestion
          title="Proposed question"
          question={proposal.question}
        />
      </div>
      <form className="form-stack" onSubmit={submit}>
        {returning ? (
          <label>
            What should the moderator change?
            <textarea
              required
              maxLength={1000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
        ) : (
          <fieldset className="review-checks">
            <legend>Required before publishing</legend>
            <label>
              <input
                type="checkbox"
                checked={answers}
                onChange={(e) => setAnswers(e.target.checked)}
              />
              I checked the question, choices and correct answer.
            </label>
            <label>
              <input
                type="checkbox"
                checked={explanation}
                onChange={(e) => setExplanation(e.target.checked)}
              />
              I checked the explanation for accuracy and age-appropriate
              wording.
            </label>
            {proposal.question.audio_path && (
              <label>
                <input
                  type="checkbox"
                  checked={narration}
                  onChange={(e) => setNarration(e.target.checked)}
                />
                I listened to the narration and checked it doesn’t reveal the
                answer.
              </label>
            )}
          </fieldset>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {stale ? (
          <button
            type="button"
            className="button primary"
            onClick={() =>
              void onRefresh().catch((cause: Error) => setError(cause.message))
            }
          >
            Refresh review queue
          </button>
        ) : (
          <div className="dialog-actions">
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() => setReturning(!returning)}
            >
              {returning ? "Back to review" : "Request changes"}
            </button>
            <button
              className="button primary"
              disabled={
                busy ||
                (!returning &&
                  !(
                    answers &&
                    explanation &&
                    (!proposal.question.audio_path || narration)
                  ))
              }
            >
              {busy
                ? "Saving…"
                : returning
                  ? "Return to moderator"
                  : "Publish question"}
            </button>
          </div>
        )}
      </form>
    </Dialog>
  );
}
