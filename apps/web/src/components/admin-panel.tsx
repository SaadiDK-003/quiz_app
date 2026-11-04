"use client";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  Eye,
  Mail,
  Pencil,
  Plus,
  Save,
  Upload,
  X,
} from "lucide-react";
import type { AdminQuestion, Skill, Subject } from "@little-quest/api-client";
import { api, Dialog, type Notice } from "./quiz-app";
interface Meta {
  subjects: Subject[];
  topics: { id: number; subject_id: number; name: string; position: number }[];
  skills: Skill[];
}
export function AdminPanel({
  notify,
  onCatalogChanged,
}: {
  notify: Notice;
  onCatalogChanged: () => Promise<void>;
}) {
  const [questions, setQuestions] = useState<AdminQuestion[]>([]),
    [meta, setMeta] = useState<Meta | null>(null),
    [filter, setFilter] = useState("all"),
    [skill, setSkill] = useState("all"),
    [editing, setEditing] = useState<AdminQuestion | null>(null),
    [preview, setPreview] = useState<AdminQuestion | null>(null),
    [metadata, setMetadata] = useState(false),
    [invite, setInvite] = useState(false),
    [email, setEmail] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function load() {
    const [q, m] = await Promise.all([
      api.get<AdminQuestion[]>("/admin/questions"),
      api.get<Meta>("/admin/metadata"),
    ]);
    setQuestions(q);
    setMeta(m);
  }
  useEffect(() => {
    load().catch((e) => notify(e.message));
  }, [notify]);
  function newQuestion() {
    if (!meta?.skills.length) {
      notify("Add a skill before creating a question.");
      return;
    }
    setEditing({
      id: 0,
      skill_id: meta.skills[0].id,
      skill_name: meta.skills[0].name,
      prompt: "",
      instruction: "Choose the best answer.",
      choices: [
        { id: "a", text: "" },
        { id: "b", text: "" },
        { id: "c", text: "" },
        { id: "d", text: "" },
      ],
      correct_choice_id: "a",
      explanation: "",
      difficulty: "starter",
      locale: "en",
      status: "draft",
      image_path: null,
      image_alt: null,
      audio_path: null,
      answers_reviewed: false,
      explanation_reviewed: false,
      narration_reviewed: false,
      version: 0,
    });
  }
  const shown = questions.filter(
    (q) =>
      (filter === "all" || q.status === filter) &&
      (skill === "all" || q.skill_id === Number(skill)),
  );
  return (
    <>
      <div className="section-heading">
        <div>
          <h2>Content studio</h2>
          <p>
            {questions.length} questions ·{" "}
            {questions.filter((q) => q.status === "published").length} published
            · Adult review required
          </p>
        </div>
        <div className="button-group">
          <button className="button secondary" onClick={() => setInvite(true)}>
            <Mail size={17} />
            Invite family
          </button>
          <button
            className="button secondary"
            onClick={() => setMetadata(true)}
          >
            <BookOpen size={17} />
            Learning catalog
          </button>
          <button className="button primary" onClick={newQuestion}>
            <Plus size={17} />
            New question
          </button>
        </div>
      </div>
      <div className="admin-filters">
        <label>
          Status
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            {["all", "draft", "published", "archived"].map((x) => (
              <option key={x} value={x}>
                {x[0].toUpperCase() + x.slice(1)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Skill
          <select value={skill} onChange={(e) => setSkill(e.target.value)}>
            <option value="all">All skills</option>
            {meta?.skills.map((k) => (
              <option key={k.id} value={k.id}>
                {k.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="question-list">
        {shown.map((q) => (
          <div className="question-row" key={q.id}>
            <span className={`status-dot ${q.status}`} />
            <div>
              <strong>{q.prompt}</strong>
              <small>
                {q.skill_name} · Revision {q.version}
              </small>
            </div>
            <span className={`status-tag ${q.status}`}>{q.status}</span>
            <button
              className="icon-btn"
              aria-label={`Preview ${q.prompt}`}
              onClick={() => setPreview(q)}
            >
              <Eye size={18} />
            </button>
            <button
              className="icon-btn"
              aria-label={`Edit ${q.prompt}`}
              onClick={() => setEditing(q)}
            >
              <Pencil size={18} />
            </button>
          </div>
        ))}
        {!shown.length && (
          <p className="muted">No questions match these filters.</p>
        )}
      </div>
      {editing && meta && (
        <QuestionEditor
          question={editing}
          skills={meta.skills}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            await load();
            setEditing(null);
            notify("Question revision saved.");
          }}
        />
      )}
      {preview && (
        <Dialog title="Child preview" onClose={() => setPreview(null)} wide>
          <span className="small-label">
            {preview.skill_name} · {preview.status}
          </span>
          <h3 className="preview-prompt">{preview.prompt}</h3>
          {preview.image_path && (
            <img
              className="question-image"
              src={"/storage/" + preview.image_path}
              alt={preview.image_alt || ""}
            />
          )}
          <p>{preview.instruction}</p>
          <div className="answer-grid">
            {preview.choices.map((c) => (
              <button
                className="answer-card"
                key={c.id}
                onClick={() =>
                  notify(
                    c.id === preview.correct_choice_id
                      ? "Correct! " + preview.explanation
                      : "A little moment to learn. " + preview.explanation,
                  )
                }
              >
                {c.image_url && <img src={c.image_url} alt="" />}
                {c.text}
              </button>
            ))}
          </div>
          {preview.audio_path && (
            <audio controls src={"/storage/" + preview.audio_path} />
          )}
          <p className="muted">
            Preview only. Answers here do not create learning records.
          </p>
        </Dialog>
      )}
      {metadata && meta && (
        <CatalogEditor
          metadata={meta}
          onClose={() => setMetadata(false)}
          onSaved={async () => {
            await load();
            await onCatalogChanged();
          }}
          notify={notify}
        />
      )}
      {invite && (
        <Dialog
          title="Invite a little explorer’s family."
          onClose={() => setInvite(false)}
        >
          <p className="dialog-description">
            We’ll email a private registration link to their parent. Invitations
            expire after seven days.
          </p>
          <form
            className="form-stack"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              try {
                const r = await api.post<{ message: string }>(
                  "/admin/invitations",
                  { email },
                );
                notify(r.message);
                setInvite(false);
                setEmail("");
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              Parent email
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <button className="button primary" disabled={busy}>
              {busy ? "Sending…" : "Send family invitation"}
              <ArrowRight size={18} />
            </button>
          </form>
        </Dialog>
      )}
    </>
  );
}
function QuestionEditor({
  question,
  skills,
  onClose,
  onSaved,
}: {
  question: AdminQuestion;
  skills: Skill[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [q, setQ] = useState(question),
    [busy, setBusy] = useState(false),
    [uploading, setUploading] = useState(false),
    [error, setError] = useState("");
  function patch(v: Partial<AdminQuestion>) {
    setQ({ ...q, ...v });
  }
  async function upload(
    file: File | undefined,
    kind: "image" | "audio",
    choice?: number,
  ) {
    if (!file) return;
    setUploading(true);
    setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      const r = await api.upload<{ path: string; url: string }>(
        "/admin/media",
        form,
      );
      if (choice !== undefined)
        patch({
          choices: q.choices.map((c, i) =>
            i === choice ? { ...c, image_url: r.url } : c,
          ),
          answers_reviewed: false,
        });
      else if (kind === "audio")
        patch({ audio_path: r.path, narration_reviewed: false });
      else patch({ image_path: r.path });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }
  return (
    <Dialog
      title={
        question.id
          ? "Review this little question."
          : "Create a little question."
      }
      onClose={onClose}
      wide
    >
      <form
        className="form-stack question-editor"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            if (q.id) await api.put(`/admin/questions/${q.id}`, q);
            else await api.post("/admin/questions", q);
            await onSaved();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="form-columns">
          <label>
            Skill
            <select
              value={q.skill_id}
              onChange={(e) => patch({ skill_id: Number(e.target.value) })}
            >
              {skills.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Difficulty
            <select
              value={q.difficulty}
              onChange={(e) => patch({ difficulty: e.target.value })}
            >
              {["starter", "growing", "challenge"].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
        </div>
        <label>
          Question
          <textarea
            required
            value={q.prompt}
            maxLength={2000}
            onChange={(e) =>
              patch({
                prompt: e.target.value,
                answers_reviewed: false,
                narration_reviewed: false,
              })
            }
          />
        </label>
        <label>
          Instruction
          <input
            required
            value={q.instruction}
            onChange={(e) =>
              patch({ instruction: e.target.value, narration_reviewed: false })
            }
          />
        </label>
        <fieldset className="choice-fieldset">
          <legend>Answer cards</legend>
          {q.choices.map((c, i) => (
            <div className="choice-editor" key={c.id}>
              <label className="correct-radio">
                <input
                  aria-label={`Answer ${c.id.toUpperCase()} is correct`}
                  type="radio"
                  name="correct"
                  checked={q.correct_choice_id === c.id}
                  onChange={() =>
                    patch({ correct_choice_id: c.id, answers_reviewed: false })
                  }
                />
                <strong>{c.id.toUpperCase()}</strong>
              </label>
              <input
                aria-label={`Answer ${c.id.toUpperCase()} text`}
                required
                value={c.text}
                onChange={(e) =>
                  patch({
                    choices: q.choices.map((a, j) =>
                      i === j ? { ...a, text: e.target.value } : a,
                    ),
                    answers_reviewed: false,
                    narration_reviewed: false,
                  })
                }
              />
              <label className="upload-choice" title="Upload an answer picture">
                <Upload size={16} />
                <input
                  aria-label={`Upload answer ${c.id.toUpperCase()} picture`}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(e) => upload(e.target.files?.[0], "image", i)}
                />
              </label>
              {c.image_url && (
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Remove answer picture"
                  onClick={() =>
                    patch({
                      choices: q.choices.map((a, j) =>
                        i === j ? { ...a, image_url: null } : a,
                      ),
                      answers_reviewed: false,
                    })
                  }
                >
                  <X size={16} />
                </button>
              )}
            </div>
          ))}
        </fieldset>
        <label>
          Friendly explanation
          <textarea
            required
            maxLength={2000}
            value={q.explanation}
            onChange={(e) =>
              patch({
                explanation: e.target.value,
                explanation_reviewed: false,
              })
            }
          />
        </label>
        <div className="media-fields">
          <label>
            Question illustration
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => upload(e.target.files?.[0], "image")}
            />
            {q.image_path && (
              <>
                <img
                  className="editor-image"
                  src={"/storage/" + q.image_path}
                  alt={q.image_alt || ""}
                />
                <button
                  type="button"
                  className="text-button"
                  onClick={() => patch({ image_path: null, image_alt: null })}
                >
                  Remove illustration
                </button>
              </>
            )}
          </label>
          <label>
            Tap-to-listen narration
            <input
              type="file"
              accept="audio/mpeg,audio/wav,audio/mp4,audio/ogg"
              onChange={(e) => upload(e.target.files?.[0], "audio")}
            />
            {q.audio_path && (
              <audio controls src={"/storage/" + q.audio_path} />
            )}
            <small>
              Read the instruction and appropriate question text. Do not reveal
              an assessed reading answer.
            </small>
          </label>
        </div>
        {q.image_path && (
          <label>
            Illustration description
            <input
              required
              value={q.image_alt || ""}
              onChange={(e) => patch({ image_alt: e.target.value })}
            />
          </label>
        )}
        <fieldset className="review-checks">
          <legend>Adult review</legend>
          {(
            [
              [
                "answers_reviewed",
                "I checked the question, all choices, and correct answer.",
              ],
              [
                "explanation_reviewed",
                "I checked the explanation for accuracy and child-friendly wording.",
              ],
              [
                "narration_reviewed",
                "I listened to the audio and checked it matches the content without revealing the answer.",
              ],
            ] as const
          ).map(([key, text]) => (
            <label key={key}>
              <input
                type="checkbox"
                checked={q[key]}
                onChange={(e) => patch({ [key]: e.target.checked })}
              />
              {text}
            </label>
          ))}
        </fieldset>
        <label>
          Publication status
          <select
            value={q.status}
            onChange={(e) => patch({ status: e.target.value })}
          >
            <option value="draft">Draft</option>
            <option value="published">Published</option>
            <option value="archived">Archived</option>
          </select>
        </label>
        <small>
          Publishing requires all review checks and uploaded narration. Saving
          creates a new revision; existing adventures keep their original
          questions.
        </small>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <button className="button primary" disabled={busy || uploading}>
          <Save size={17} />
          {uploading
            ? "Uploading…"
            : busy
              ? "Saving…"
              : "Save question revision"}
        </button>
      </form>
    </Dialog>
  );
}
function CatalogEditor({
  metadata,
  onClose,
  onSaved,
  notify,
}: {
  metadata: Meta;
  onClose: () => void;
  onSaved: () => Promise<void>;
  notify: Notice;
}) {
  const [kind, setKind] = useState<"subjects" | "topics" | "skills">(
      "subjects",
    ),
    [editing, setEditing] = useState<Record<string, unknown> | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const field = (key: string, value: unknown) =>
    setEditing({ ...editing, [key]: value });
  return (
    <Dialog title="Grow the learning world." onClose={onClose} wide>
      <div className="filter-tabs">
        {(["subjects", "topics", "skills"] as const).map((k) => (
          <button
            key={k}
            className={kind === k ? "selected" : ""}
            onClick={() => {
              setKind(k);
              setEditing(null);
            }}
          >
            {k[0].toUpperCase() + k.slice(1)}
          </button>
        ))}
      </div>
      {!editing ? (
        <>
          <button
            className="button primary"
            onClick={() =>
              setEditing({
                name: "",
                position: metadata[kind].length + 1,
                ...(kind !== "topics" ? { active: true, slug: "" } : {}),
                ...(kind === "subjects"
                  ? { description: "", color: "green", icon: "leaf" }
                  : { subject_id: metadata.subjects[0]?.id }),
                ...(kind === "skills" ? { topic_id: "", description: "" } : {}),
              })
            }
          >
            <Plus size={17} />
            Add {kind.slice(0, -1)}
          </button>
          <div className="catalog-list">
            {metadata[kind].map((m) => (
              <button key={m.id} onClick={() => setEditing({ ...m })}>
                <span>{m.name}</span>
                <Pencil size={16} />
              </button>
            ))}
          </div>
        </>
      ) : (
        <form
          className="form-stack"
          onSubmit={async (e) => {
            e.preventDefault();
            setError("");
            setBusy(true);
            try {
              const v = {
                ...editing,
                position: Number(editing.position),
                ...(kind !== "subjects"
                  ? { subject_id: Number(editing.subject_id) }
                  : {}),
                ...(kind === "skills"
                  ? {
                      topic_id: editing.topic_id
                        ? Number(editing.topic_id)
                        : null,
                    }
                  : {}),
              };
              if (editing.id)
                await api.put(`/admin/metadata/${kind}/${editing.id}`, v);
              else await api.post(`/admin/metadata/${kind}`, v);
              await onSaved();
              setEditing(null);
              notify("Learning catalog updated.");
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Name
            <input
              required
              value={String(editing.name || "")}
              onChange={(e) => field("name", e.target.value)}
            />
          </label>
          {kind !== "topics" && (
            <>
              <label>
                Slug
                <input
                  required
                  pattern="[a-z0-9-]+"
                  value={String(editing.slug || "")}
                  onChange={(e) => field("slug", e.target.value)}
                />
              </label>
              <label>
                Description
                <textarea
                  value={String(editing.description || "")}
                  onChange={(e) => field("description", e.target.value)}
                />
              </label>
            </>
          )}
          {kind !== "subjects" && (
            <label>
              Subject
              <select
                value={String(editing.subject_id || "")}
                onChange={(e) => {
                  setEditing({
                    ...editing,
                    subject_id: Number(e.target.value),
                    topic_id: null,
                  });
                }}
              >
                {metadata.subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {kind === "skills" && (
            <label>
              Topic
              <select
                value={String(editing.topic_id || "")}
                onChange={(e) => field("topic_id", e.target.value)}
              >
                <option value="">No topic</option>
                {metadata.topics
                  .filter((t) => t.subject_id === Number(editing.subject_id))
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
              </select>
            </label>
          )}
          {kind === "subjects" && (
            <div className="form-columns">
              <label>
                Color
                <select
                  value={String(editing.color)}
                  onChange={(e) => field("color", e.target.value)}
                >
                  {["orange", "purple", "green", "blue"].map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
              <label>
                Icon
                <select
                  value={String(editing.icon)}
                  onChange={(e) => field("icon", e.target.value)}
                >
                  {["calculator", "book", "leaf", "globe"].map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
            </div>
          )}
          <label>
            Learning order
            <input
              type="number"
              required
              min={0}
              value={Number(editing.position)}
              onChange={(e) => field("position", Number(e.target.value))}
            />
          </label>
          {kind !== "topics" && (
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={!!editing.active}
                onChange={(e) => field("active", e.target.checked)}
              />
              Visible in the learning catalog
            </label>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="button-group">
            <button className="button primary" disabled={busy}>
              Save {kind.slice(0, -1)}
            </button>
            <button
              type="button"
              className="button secondary"
              onClick={() => setEditing(null)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
