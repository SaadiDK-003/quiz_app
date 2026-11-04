<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', fn (Blueprint $t) => $t->string('role')->default('parent'));
        Schema::create('invitations', function (Blueprint $t) {
            $t->id();
            $t->string('email')->index();
            $t->string('token_hash', 64)->unique();
            $t->timestamp('expires_at');
            $t->timestamp('used_at')->nullable();
            $t->timestamps();
        });
        Schema::create('child_profiles', function (Blueprint $t) {
            $t->id();
            $t->foreignId('user_id')->constrained()->cascadeOnDelete();
            $t->string('nickname', 40);
            $t->string('avatar', 20);
            $t->string('age_band', 10);
            $t->json('starting_skills')->nullable();
            $t->timestamps();
        });
        Schema::create('subjects', function (Blueprint $t) {
            $t->id();
            $t->string('name', 80);
            $t->string('slug', 80)->unique();
            $t->text('description')->default('');
            $t->string('color', 20)->default('purple');
            $t->string('icon', 30)->default('book');
            $t->unsignedInteger('position')->default(0);
            $t->boolean('active')->default(true);
            $t->timestamps();
        });
        Schema::create('topics', function (Blueprint $t) {
            $t->id();
            $t->foreignId('subject_id')->constrained()->cascadeOnDelete();
            $t->string('name', 100);
            $t->unsignedInteger('position')->default(0);
            $t->timestamps();
        });
        Schema::create('skills', function (Blueprint $t) {
            $t->id();
            $t->foreignId('subject_id')->constrained()->cascadeOnDelete();
            $t->foreignId('topic_id')->nullable()->constrained()->nullOnDelete();
            $t->string('name', 100);
            $t->string('slug', 100)->unique();
            $t->text('description')->default('');
            $t->unsignedInteger('position')->default(0);
            $t->boolean('active')->default(true);
            $t->timestamps();
        });
        Schema::create('questions', function (Blueprint $t) {
            $t->id();
            $t->string('seed_key')->nullable()->unique();
            $t->foreignId('skill_id')->constrained()->restrictOnDelete();
            $t->string('status', 20)->default('draft')->index();
            $t->timestamps();
        });
        Schema::create('question_revisions', function (Blueprint $t) {
            $t->id();
            $t->foreignId('question_id')->constrained()->cascadeOnDelete();
            $t->unsignedInteger('version');
            $t->text('prompt');
            $t->text('instruction');
            $t->json('choices');
            $t->string('correct_choice_id', 20);
            $t->text('explanation');
            $t->string('difficulty', 20)->default('starter');
            $t->string('locale', 10)->default('en');
            $t->string('image_path')->nullable();
            $t->string('image_alt')->nullable();
            $t->string('audio_path')->nullable();
            $t->boolean('answers_reviewed')->default(false);
            $t->boolean('explanation_reviewed')->default(false);
            $t->boolean('narration_reviewed')->default(false);
            $t->timestamps();
            $t->unique(['question_id', 'version']);
        });
        Schema::create('attempts', function (Blueprint $t) {
            $t->id();
            $t->foreignId('child_profile_id')->constrained()->cascadeOnDelete();
            $t->foreignId('skill_id')->constrained()->restrictOnDelete();
            $t->string('status', 20)->default('active');
            $t->unsignedInteger('position')->default(0);
            $t->unsignedInteger('score')->default(0);
            $t->timestamp('completed_at')->nullable();
            $t->timestamps();
            $t->index(['child_profile_id', 'status']);
        });
        Schema::create('attempt_questions', function (Blueprint $t) {
            $t->id();
            $t->foreignId('attempt_id')->constrained()->cascadeOnDelete();
            $t->foreignId('question_revision_id')->constrained()->restrictOnDelete();
            $t->unsignedInteger('position');
            $t->string('selected_choice_id', 20)->nullable();
            $t->boolean('correct')->nullable();
            $t->timestamp('answered_at')->nullable();
            $t->timestamps();
            $t->unique(['attempt_id', 'position']);
        });
        Schema::create('rewards', function (Blueprint $t) {
            $t->id();
            $t->foreignId('child_profile_id')->constrained()->cascadeOnDelete();
            $t->foreignId('attempt_id')->unique()->constrained()->cascadeOnDelete();
            $t->string('name');
            $t->string('icon');
            $t->timestamps();
        });
        Schema::create('activity_events', function (Blueprint $t) {
            $t->id();
            $t->foreignId('child_profile_id')->nullable()->constrained()->cascadeOnDelete();
            $t->foreignId('attempt_id')->nullable()->constrained()->cascadeOnDelete();
            $t->string('event', 40)->index();
            $t->json('metadata')->nullable();
            $t->timestamps();
        });
    }

    public function down(): void
    {
        foreach (['activity_events', 'rewards', 'attempt_questions', 'attempts', 'question_revisions', 'questions', 'skills', 'topics', 'subjects', 'child_profiles', 'invitations'] as $table) {
            Schema::dropIfExists($table);
        }Schema::table('users',fn (Blueprint $t) => $t->dropColumn('role'));
    }
};
