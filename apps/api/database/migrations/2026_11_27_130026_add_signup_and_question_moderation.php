<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->boolean('can_moderate')->default(false);
        });
        Schema::table('invitations', function (Blueprint $table) {
            $table->string('purpose', 24)->default('legacy_family');
            $table->string('name', 80)->nullable();
            $table->index(['email', 'purpose']);
        });
        Schema::create('question_proposals', function (Blueprint $table) {
            $table->id();
            $table->foreignId('question_id')->nullable()->constrained()->cascadeOnDelete();
            $table->foreignId('author_id')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('reviewer_id')->nullable()->constrained('users')->nullOnDelete();
            $table->unsignedInteger('base_version')->nullable();
            $table->unsignedInteger('version')->default(1);
            $table->string('state', 24)->default('draft')->index();
            $table->json('content');
            $table->text('review_note')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('question_proposals');
        Schema::table('invitations', function (Blueprint $table) {
            $table->dropIndex(['email', 'purpose']);
            $table->dropColumn(['purpose', 'name']);
        });
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn('can_moderate');
        });
    }
};
