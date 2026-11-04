<?php

use App\Http\Controllers\AdminController;
use App\Http\Controllers\AdventureController;
use App\Http\Controllers\AuthController;
use App\Http\Controllers\FamilyController;
use Illuminate\Support\Facades\Route;

Route::prefix('api/v1')->group(function () {
    Route::middleware('throttle:10,1')->group(function () {
        Route::post('auth/login', [AuthController::class, 'login']);
        Route::post('auth/register', [AuthController::class, 'register']);
        Route::post('auth/forgot-password', [AuthController::class, 'forgot']);
        Route::post('auth/reset-password', [AuthController::class, 'reset']);
    });
    Route::middleware('auth:sanctum')->group(function () {
        Route::get('session', [AuthController::class, 'session']);
        Route::post('auth/logout', [AuthController::class, 'logout']);
        Route::post('auth/reauthenticate', [AuthController::class, 'reauthenticate'])->middleware('throttle:5,1');
        Route::post('auth/verification-notification', [AuthController::class, 'resend'])->middleware(['adult', 'throttle:3,1']);
        Route::get('auth/verify/{id}/{hash}', [AuthController::class, 'verify'])->middleware(['signed:relative', 'throttle:6,1'])->name('verification.verify');
        Route::middleware('verified')->group(function () {
            Route::get('catalog', [FamilyController::class, 'catalog']);
            Route::get('children/{child}/progress', [FamilyController::class, 'progress']);
            Route::post('children/{child}/enter', [FamilyController::class, 'enter']);
            Route::middleware('adult')->group(function () {
                Route::get('children', [FamilyController::class, 'children']);
                Route::post('children', [FamilyController::class, 'store']);
                Route::put('children/{child}', [FamilyController::class, 'update']);
                Route::delete('children/{child}', [FamilyController::class, 'destroy']);
                Route::delete('account', [AuthController::class, 'destroy']);
                Route::middleware('admin')->prefix('admin')->group(function () {
                    Route::get('questions', [AdminController::class, 'index']);
                    Route::post('questions', [AdminController::class, 'save']);
                    Route::put('questions/{question}', [AdminController::class, 'save']);
                    Route::get('metadata', [AdminController::class, 'metadata']);
                    Route::post('metadata/{kind}', [AdminController::class, 'saveMetadata']);
                    Route::put('metadata/{kind}/{id}', [AdminController::class, 'saveMetadata']);
                    Route::post('media', [AdminController::class, 'upload'])->middleware('throttle:30,1');
                    Route::post('invitations', [AdminController::class, 'invite'])->middleware('throttle:10,1');
                });
            });
            Route::middleware('learner')->group(function () {
                Route::get('attempts/active', [AdventureController::class, 'active']);
                Route::post('attempts', [AdventureController::class, 'start']);
                Route::get('attempts/{attempt}', [AdventureController::class, 'show']);
                Route::post('attempts/{attempt}/answers', [AdventureController::class, 'answer']);
                Route::post('attempts/{attempt}/next', [AdventureController::class, 'next']);
                Route::post('events/error', [AdventureController::class, 'error'])->middleware('throttle:20,1');
            });
        });
    });
});
