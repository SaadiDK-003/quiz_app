<?php

namespace App\Http\Controllers;

use App\Mail\FamilyInvitation;
use App\Models\Invitation;
use App\Models\Question;
use App\Models\Skill;
use App\Models\Subject;
use App\Models\Topic;
use App\Services\QuestionBankImporter;
use App\Services\QuestionContent;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;

class AdminController extends Controller
{
    public function __construct(private QuestionContent $content) {}

    public function index(Request $r): Collection
    {
        $q = Question::with(['latestRevision', 'skill'])->orderBy('id');
        if ($r->filled('status')) {
            $q->where('status', $r->string('status'));
        }
        if ($r->filled('skill_id')) {
            $q->where('skill_id', $r->integer('skill_id'));
        }

        return $q->get()->map(fn ($q) => $this->content->present($q));
    }

    public function import(QuestionBankImporter $importer): array
    {
        return $importer->bundled();
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
        return $this->content->save($this->content->validate($r->all()), $question);
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
