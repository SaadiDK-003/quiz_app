import { connection } from "next/server";
import QuizApp from "@/components/quiz-app";

export default async function Page() {
  await connection();
  return <QuizApp />;
}
