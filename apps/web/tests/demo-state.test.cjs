const { test } = require("node:test");
const assert = require("node:assert/strict");
const ts = require("typescript");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
// Compile the two pure TypeScript modules with the existing compiler; no test dependency.
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file).exports;
  const loaded = { exports: {} };
  cache.set(file, loaded);
  const code = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const scopedRequire = (specifier) =>
    specifier.startsWith(".")
      ? load(path.resolve(path.dirname(file), specifier + ".ts"))
      : require(specifier);
  new vm.Script(`(function(exports, require) { ${code}\n})`, {
    filename: file,
  }).runInThisContext()(loaded.exports, scopedRequire);
  return loaded.exports;
}
const { demoQuestions, englishDemo, legacyMathsDemo, demoCatalog } = load(
  path.resolve(__dirname, "../src/lib/demo.ts"),
);
const {
  emptyDemo,
  selectDemoQuestions,
  restoreDemo,
  startDemo,
  answerDemo,
  nextDemo,
} = load(path.resolve(__dirname, "../src/lib/demo-state.ts"));
const progress = {
  completed: 0,
  stars: 0,
  accuracy: 0,
  skills: [],
  recent: [],
  stickers: [],
};
const maths = demoCatalog[0].skills[0],
  english = demoCatalog[1].skills[0];

test("each public subject has 15 unique samples with all skills and a 6/6/3 mix", () => {
  for (const pool of [demoQuestions, englishDemo]) {
    assert.equal(pool.length, 15);
    assert.equal(new Set(pool.map((q) => q.id)).size, 15);
    assert.equal(new Set(pool.map((q) => q.skill)).size, 6);
    assert.deepEqual(
      ["starter", "growing", "challenge"].map(
        (level) => pool.filter((q) => q.difficulty === level).length,
      ),
      [6, 6, 3],
    );
    for (const q of pool) {
      assert.equal(new Set(q.choices.map((c) => c.text)).size, 4);
      assert.ok(q.choices[q.answer]);
      assert.ok(q.explanation);
    }
  }
});
test("selection prefers unchecked samples and then oldest answers within each level", () => {
  const first = selectDemoQuestions("maths", {}, () => 0.5);
  assert.deepEqual(
    first.map((q) => q.difficulty),
    ["starter", "starter", "growing", "growing", "challenge"],
  );
  const history = Object.fromEntries(first.map((q) => [`maths:${q.id}`, 100]));
  const second = selectDemoQuestions("maths", history, () => 0.5);
  assert.ok(second.every((q) => !first.some((old) => old.id === q.id)));
  const allSeen = Object.fromEntries(
    demoQuestions.map((q) => [
      `maths:${q.id}`,
      first.some((old) => old.id === q.id) ? 100 : 200,
    ]),
  );
  assert.deepEqual(
    selectDemoQuestions("maths", allSeen, () => 0.5).map((q) => q.id),
    first.map((q) => q.id),
  );
});
test("an unchecked replacement does not mark history and English uses its own history", () => {
  let state = startDemo(emptyDemo(progress), maths, 1000);
  state = startDemo(state, english, 1001);
  assert.deepEqual(state.history, {});
  assert.equal(state.attempt.subject_slug, "english");
  state = answerDemo(state, state.sequence[0].choices[0].id, 2000);
  assert.equal(Object.keys(state.history).length, 1);
  assert.ok(Object.keys(state.history)[0].startsWith("english:"));
});
test("refresh preserves the selected snapshots and feedback awaiting Next", () => {
  let state = startDemo(emptyDemo(progress), maths, 1000);
  state = answerDemo(state, state.sequence[0].choices[0].id, 2000);
  state.sequence[1] = { ...state.sequence[1], prompt: "A pinned snapshot" };
  const restored = restoreDemo(JSON.stringify(state), progress);
  assert.deepEqual(restored, state);
  assert.equal(nextDemo(restored).attempt.question.prompt, "A pinned snapshot");
});
test("legacy unfinished adventures retain their original order and accepted feedback", () => {
  const legacy = {
    attempt: {
      id: 1,
      skill_id: maths.id,
      skill_name: "Maths sampler",
      subject_slug: "maths",
      status: "active",
      position: 1,
      total: 5,
      answered: 2,
      score: 1,
      question: legacyMathsDemo[1],
      feedback: {
        correct: false,
        selected_choice_id: "a",
        correct_choice_id: "b",
        explanation: "Saved feedback",
      },
      reward: null,
    },
    progress: { ...progress, completed: 3, stars: 3 },
    avatar: "bear",
  };
  const restored = restoreDemo(JSON.stringify(legacy), progress);
  assert.deepEqual(
    restored.sequence.map((q) => q.id),
    legacyMathsDemo.map((q) => q.id),
  );
  assert.deepEqual(restored.attempt.feedback, legacy.attempt.feedback);
  assert.equal(restored.progress.completed, 3);
  assert.equal(restored.avatar, "bear");
  assert.equal(restored.history["maths:1"], 1);
  assert.equal(restored.history["maths:2"], 1);
  assert.equal(nextDemo(restored).attempt.question.id, legacyMathsDemo[2].id);
});
test("duplicate checks and completion actions do not change accepted answers or award twice", () => {
  let state = startDemo(emptyDemo(progress), english, 1000);
  for (let i = 0; i < 5; i++) {
    const q = state.sequence[i];
    state = answerDemo(state, q.choices[q.answer].id, 2000 + i);
    assert.equal(answerDemo(state, q.choices[(q.answer + 1) % 4].id), state);
    state = nextDemo(state, 3000 + i);
  }
  assert.equal(state.attempt.score, 5);
  assert.equal(state.progress.completed, 1);
  assert.equal(state.progress.stickers.length, 1);
  assert.equal(nextDemo(state), state);
});
test("malformed stored sequences cannot crash the demo and progress is retained", () => {
  const saved = {
    version: 2,
    attempt: {
      status: "active",
      position: 0,
      answered: 0,
      subject_slug: "maths",
    },
    sequence: [],
    progress: { ...progress, completed: 2 },
    avatar: "fox",
  };
  const restored = restoreDemo(JSON.stringify(saved), progress);
  assert.equal(restored.attempt, null);
  assert.equal(restored.progress.completed, 2);
  assert.deepEqual(restoreDemo("{broken", progress), emptyDemo(progress));
});
