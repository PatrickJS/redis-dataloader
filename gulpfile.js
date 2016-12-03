'use strict';

const gulp = require('gulp');
const mocha = require('gulp-mocha');

gulp.task('default', () => {
    gulp.src('test.js', { read: false })
    .pipe(mocha({ reporter: 'dot', timeout: 5000 }));
});

gulp.task('test', () => {
    gulp.src('test.js', { read: false })
    .pipe(mocha({ reporter: 'dot', timeout: 10000 }));
});
