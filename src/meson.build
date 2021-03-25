
# JavaScript Source
src_res = gnome.compile_resources('ca.andyholmes.Annex.src',
  'ca.andyholmes.Annex.src.gresource.xml',
  gresource_bundle: true,
  install: true,
  install_dir: pkgdatadir,
)

bin_conf = configuration_data()
bin_conf.set('GJS', find_program('gjs').path())
bin_conf.set('PACKAGE_VERSION', meson.project_version())
bin_conf.set('PACKAGE_NAME', meson.project_name())
bin_conf.set('prefix', prefix)
bin_conf.set('libdir', libdir)
bin_conf.set('datadir', datadir)


# Application
annex = configure_file(
          input: 'ca.andyholmes.Annex.in',
         output: 'ca.andyholmes.Annex',
  configuration: bin_conf,
        install: true,
    install_dir: bindir
)
