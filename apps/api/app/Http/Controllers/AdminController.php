<?php

namespace App\Http\Controllers;

use App\Mail\FamilyInvitation;
use App\Models\Invitation;
use App\Models\Question;
use App\Models\Skill;
use App\Models\Subject;
use App\Models\Topic;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

class AdminController extends Controller
{
    public function index(Request $r): Collection
    {
        $q = Question::with(['latestRevision', 'skill'])->orderBy('id');
        if ($r->filled('status')) {
            $q->where('status', $r->string('status'));
        }
        if ($r->filled('skill_id')) {
            $q->where('skill_id', $r->integer('skill_id'));
        }

        return $q->get()->map(fn ($q) => $this->present($q));
    }

    public function metadata(): array
    {
        return ['subjects' => Subject::orderBy('position')->get(), 'topics' => Topic::orderBy('position')->get(), 'skills' => Skill::orderBy('subject_id')->orderBy('position')->get()];
    }

    public function saveMetadata(Request $r, string $kind, ?int $id = null): Model
    {
        $models = ['subjects' => Subject::class, 'topics' => Topic::class, 'skills' => Skill::class];
        abort_unless(isset($models[$kind]), 404);
        $rules = ['name' => 'required|string|max:80', 'position' => 'required|integer|min:0', 'active' => 'sometimes|boolean'];
        if ($kind === 'topics') {
            unset($rules['active']);
        }
        if ($kind === 'subjects') {
            $rules += ['slug' => 'required|alpha_dash|max:80|unique:subjects,slug'.($id ? ','.$id : ''), 'description' => 'nullable|string|max:500', 'color' => 'required|in:orange,purple,green,blue', 'icon' => 'required|in:calculator,book,leaf,globe'];
        }
        if ($kind === 'topics') {
            $rules += ['subject_id' => 'required|exists:subjects,id'];
        }
        if ($kind === 'skills') {
            $rules += ['subject_id' => 'required|exists:subjects,id', 'topic_id' => 'nullable|exists:topics,id', 'slug' => 'required|alpha_dash|max:100|unique:skills,slug'.($id ? ','.$id : ''), 'description' => 'nullable|string|max:500'];
        }
        $v = $r->validate($rules);
        if (! empty($v['topic_id'])) {
            abort_unless(Topic::whereKey($v['topic_id'])->where('subject_id', $v['subject_id'])->exists(), 422, 'Topic must belong to the selected subject.');
        }
        $model = $id ? $models[$kind]::findOrFail($id) : new $models[$kind];
        $model->fill($v)->save();

        return $model;
    }

    public function save(Request $r, ?Question $question = null): array
    {
        $v = $r->validate(['skill_id' => 'required|integer|exists:skills,id', 'prompt' => 'required|string|max:2000', 'instruction' => 'required|string|max:500', 'choices' => 'required|array|min:2|max:4', 'choices.*.id' => 'required|string|max:20|distinct', 'choices.*.text' => 'required|string|max:300', 'choices.*.image_url' => 'nullable|string|max:500', 'correct_choice_id' => 'required|string|max:20', 'explanation' => 'required|string|max:2000', 'difficulty' => 'required|in:starter,growing,challenge', 'locale' => 'required|in:en', 'status' => 'required|in:draft,published,archived', 'image_path' => 'nullable|string|max:500', 'image_alt' => 'nullable|string|max:300', 'audio_path' => 'nullable|string|max:500', 'answers_reviewed' => 'required|boolean', 'explanation_reviewed' => 'required|boolean', 'narration_reviewed' => 'required|boolean']);
        abort_unless(in_array($v['correct_choice_id'], array_column($v['choices'], 'id'), true), 422, 'Choose a correct answer from the cards.');
        foreach (['audio_path', 'image_path'] as $field) {
            if (! empty($v[$field])) {
                abort_unless(str_starts_with($v[$field], 'media/') && ! str_contains($v[$field], '..') && Storage::disk('public')->exists($v[$field]), 422, 'Please upload the media file first.');
            }
        }
        foreach (['audio_path' => ['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/ogg', 'video/ogg'], 'image_path' => ['image/png', 'image/jpeg', 'image/webp']] as $field => $types) {
            if (! empty($v[$field])) {
                abort_unless(in_array(Storage::disk('public')->mimeType($v[$field]), $types, true), 422, 'Upload the correct image or audio file type.');
            }
        }
        foreach ($v['choices'] as $choice) {
            if (! empty($choice['image_url'])) {
                abort_unless(str_starts_with($choice['image_url'], '/storage/media/') && ! str_contains($choice['image_url'], '..') && Storage::disk('public')->exists(substr($choice['image_url'], 9)), 422, 'Upload answer pictures through the media library.');
            }
        }
        if ($v['status'] === 'published') {
            abort_unless($v['answers_reviewed'] && $v['explanation_reviewed'] && $v['narration_reviewed'] && ! empty($v['audio_path']) && (empty($v['image_path']) || ! empty($v['image_alt'])), 422, 'Review the answers, explanation and narration, upload audio, and describe any illustration before publishing.');
        }

        return DB::transaction(function () use ($v, $question) {
            if ($question?->exists) {
                $question = Question::lockForUpdate()->findOrFail($question->id);
            } else {
                $question = Question::create(['skill_id' => $v['skill_id'], 'status' => 'draft']);
            }
            $version = ($question->revisions()->max('version') ?? 0) + 1;
            $question->update(['skill_id' => $v['skill_id'], 'status' => $v['status']]);
            $data = collect($v)->except(['skill_id', 'status'])->all();
            $question->revisions()->create(array_merge($data, ['version' => $version]));

            return $this->present($question->load(['latestRevision', 'skill']));
        });
    }

    private function present(Question $q): array
    {
        return array_merge($q->latestRevision->toArray(), ['id' => $q->id, 'skill_id' => $q->skill_id, 'skill_name' => $q->skill->name, 'status' => $q->status]);
    }

    public function upload(Request $r): array
    {
        $r->validate(['file' => 'required|file|max:10240|mimes:png,jpg,jpeg,webp,mp3,wav,m4a,ogg']);
        $path = $r->file('file')->store('media', 'public');

        return ['path' => $path, 'url' => '/storage/'.$path];
    }

    public function invite(Request $r): array
    {
        $v = $r->validate(['email' => 'required|email|max:254|unique:users,email']);
        $token = Str::random(64);
        Invitation::create(['email' => strtolower($v['email']), 'token_hash' => hash('sha256', $token), 'expires_at' => now()->addDays(7)]);
        $url = config('app.url').'/?invite='.urlencode($token).'&email='.urlencode($v['email']);
        Mail::to($v['email'])->send(new FamilyInvitation($url));

        return ['message' => 'Invitation sent. It is valid for seven days.'];
    }
}
