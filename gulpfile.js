'use strict';

const gulp = require('gulp');
const mocha = require('gulp-mocha');

gulp.task('default', () => gulp.src('test.js', { read: false }).pipe(mocha()));
gulp.task('test', () => gulp.src('test.js', { read: false }).pipe(mocha()));
