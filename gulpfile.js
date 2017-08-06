const gulp = require('gulp');
const mocha = require('gulp-mocha');

gulp.task('default', () =>
  gulp.src('test/**/*.unit.js', { read: false }).pipe(mocha())
);
gulp.task('test', () =>
  gulp.src('test/**/*.unit.js', { read: false }).pipe(mocha())
);
