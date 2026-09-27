<?php

use Illuminate\Support\Facades\Route;

Route::get('/', function () {
    return redirect('/admin/login');
});

Route::view('/admin/{any?}', 'admin')->where('any', '.*');

Route::view('/portal/{any?}', 'portal')->where('any', '.*');
