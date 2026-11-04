import type { Subject, Question } from "@little-quest/api-client";
export const demoCatalog: Subject[] = [
  {
    id: 1,
    name: "Maths",
    slug: "maths",
    description: "Little numbers. Big discoveries.",
    color: "orange",
    icon: "calculator",
    skills: [
      "Place value",
      "Addition",
      "Subtraction",
      "Multiplication",
      "Division",
      "Fractions",
    ].map((name, i) => ({
      id: i + 1,
      subject_id: 1,
      name,
      slug: name.toLowerCase().replaceAll(" ", "-"),
      description: [
        "Meet the numbers all around you",
        "Bring numbers together",
        "Discover what is left",
        "Make equal groups",
        "Share things fairly",
        "Explore parts of a whole",
      ][i],
      position: i + 1,
      question_count: 10,
    })),
  },
  {
    id: 2,
    name: "English",
    slug: "english",
    description: "A whole world of wonderful words.",
    color: "purple",
    icon: "book",
    skills: [
      "Vocabulary",
      "Spelling",
      "Sentence structure",
      "Punctuation",
      "Synonyms & opposites",
      "Reading comprehension",
    ].map((name, i) => ({
      id: i + 7,
      subject_id: 2,
      name,
      slug: name.toLowerCase().replaceAll(" ", "-"),
      description: [
        "Discover wonderful new words",
        "Build words one letter at a time",
        "Put your words together",
        "Give every sentence its sparkle",
        "Find words that go together",
        "Find the story inside the words",
      ][i],
      position: i + 1,
      question_count: 10,
    })),
  },
];
const q = (
  id: number,
  prompt: string,
  options: string[],
  answer: number,
  explanation: string,
) => ({
  id,
  prompt,
  choices: options.map((text, i) => ({
    id: String.fromCharCode(97 + i),
    text,
  })),
  image_url: null,
  audio_url: null,
  image_alt: null,
  instruction: "Choose the best answer.",
  answer,
  explanation,
});
export const demoQuestions: (Question & {
  answer: number;
  explanation: string;
})[] = [
  q(
    1,
    "What is 24 + 13?",
    ["27", "37", "47", "36"],
    1,
    "24 + 10 is 34. Add 3 more and you get 37. Nice exploring!",
  ),
  q(
    2,
    "Which number has 5 tens and 2 ones?",
    ["25", "52", "502", "7"],
    1,
    "5 tens make 50. Add 2 ones to make 52.",
  ),
  q(
    3,
    "What is 18 − 6?",
    ["12", "14", "24", "10"],
    0,
    "Start with 18 and take away 6. There are 12 left.",
  ),
  q(
    4,
    "There are 3 baskets with 4 apples each. How many apples?",
    ["7", "10", "12", "14"],
    2,
    "4 + 4 + 4 makes 12. That is 3 groups of 4!",
  ),
  q(
    5,
    "What is half of 10?",
    ["2", "5", "8", "20"],
    1,
    "Share 10 equally into 2 groups. Each group has 5.",
  ),
];
export const englishDemo = [
  q(
    11,
    "Which word means the opposite of “happy”?",
    ["Glad", "Excited", "Sad", "Cheerful"],
    2,
    "Sad is the opposite of happy. Glad and cheerful mean something like happy.",
  ),
  q(
    12,
    "Choose the correctly spelled word.",
    ["Frend", "Friend", "Freind", "Frind"],
    1,
    "Friend is spelled f-r-i-e-n-d.",
  ),
  q(
    13,
    "Which sentence needs a question mark?",
    ["The sun is warm", "I like apples", "Where is my book", "We ran home"],
    2,
    "“Where is my book?” asks a question, so it needs a question mark.",
  ),
  q(
    14,
    "Choose the word that describes a very big elephant.",
    ["Tiny", "Huge", "Quietly", "Run"],
    1,
    "Huge means very big. We can say “a huge elephant.”",
  ),
  q(
    15,
    "Sam planted a seed and watered it. A small plant grew. What helped it grow?",
    ["A pencil", "Water", "A shoe", "A blanket"],
    1,
    "The story tells us Sam watered the seed. Plants need water to grow.",
  ),
];
