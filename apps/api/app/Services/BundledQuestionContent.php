<?php

namespace App\Services;

use App\Models\Skill;
use App\Models\Subject;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\ValidationException;
use JsonException;

class BundledQuestionContent
{
    public const PRESCHOOL_MEDIA = 'media/preschool-v1/';

    public function read(string $name): array
    {
        try {
            $rows = json_decode(file_get_contents(database_path('content/'.$name.'.json')), true, 512, JSON_THROW_ON_ERROR);
        } catch (JsonException) {
            throw ValidationException::withMessages(['pack' => 'The bundled question pack is not valid JSON.']);
        }

        if (! is_array($rows) || ! array_is_list($rows)) {
            throw ValidationException::withMessages(['pack' => 'The bundled question pack must be a list.']);
        }

        return $rows;
    }

    public function addPreschoolSkills(): void
    {
        foreach ($this->read('preschool-skills') as $entry) {
            $subject = Subject::where('slug', $entry['subject'])->first();
            if ($subject) {
                Skill::firstOrCreate(['slug' => $entry['slug']], [
                    'subject_id' => $subject->id,
                    'name' => $entry['name'],
                    'description' => $entry['description'],
                    'position' => $subject->skills()->max('position') + 1,
                ]);
            }
        }
    }

    public function copyImage(string $path): void
    {
        $name = substr($path, strlen(self::PRESCHOOL_MEDIA));
        $file = database_path('content/preschool-images/'.$name);
        if (! preg_match('/\A[a-z0-9-]+\.png\z/', $name) || ! is_file($file)) {
            throw ValidationException::withMessages(['pack' => 'A bundled preschool picture is missing.']);
        }

        $storage = Storage::disk('public');
        if (! $storage->exists($path) && ! $storage->put($path, file_get_contents($file))) {
            throw ValidationException::withMessages(['pack' => 'A bundled preschool picture could not be saved.']);
        }
    }
}
