<?php

namespace Database\Seeders;

use App\Models\Skill;
use App\Models\Subject;
use App\Models\Topic;
use App\Services\QuestionBankImporter;
use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    public function run(): void
    {
        $subjects = [['name' => 'Maths', 'slug' => 'maths', 'description' => 'Little numbers. Big discoveries.', 'color' => 'orange', 'icon' => 'calculator', 'skills' => [['place-value', 'Place value', 'Meet the numbers all around you'], ['addition', 'Addition', 'Bring numbers together'], ['subtraction', 'Subtraction', 'Discover what is left'], ['multiplication', 'Multiplication', 'Make equal groups'], ['division', 'Division', 'Share things fairly'], ['fractions', 'Fractions', 'Explore parts of a whole']]], ['name' => 'English', 'slug' => 'english', 'description' => 'A whole world of wonderful words.', 'color' => 'purple', 'icon' => 'book', 'skills' => [['vocabulary', 'Vocabulary', 'Discover wonderful new words'], ['spelling', 'Spelling', 'Build words one letter at a time'], ['sentence-structure', 'Sentence structure', 'Put your words together'], ['punctuation', 'Punctuation', 'Give every sentence its sparkle'], ['synonyms-opposites', 'Synonyms & opposites', 'Find words that go together'], ['reading-comprehension', 'Reading comprehension', 'Find the story inside the words']]]];
        foreach ($subjects as $position => $data) {
            $skills = $data['skills'];
            unset($data['skills']);
            $subject = Subject::firstOrCreate(['slug' => $data['slug']], array_merge($data, ['position' => $position + 1]));
            $topic = Topic::firstOrCreate(['subject_id' => $subject->id, 'name' => 'Foundational skills'], ['position' => 1]);
            foreach ($skills as $i => [$slug,$name,$description]) {
                Skill::firstOrCreate(['slug' => $slug], ['subject_id' => $subject->id, 'topic_id' => $topic->id, 'name' => $name, 'description' => $description, 'position' => $i + 1]);
            }
        }
        app(QuestionBankImporter::class)->bundled();
    }
}
