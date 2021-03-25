# Desktop File
desktop_file = i18n.merge_file(
        input: 'ca.andyholmes.Annex.desktop.in',
       output: 'ca.andyholmes.Annex.desktop',
         type: 'desktop',
       po_dir: podir,
      install: true,
  install_dir: join_paths(datadir, 'applications'),
)

desktop_utils = find_program('desktop-file-validate', required: false)
if desktop_utils.found()
  test('Validate desktop file', desktop_utils,
    args: [desktop_file],
  )
endif


# Application Icon
scalable_icondir = join_paths('icons', 'hicolor', 'scalable', 'apps')
install_data(
  join_paths(scalable_icondir, '@0@.svg'.format('ca.andyholmes.Annex')),
  install_dir: join_paths(datadir, scalable_icondir),
       rename: '@0@.svg'.format('ca.andyholmes.Annex'),
)

symbolic_icondir = join_paths('icons', 'hicolor', 'symbolic', 'apps')
install_data(
  join_paths(symbolic_icondir, 'ca.andyholmes.Annex-symbolic.svg'),
  install_dir: join_paths(datadir, symbolic_icondir),
       rename: '@0@-symbolic.svg'.format('ca.andyholmes.Annex'),
)


# GSettings
install_data('ca.andyholmes.Annex.gschema.xml',
  install_dir: join_paths(datadir, 'glib-2.0', 'schemas'),
)

compile_schemas = find_program('glib-compile-schemas', required: false)
if compile_schemas.found()
  test('Validate schema file', compile_schemas,
    args: ['--strict', '--dry-run', meson.current_source_dir()],
  )
endif

# GResource
data_res = gnome.compile_resources('ca.andyholmes.Annex.data',
  'ca.andyholmes.Annex.data.gresource.xml',
  gresource_bundle: true,
           install: true,
       install_dir: pkgdatadir,
)
