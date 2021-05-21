
eslint = find_program('eslint', required: false)

if eslint.found()
  test('ESLint', eslint,
    args: join_paths(meson.source_root(), 'src'),
    suite: 'lint',
  )
endif

