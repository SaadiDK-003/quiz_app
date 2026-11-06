import type { Attempt, Progress, Skill } from "@little-quest/api-client";
import {
  demoQuestions,
  englishDemo,
  legacyMathsDemo,
  legacyEnglishDemo,
  type DemoQuestion,
  type Difficulty,
} from "./demo";

export type DemoHistory = Record<string, number>;
export type DemoState = {
  version: 2;
  attempt: Attempt | null;
  sequence: DemoQuestion[];
  history: DemoHistory;
  progress: Progress;
  avatar: string;
};
const levels: Difficulty[] = ["starter", "growing", "challenge"];
const historyKey = (subject: string, id: number) => `${subject}:${id}`;
export function emptyDemo(progress: Progress): DemoState {
  return {
    version: 2,
    attempt: null,
    sequence: [],
    history: {},
    progress,
    avatar: "fox",
  };
}

export function selectDemoQuestions(
  subject: string,
  history: DemoHistory,
  random = Math.random,
): DemoQuestion[] {
  const pool = subject === "english" ? englishDemo : demoQuestions;
  const ranked = pool
    .map((question) => ({ question, tie: random() }))
    .sort(
      (a, b) =>
        (history[historyKey(subject, a.question.id)] || 0) -
          (history[historyKey(subject, b.question.id)] || 0) || a.tie - b.tie,
    )
    .map((entry) => entry.question);
  const chosen = levels.flatMap((level, i) =>
    ranked.filter((q) => q.difficulty === level).slice(0, [2, 2, 1][i]),
  );
  for (const level of levels) {
    chosen.push(
      ...ranked
        .filter(
          (q) => q.difficulty === level && !chosen.some((c) => c.id === q.id),
        )
        .slice(0, 5 - chosen.length),
    );
  }
  return chosen.sort(
    (a, b) => levels.indexOf(a.difficulty) - levels.indexOf(b.difficulty),
  );
}

function validSnapshot(value: unknown): value is DemoQuestion {
  if (!value || typeof value !== "object") return false;
  const q = value as DemoQuestion;
  return (
    typeof q.id === "number" &&
    typeof q.prompt === "string" &&
    typeof q.explanation === "string" &&
    levels.includes(q.difficulty) &&
    Number.isInteger(q.answer) &&
    q.answer >= 0 &&
    q.answer < 4 &&
    Array.isArray(q.choices) &&
    q.choices.length === 4 &&
    q.choices.every(
      (c) => typeof c.id === "string" && typeof c.text === "string",
    ) &&
    new Set(q.choices.map((c) => c.id)).size === 4
  );
}

export function restoreDemo(raw: string | null, progress: Progress): DemoState {
  const fallback = emptyDemo(progress);
  if (!raw) return fallback;
  try {
    const saved = JSON.parse(raw);
    if (!saved || typeof saved !== "object") return fallback;
    const state: DemoState = {
      ...fallback,
      avatar: ["fox", "bear", "bunny", "panda", "cat", "frog"].includes(
        saved.avatar,
      )
        ? saved.avatar
        : "fox",
      progress:
        saved.progress &&
        Array.isArray(saved.progress.stickers) &&
        Array.isArray(saved.progress.skills) &&
        Array.isArray(saved.progress.recent) &&
        [
          saved.progress.completed,
          saved.progress.stars,
          saved.progress.accuracy,
        ].every((x) => Number.isFinite(x) && x >= 0)
          ? saved.progress
          : progress,
      history: Object.fromEntries(
        Object.entries(saved.history || {}).filter(
          ([, value]) =>
            typeof value === "number" && Number.isFinite(value) && value >= 0,
        ),
      ) as DemoHistory,
    };
    const attempt = saved.attempt as Attempt | null;
    if (
      !attempt ||
      !Number.isInteger(attempt.position) ||
      attempt.position < 0 ||
      attempt.position > 4 ||
      !Number.isInteger(attempt.answered) ||
      attempt.answered < 0 ||
      attempt.answered > 5 ||
      !["maths", "english"].includes(attempt.subject_slug) ||
      !["active", "completed"].includes(attempt.status)
    )
      return state;
    if (attempt.status === "completed")
      return { ...state, attempt, sequence: [] };
    let sequence: DemoQuestion[];
    if (saved.version === 2) {
      if (
        !Array.isArray(saved.sequence) ||
        saved.sequence.length !== 5 ||
        !saved.sequence.every(validSnapshot) ||
        new Set(saved.sequence.map((q: DemoQuestion) => q.id)).size !== 5
      )
        return state;
      sequence = saved.sequence;
    } else {
      sequence = (
        attempt.subject_slug === "english" ? legacyEnglishDemo : legacyMathsDemo
      ).map((q) => ({ ...q }));
      if (attempt.question?.id !== sequence[attempt.position].id) return state;
      for (const checked of sequence.slice(0, attempt.answered)) {
        state.history[historyKey(attempt.subject_slug, checked.id)] ??= 1;
      }
      // The old sampler always followed these five questions. Keep its exact order.
      sequence[attempt.position] = {
        ...sequence[attempt.position],
        ...attempt.question,
      };
    }
    return {
      ...state,
      attempt: { ...attempt, question: sequence[attempt.position] },
      sequence,
    };
  } catch {
    return fallback;
  }
}

export function startDemo(
  state: DemoState,
  skill: Skill,
  now = Date.now(),
): DemoState {
  const subject = skill.subject_id === 2 ? "english" : "maths";
  const sequence = selectDemoQuestions(subject, state.history);
  return {
    ...state,
    sequence,
    attempt: {
      id: now,
      skill_id: skill.id,
      skill_name: subject === "english" ? "English sampler" : "Maths sampler",
      subject_slug: subject,
      status: "active",
      position: 0,
      total: 5,
      answered: 0,
      score: 0,
      question: sequence[0],
      feedback: null,
      reward: null,
    },
  };
}

export function answerDemo(
  state: DemoState,
  choice: string,
  now = Date.now(),
): DemoState {
  const attempt = state.attempt;
  if (!attempt || attempt.status !== "active" || attempt.feedback) return state;
  const question = state.sequence[attempt.position];
  if (!question || !question.choices.some((c) => c.id === choice)) return state;
  const correctChoice = question.choices[question.answer].id;
  return {
    ...state,
    history: {
      ...state.history,
      [historyKey(attempt.subject_slug, question.id)]: now,
    },
    attempt: {
      ...attempt,
      answered: attempt.position + 1,
      score: attempt.score + Number(choice === correctChoice),
      feedback: {
        correct: choice === correctChoice,
        correct_choice_id: correctChoice,
        selected_choice_id: choice,
        explanation: question.explanation,
      },
    },
  };
}

export function nextDemo(state: DemoState, now = Date.now()): DemoState {
  const attempt = state.attempt;
  if (!attempt || attempt.status !== "active" || !attempt.feedback)
    return state;
  if (attempt.position < 4)
    return {
      ...state,
      attempt: {
        ...attempt,
        position: attempt.position + 1,
        question: state.sequence[attempt.position + 1],
        feedback: null,
      },
    };
  const reward = attempt.skill_name + " explorer";
  return {
    ...state,
    attempt: {
      ...attempt,
      status: "completed",
      question: null,
      feedback: null,
      reward,
    },
    progress: {
      ...state.progress,
      completed: state.progress.completed + 1,
      stars: state.progress.stars + 1,
      stickers: [
        {
          id: attempt.id,
          name: reward,
          icon: attempt.subject_slug === "maths" ? "star" : "book",
          earned_at: new Date(now).toISOString(),
        },
        ...state.progress.stickers,
      ],
    },
  };
}
