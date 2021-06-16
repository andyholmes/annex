#
# Desktop File
#
desktop_conf = configuration_data()
desktop_conf.set('application_id', application_id)
desktop_file = i18n.merge_file('desktop',
  input: configure_file(
    input: files('ca.andyholmes.Annex.desktop.in.in'),
    output: 'ca.andyholmes.Annex.desktop.in',
    configuration: desktop_conf
  ),
  output: '@0@.desktop'.format(application_id),
  install: true,
  install_dir: join_paths(datadir, 'applications'),
  po_dir: podir,
  type: 'desktop'
)

desktop_utils = find_program('desktop-file-validate', required: false)
if desktop_utils.found()
  test('Validate desktop file', desktop_utils,
       args: [desktop_file],
    depends: [desktop_file],
      suite: 'build',
  )
endif


#
# Application Icon
#
scalable_icondir = join_paths('icons', 'hicolor', 'scalable', 'apps')
install_data(
  join_paths(scalable_icondir, '@0@.svg'.format('ca.andyholmes.Annex')),
  install_dir: join_paths(datadir, scalable_icondir),
       rename: '@0@.svg'.format(application_id),
)

symbolic_icondir = join_paths('icons', 'hicolor', 'symbolic', 'apps')
install_data(
  join_paths(symbolic_icondir, '@0@-symbolic.svg'.format('ca.andyholmes.Annex')),
  install_dir: join_paths(datadir, symbolic_icondir),
       rename: '@0@-symbolic.svg'.format(application_id),
)


#
# GSettings
#
install_data('@0@.gschema.xml'.format(application_id),
  install_dir: join_paths(datadir, 'glib-2.0', 'schemas'),
)

compile_schemas = find_program('glib-compile-schemas', required: false)
if compile_schemas.found()
  test('Validate schema file', compile_schemas,
     args: ['--strict', '--dry-run', meson.current_source_dir()],
    suite: 'build',
  )
endif


#
# GResource
#
data_res = gnome.compile_resources('@0@.data'.format(application_id),
                                   '@0@.data.gresource.xml'.format(application_id),
  gresource_bundle: true,
           install: true,
       install_dir: pkgdatadir,
)


#
# DBus Service
#
dbus_conf = configuration_data()
dbus_conf.set('application_id', application_id)
dbus_conf.set('bindir', bindir)
dbus_file = configure_file(
          input: 'ca.andyholmes.Annex.service.in',
         output: '@0@.service'.format(application_id),
  configuration: dbus_conf,
        install: true,
    install_dir: join_paths(datadir, 'dbus-1', 'services'),
)

